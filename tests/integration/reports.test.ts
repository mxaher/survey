/**
 * Report service integration tests (spec §8, §10, §11).
 *
 * Runs the real report/export services against a `bun:sqlite` database
 * populated by the real migrations, then adds frozen snapshots + anonymous
 * responses with known distributions so every assertion has a hand-computed
 * expected value.
 *
 * Covered:
 *   • the minimum-reporting-threshold privacy gate (below 7 → gate only),
 *   • scoring: average / index / favourable / neutral / unfavorable / NA,
 *   • spec payload + legacy payload coexisting without breaking each other,
 *   • strengths / development areas / development priorities classification,
 *   • future selection rates + ranking + the ≤3-selection note,
 *   • campaign summary availability + participation math,
 *   • the six export types (data tables above the threshold, blocked tables
 *     below it) and the CSV/XLSX serializers,
 *   • no employee identity / HMAC / response group id ever leaves the server.
 */
import { describe, it, expect } from "bun:test";
import type { Database } from "bun:sqlite";
import { openMemoryDb, applyMigrations, toD1 } from "../helpers/d1";
import {
  buildCampaignSummary,
  buildEnvironmentReport,
  buildExecutiveReport,
  buildFutureReport,
} from "@/lib/reporting";
import {
  EXPORT_TYPES,
  buildExportTable,
  csvField,
  parseExportType,
  tableToCsv,
  tableToXlsx,
} from "@/lib/report-export";
import {
  BELOW_THRESHOLD_MESSAGE_AR,
  FUTURE_SELECTION_NOTE_AR,
} from "@/lib/scoring";

const CAMPAIGN_ID = "camp-001";
const EXEC_A = "exec-report-a";
const EXEC_B = "exec-report-b";

/** Frequency scale frozen into snapshots (spec §9). */
const FREQ = [
  { value: "always", labelAr: "دائماً", score: 5, fav: 1, unfav: 0, excl: 0 },
  { value: "often", labelAr: "غالباً", score: 4, fav: 1, unfav: 0, excl: 0 },
  { value: "sometimes", labelAr: "أحياناً", score: 3, fav: 0, unfav: 0, excl: 0 },
  { value: "rarely", labelAr: "نادراً", score: 2, fav: 0, unfav: 1, excl: 0 },
  { value: "never", labelAr: "أبداً", score: 1, fav: 0, unfav: 1, excl: 0 },
  {
    value: "not_applicable",
    labelAr: "لا ينطبق / لا أملك معلومات كافية",
    score: null,
    fav: 0,
    unfav: 0,
    excl: 1,
  },
] as const;

interface SnapshotSpec {
  id: string;
  section: "leadership" | "environment" | "future";
  code: string;
  questionAr: string;
  questionType: string;
  dimension: string;
  categoryCode: string;
  categoryAr: string;
  displayOrder: number;
  maxSelections?: number | null;
  options?: Array<{
    value: string;
    labelAr: string;
    score: number | null;
    fav: number;
    unfav: number;
    excl: number;
  }>;
}

function newDb(): { db: Database; d1: ReturnType<typeof toD1> } {
  const db = openMemoryDb();
  applyMigrations(db);
  return { db, d1: toD1(db) };
}

function insertSnapshot(db: Database, spec: SnapshotSpec): void {
  db.prepare(
    `INSERT INTO CampaignQuestionSnapshot
       (id, campaignId, originalQuestionId, questionCode, questionAr, questionType,
        section, dimension, categoryCode, categoryAr, scaleCode, scope,
        isRequired, displayOrder, maxSelections)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    spec.id,
    CAMPAIGN_ID,
    `orig-${spec.code}`,
    spec.code,
    spec.questionAr,
    spec.questionType,
    spec.section,
    spec.dimension,
    spec.categoryCode,
    spec.categoryAr,
    spec.questionType === "scale" ? "FREQUENCY_SCALE_AR" : null,
    spec.section === "leadership" ? "executive" : "organization",
    spec.displayOrder,
    spec.maxSelections ?? null
  );

  const options =
    spec.options ??
    FREQ.map((o) => ({
      value: o.value,
      labelAr: o.labelAr,
      score: o.score as number | null,
      fav: o.fav,
      unfav: o.unfav,
      excl: o.excl,
    }));
  options.forEach((opt, index) => {
    db.prepare(
      `INSERT INTO CampaignQuestionOptionSnapshot
         (id, campaignQuestionSnapshotId, value, labelAr, score, displayOrder,
          isFavorable, isUnfavorable, isExcludedFromCalculation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `${spec.id}-o${index}`,
      spec.id,
      opt.value,
      opt.labelAr,
      opt.score,
      index,
      opt.fav,
      opt.unfav,
      opt.excl
    );
  });
}

function seedSnapshots(db: Database): void {
  insertSnapshot(db, {
    id: "snap-l1",
    section: "leadership",
    code: "LEAD_TEST_1",
    questionAr: "يتعامل مع الآخرين باحترام ومهنية.",
    questionType: "scale",
    dimension: "respect_professionalism",
    categoryCode: "respect_professionalism",
    categoryAr: "الاحترام والمهنية",
    displayOrder: 10,
  });
  insertSnapshot(db, {
    id: "snap-l2",
    section: "leadership",
    code: "LEAD_TEST_2",
    questionAr: "يتخذ قراراته بنزاهة وموضوعية.",
    questionType: "scale",
    dimension: "fairness_objectivity",
    categoryCode: "fairness_objectivity",
    categoryAr: "العدالة والموضوعية",
    displayOrder: 20,
  });
  insertSnapshot(db, {
    id: "snap-e1",
    section: "environment",
    code: "ENV_TEST_1",
    questionAr: "تُعامل الموظفين في بيئة العمل باحترام.",
    questionType: "scale",
    dimension: "org_respect_safety",
    categoryCode: "org_respect_safety",
    categoryAr: "الاحترام والسلامة",
    displayOrder: 10,
  });
  insertSnapshot(db, {
    id: "snap-f1",
    section: "future",
    code: "FUTURE_TEST_1",
    questionAr: "ما الأولويات التي ترغب في تطويرها؟",
    questionType: "multi_choice",
    dimension: "future_priorities",
    categoryCode: "future_priorities",
    categoryAr: "أولويات التحسين",
    displayOrder: 10,
    maxSelections: 3,
    options: [
      { value: "p1", labelAr: "التدريب ونقل المعرفة", score: null, fav: 0, unfav: 0, excl: 0 },
      { value: "p2", labelAr: "وضوح الأدوار", score: null, fav: 0, unfav: 0, excl: 0 },
      { value: "p3", labelAr: "أدوات العمل", score: null, fav: 0, unfav: 0, excl: 0 },
    ],
  });
}

function insertResponse(
  db: Database,
  input: {
    id: string;
    group: string;
    snapshotId: string;
    value: string;
    score: number | null;
    type: "executive" | "environment" | "future";
    executiveId?: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO Response
       (id, campaignId, executiveId, responseGroupId, questionSnapshotId,
        selectedValue, selectedScore, responseType)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    CAMPAIGN_ID,
    input.executiveId ?? null,
    input.group,
    input.snapshotId,
    input.value,
    input.score,
    input.type
  );
}

const SCORES: Record<string, number | null> = Object.fromEntries(
  FREQ.map((o) => [o.value, o.score as number | null])
);

/** Same answer pattern as the hand-computed reference below. */
const L1_PATTERN = ["always", "often", "sometimes", "always", "often", "not_applicable", "always"];
const L2_PATTERN = ["rarely", "rarely", "never", "rarely", "never", "sometimes", "rarely"];

function seedExecutiveResponses(db: Database, groups: string[]): void {
  groups.forEach((group, i) => {
    const l1 = L1_PATTERN[i % L1_PATTERN.length];
    const l2 = L2_PATTERN[i % L2_PATTERN.length];
    insertResponse(db, {
      id: `resp-l1-${group}`,
      group,
      snapshotId: "snap-l1",
      value: l1,
      score: SCORES[l1],
      type: "executive",
      executiveId: EXEC_A,
    });
    insertResponse(db, {
      id: `resp-l2-${group}`,
      group,
      snapshotId: "snap-l2",
      value: l2,
      score: SCORES[l2],
      type: "executive",
      executiveId: EXEC_A,
    });
  });
}

function seedEnvironmentResponses(db: Database, groups: string[]): void {
  groups.forEach((group, i) => {
    const value = L1_PATTERN[i % L1_PATTERN.length];
    insertResponse(db, {
      id: `resp-e1-${group}`,
      group,
      snapshotId: "snap-e1",
      value,
      score: SCORES[value],
      type: "environment",
    });
  });
}

/** p1 by everyone, p2 by the first five, p3 by the first two. */
function seedFutureResponses(db: Database, groups: string[]): void {
  groups.forEach((group, i) => {
    const picks: string[] = ["p1"];
    if (i < 5) picks.push("p2");
    if (i < 2) picks.push("p3");
    for (const [j, value] of picks.entries()) {
      insertResponse(db, {
        id: `resp-f1-${group}-${j}`,
        group,
        snapshotId: "snap-f1",
        value,
        score: null,
        type: "future",
      });
    }
  });
}

function groups(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `PRIV-${prefix}-${i + 1}`);
}

function seedExecutives(db: Database): void {
  const insertExecutive = db.prepare(
    `INSERT INTO Executive (id, nameAr, titleAr, category, departmentAr)
     VALUES (?, ?, ?, ?, ?)`
  );
  const link = db.prepare(
    `INSERT INTO CampaignExecutive (campaignId, executiveId, displayOrder, isEnabled)
     VALUES (?, ?, ?, 1)`
  );
  insertExecutive.run(EXEC_A, "مروان الحربي", "مدير عام", "manager", "الإدارة");
  insertExecutive.run(EXEC_B, "سارة العتيبي", "مديرة العمليات", "manager", "العمليات");
  link.run(CAMPAIGN_ID, EXEC_A, 90);
  link.run(CAMPAIGN_ID, EXEC_B, 91);
}

function seedFull(): ReturnType<typeof newDb> {
  const handle = newDb();
  seedSnapshots(handle.db);
  seedExecutives(handle.db);
  seedExecutiveResponses(handle.db, groups("a", 7));
  // Second executive: 7 evaluations, first question only.
  groups("b", 7).forEach((group) => {
    insertResponse(handle.db, {
      id: `resp-b-${group}`,
      group,
      snapshotId: "snap-l1",
      value: "often",
      score: 4,
      type: "executive",
      executiveId: EXEC_B,
    });
  });
  seedEnvironmentResponses(handle.db, groups("e", 7));
  seedFutureResponses(handle.db, groups("f", 8));
  return handle;
}

function seedLow(): ReturnType<typeof newDb> {
  const handle = newDb();
  seedSnapshots(handle.db);
  seedExecutives(handle.db);
  seedExecutiveResponses(handle.db, groups("a", 3));
  seedEnvironmentResponses(handle.db, groups("e", 2));
  seedFutureResponses(handle.db, groups("f", 3));
  return handle;
}

type ExecReport = NonNullable<Awaited<ReturnType<typeof buildExecutiveReport>>>;
type ExecReportAvailable = Extract<ExecReport, { reportAvailable: true }>;
type ExecReportSuppressed = Extract<ExecReport, { reportAvailable: false }>;

function expectAvailable(report: ExecReport | null): ExecReportAvailable {
  if (!report || "notFound" in report) throw new Error("missing report");
  if (!report.reportAvailable) throw new Error("report unexpectedly suppressed");
  return report;
}

function expectSuppressed(report: ExecReport | null): ExecReportSuppressed {
  if (!report || "notFound" in report) throw new Error("missing report");
  if (report.reportAvailable) throw new Error("report unexpectedly available");
  return report;
}

// ---------------------------------------------------------------------------
// Executive report
// ---------------------------------------------------------------------------

describe("executive report", () => {
  it("returns only the privacy gate below the threshold", async () => {
    const { d1 } = seedLow();
    const report = expectSuppressed(
      await buildExecutiveReport(d1, CAMPAIGN_ID, EXEC_A)
    );

    expect(report.reason).toBe("minimum_threshold_not_met");
    expect(report.messageAr).toBe(BELOW_THRESHOLD_MESSAGE_AR);
    expect(report.threshold).toBe(7);
    expect(report.respondentCount).toBe(3);
    expect(report.responseSummary.reportAvailable).toBe(false);
    expect(report.responseSummary.messageAr).toBe(BELOW_THRESHOLD_MESSAGE_AR);
    expect(report.overallScore).toBeNull();
    expect(report.categories).toEqual([]);
    expect(report.questionResults).toEqual([]);
    expect(report.strengths).toEqual([]);
    expect(report.developmentAreas).toEqual([]);
    expect(report.developmentPriorities).toEqual([]);
    expect(report.suppressed).toBe(true);
    expect(report.evaluationCount).toBe(3);
    expect(report.questions).toEqual([]);
    expect(report.dimensions).toEqual([]);
    expect(report.strength).toBeNull();
    expect(report.improvement).toBeNull();
    expect(report.executive.nameAr.length).toBeGreaterThan(0);
  });

  it("scores categories, classifications and both payload shapes at threshold", async () => {
    const { d1 } = seedFull();
    const report = expectAvailable(
      await buildExecutiveReport(d1, CAMPAIGN_ID, EXEC_A)
    );

    // Gate + summary.
    expect(report.threshold).toBe(7);
    expect(report.evaluationCount).toBe(7);
    expect(report.responseSummary).toEqual({
      respondentCount: 7,
      threshold: 7,
      reportAvailable: true,
      evaluationCount: 7,
      totalResponses: 14,
    });

    // Overall: 39 points / 13 valid answers (1 not_applicable excluded).
    expect(report.overallScore.averageScore).toBe(3);
    expect(report.overallScore.indexScore).toBe(60);
    expect(report.overallScore.favorableRate).toBe(38.46);
    expect(report.overallScore.neutralRate).toBe(15.38);
    expect(report.overallScore.unfavorableRate).toBe(46.15);
    expect(report.overallScore.notApplicableRate).toBe(7.14);
    expect(report.overallScore.validScoredAnswers).toBe(13);
    expect(report.overallScore.totalSubmittedAnswers).toBe(14);
    expect(report.overallScore.interpretationLabelAr).toBe("منخفض");

    // Categories grouped by the stored reporting category.
    expect(report.categories).toHaveLength(2);
    const respect = report.categories.find(
      (c) => c.categoryCode === "respect_professionalism"
    );
    const fairness = report.categories.find(
      (c) => c.categoryCode === "fairness_objectivity"
    );
    if (!respect || !fairness) throw new Error("missing categories");
    expect(respect.categoryAr).toBe("الاحترام والمهنية");
    expect(respect.averageScore).toBe(4.33);
    expect(respect.indexScore).toBe(86.6);
    expect(respect.favorableRate).toBe(83.33);
    expect(respect.unfavorableRate).toBe(0);
    expect(respect.notApplicableRate).toBe(14.29);
    expect(respect.questionCount).toBe(1);
    expect(fairness.averageScore).toBe(1.86);
    expect(fairness.indexScore).toBe(37.2);
    expect(fairness.favorableRate).toBe(0);
    expect(fairness.unfavorableRate).toBe(85.71);
    expect(fairness.notApplicableRate).toBe(0);

    // Classification (spec §8).
    expect(report.strengths.map((s) => s.categoryCode)).toEqual([
      "respect_professionalism",
    ]);
    expect(report.developmentAreas.map((s) => s.categoryCode)).toEqual([
      "fairness_objectivity",
    ]);
    expect(report.developmentPriorities.map((s) => s.categoryCode)).toEqual([
      "fairness_objectivity",
    ]);

    // Spec question payload (percent rates + keyed distribution).
    const first = report.questionResults[0];
    expect(first.questionCode).toBe("LEAD_TEST_1");
    expect(first.reportAvailable).toBe(true);
    expect(first.averageScore).toBe(4.33);
    expect(first.favorableRate).toBe(83.33);
    expect(first.notApplicableRate).toBe(14.29);
    expect(first.distribution.always.count).toBe(3);
    expect(first.distribution.always.percentage).toBe(50);
    expect(first.distribution.not_applicable.count).toBe(1);
    expect(first.distribution.not_applicable.percentage).toBe(14.29);

    // Legacy payload stays intact (fraction rate + array distribution).
    const legacy = report.questions[0];
    expect(legacy.snapshotId).toBe("snap-l1");
    expect(legacy.distribution).toBeArray();
    expect(legacy.distribution.find((d) => d.value === "always")?.count).toBe(3);
    expect(legacy.favorableRate).toBeCloseTo(0.8333, 3);
    expect(legacy.perQuestionSuppressed).toBe(false);
    expect(legacy.count).toBe(7);

    // Legacy dimensions + org comparison.
    expect(report.strength?.dimension).toBe("respect_professionalism");
    expect(report.improvement?.dimension).toBe("fairness_objectivity");
    expect(report.organizationComparison.respondentCount).toBe(14);
    expect(report.organizationComparison.reportAvailable).toBe(true);
  });

  it("suppresses a question answered by fewer people than the threshold", async () => {
    const { db, d1 } = newDb();
    seedSnapshots(db);
    seedExecutives(db);
    seedExecutiveResponses(db, groups("a", 7).slice(0, 7));
    db.prepare("DELETE FROM Response WHERE questionSnapshotId = 'snap-l2'").run();

    const report = expectAvailable(
      await buildExecutiveReport(d1, CAMPAIGN_ID, EXEC_A)
    );
    const suppressedQuestion = report.questionResults.find(
      (q) => q.questionCode === "LEAD_TEST_2"
    );
    expect(suppressedQuestion?.reportAvailable).toBe(false);
    expect(suppressedQuestion?.averageScore).toBeNull();
    expect(suppressedQuestion?.distribution).toEqual({});

    const legacy = report.questions.find((q) => q.questionCode === "LEAD_TEST_2");
    expect(legacy?.perQuestionSuppressed).toBe(true);
    expect(legacy?.averageScore).toBeNull();
    // The other question stays visible.
    expect(
      report.questionResults.find((q) => q.questionCode === "LEAD_TEST_1")
        ?.reportAvailable
    ).toBe(true);
  });

  it("never exposes employee identity, HMAC or response group ids", async () => {
    const { d1 } = seedFull();
    const report = await buildExecutiveReport(d1, CAMPAIGN_ID, EXEC_A);
    const json = JSON.stringify(report);

    expect(json).not.toContain("PRIV-");
    expect(json).not.toContain("responseGroupId");
    expect(json).not.toContain("employeeHmac");
    expect(json).not.toContain("employeeUser");
  });
});

// ---------------------------------------------------------------------------
// Environment report
// ---------------------------------------------------------------------------

describe("environment report", () => {
  it("returns only the privacy gate below the threshold", async () => {
    const { d1 } = seedLow();
    const report = await buildEnvironmentReport(d1, CAMPAIGN_ID);
    if (!report || report.reportAvailable) throw new Error("not suppressed");

    expect(report.reportAvailable).toBe(false);
    expect(report.reason).toBe("minimum_threshold_not_met");
    expect(report.messageAr).toBe(BELOW_THRESHOLD_MESSAGE_AR);
    expect(report.overallScore).toBeNull();
    expect(report.categories).toEqual([]);
    expect(report.questions).toEqual([]);
    expect(report.suppressed).toBe(true);
    expect(report.distinctSubmitters).toBe(2);
    expect(report.respondentCount).toBe(2);
  });

  it("scores the organization-wide environment report at threshold", async () => {
    const { d1 } = seedFull();
    const report = await buildEnvironmentReport(d1, CAMPAIGN_ID);
    if (!report || !report.reportAvailable) throw new Error("suppressed");

    expect(report.respondentCount).toBe(7);
    expect(report.responseSummary).toEqual({
      respondentCount: 7,
      threshold: 7,
      reportAvailable: true,
      distinctSubmitters: 7,
      totalResponses: 7,
    });
    expect(report.overallScore.averageScore).toBe(4.33);
    expect(report.overallScore.indexScore).toBe(86.6);
    expect(report.overallScore.favorableRate).toBe(83.33);
    expect(report.overallScore.notApplicableRate).toBe(14.29);

    expect(report.categories).toHaveLength(1);
    expect(report.categories[0].categoryCode).toBe("org_respect_safety");
    expect(report.categories[0].categoryAr).toBe("الاحترام والسلامة");
    expect(report.strengths.map((s) => s.categoryCode)).toEqual([
      "org_respect_safety",
    ]);
    expect(report.developmentAreas).toEqual([]);
    expect(report.developmentPriorities).toEqual([]);

    expect(report.questionResults).toHaveLength(1);
    expect(report.questionResults[0].distribution.not_applicable.count).toBe(1);
    expect(report.questions[0].perQuestionSuppressed).toBe(false);
    expect(report.distinctSubmitters).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Future priorities report
// ---------------------------------------------------------------------------

describe("future priorities report", () => {
  it("returns only the privacy gate below the threshold", async () => {
    const { d1 } = seedLow();
    const report = await buildFutureReport(d1, CAMPAIGN_ID);
    if (!report || report.reportAvailable) throw new Error("not suppressed");

    expect(report.reportAvailable).toBe(false);
    expect(report.reason).toBe("minimum_threshold_not_met");
    expect(report.messageAr).toBe(BELOW_THRESHOLD_MESSAGE_AR);
    expect(report.questions).toEqual([]);
    expect(report.respondentCount).toBe(3);
    expect(report.noteAr).toBe(FUTURE_SELECTION_NOTE_AR);
  });

  it("ranks selections by rate and keeps the legacy distribution", async () => {
    const { d1 } = seedFull();
    const report = await buildFutureReport(d1, CAMPAIGN_ID);
    if (!report || !report.reportAvailable) throw new Error("suppressed");

    expect(report.respondentCount).toBe(8);
    expect(report.responseSummary).toEqual({
      respondentCount: 8,
      threshold: 7,
      reportAvailable: true,
      distinctSubmitters: 8,
      totalResponses: 15,
    });
    expect(report.noteAr).toBe(FUTURE_SELECTION_NOTE_AR);

    expect(report.questions).toHaveLength(1);
    const question = questionOf(report);
    expect(question.uniqueRespondents).toBe(8);
    expect(question.totalSelections).toBe(15);
    expect(question.noteAr).toBe(FUTURE_SELECTION_NOTE_AR);
    expect(question.reportAvailable).toBe(true);

    const ranked = question.options.map((o) => o.value);
    expect(ranked).toEqual(["p1", "p2", "p3"]);
    expect(question.options.map((o) => o.selectionRate)).toEqual([100, 62.5, 25]);
    expect(question.options.map((o) => o.rank)).toEqual([1, 2, 3]);
    expect(question.options.map((o) => o.selectionCount)).toEqual([8, 5, 2]);

    // Legacy array form: percentage of this question's own selections.
    expect(question.distribution.map((d) => d.percentage)).toEqual([
      53.33, 33.33, 13.33,
    ]);
    expect(question.perQuestionSuppressed).toBe(false);
    expect(question.snapshotId).toBe("snap-f1");
  });
});

function questionOf(
  report: NonNullable<Awaited<ReturnType<typeof buildFutureReport>>>
) {
  if (!report.reportAvailable) throw new Error("suppressed");
  return report.questions[0];
}

// ---------------------------------------------------------------------------
// Campaign summary
// ---------------------------------------------------------------------------

describe("campaign summary", () => {
  it("reports availability, assignment counts and participation", async () => {
    const { d1 } = seedFull();
    const summary = await buildCampaignSummary(d1, CAMPAIGN_ID);
    if (!summary) throw new Error("missing summary");

    expect(summary.campaign.minimumReportingThreshold).toBe(7);
    expect(summary.assignedQuestions).toEqual({
      total: 4,
      leadership: 2,
      environment: 1,
      future: 1,
    });

    expect(summary.reports.executive.reportAvailable).toBe(true);
    expect(summary.reports.environment.reportAvailable).toBe(true);
    expect(summary.reports.future.reportAvailable).toBe(true);

    expect(summary.participation.eligibleParticipants).toBeNull();
    expect(summary.participation.participantsWithAnySubmission).toBe(29);
    expect(summary.participation.participationRate).toBeNull();
    expect(summary.participation.completionRate).toBeNull();
  });

  it("marks every report unavailable below the threshold", async () => {
    const { d1 } = seedLow();
    const summary = await buildCampaignSummary(d1, CAMPAIGN_ID);
    if (!summary) throw new Error("missing summary");

    expect(summary.reports.executive.reportAvailable).toBe(false);
    expect(summary.reports.executive.reason).toBe("minimum_threshold_not_met");
    expect(summary.reports.environment.reportAvailable).toBe(false);
    expect(summary.reports.future.reportAvailable).toBe(false);
    expect(summary.participation.participantsWithAnySubmission).toBe(8);
  });

  it("computes participation from the eligible count and the ledger", async () => {
    const { db, d1 } = seedFull();
    db.prepare(
      `INSERT INTO SystemSetting (id, key, valueAr)
       VALUES ('set-eligible', 'eligible_employees_count', '100')`
    ).run();
    const ledger = db.prepare(
      `INSERT INTO ParticipationLedger
         (id, campaignId, employeeHmac, participationType, scopeKey, status)
       VALUES (?, ?, ?, 'environment', 'organization', ?)`
    );
    ledger.run("led-1", CAMPAIGN_ID, "hmac-1", "submitted");
    ledger.run("led-2", CAMPAIGN_ID, "hmac-2", "submitted");
    ledger.run("led-3", CAMPAIGN_ID, "hmac-3", "submitted");
    ledger.run("led-4", CAMPAIGN_ID, "hmac-4", "started");

    const summary = await buildCampaignSummary(d1, CAMPAIGN_ID);
    if (!summary) throw new Error("missing summary");

    expect(summary.participation.eligibleParticipants).toBe(100);
    expect(summary.participation.participationRate).toBe(29);
    expect(summary.participation.startedSubmissions).toBe(1);
    expect(summary.participation.submittedSubmissions).toBe(3);
    expect(summary.participation.completionRate).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

describe("report exports", () => {
  it("parses export types with a safe default", () => {
    expect(parseExportType(null)).toBe("executive_questions");
    expect(parseExportType("")).toBe("executive_questions");
    expect(parseExportType("future_priorities")).toBe("future_priorities");
    expect(parseExportType(" Campaign_Summary ")).toBe("campaign_summary");
    expect(parseExportType("nope")).toBeNull();
    expect(EXPORT_TYPES).toHaveLength(6);
  });

  it("blocks every data export below the threshold", async () => {
    const { d1 } = seedLow();

    for (const type of [
      "executive_questions",
      "executive_summary",
      "environment_summary",
      "environment_questions",
      "future_priorities",
    ] as const) {
      const table = await buildExportTable(d1, CAMPAIGN_ID, type);
      expect(table).not.toBeNull();
      expect(table!.blocked).toBe(true);
      expect(table!.rows).toEqual([[BELOW_THRESHOLD_MESSAGE_AR]]);
      expect(table!.messageAr).toBe(BELOW_THRESHOLD_MESSAGE_AR);
    }

    // The campaign summary still exports, but every report reads "غير متاح".
    const summary = await buildExportTable(d1, CAMPAIGN_ID, "campaign_summary");
    expect(summary!.blocked).toBe(false);
    const availabilityRow = summary!.rows.find(
      (r) => r[0] === "تقرير بيئة العمل"
    );
    expect(String(availabilityRow?.[1])).toContain("غير متاح");

    const csv = tableToCsv((await buildExportTable(d1, CAMPAIGN_ID, "executive_questions"))!);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(BELOW_THRESHOLD_MESSAGE_AR);
  });

  it("builds every data table above the threshold", async () => {
    const { d1 } = seedFull();

    const execQuestions = await buildExportTable(d1, CAMPAIGN_ID, "executive_questions");
    expect(execQuestions!.blocked).toBe(false);
    expect(execQuestions!.headers).toContain("نص السؤال");
    // exec-a (2 questions) + exec-b (2 questions); seed executives have none.
    expect(execQuestions!.rows.length).toBe(4);
    const firstRow = execQuestions!.rows[0];
    expect(firstRow[1]).toBe("مروان الحربي");
    expect(firstRow[3]).toBe("الاحترام والمهنية");
    expect(firstRow[4]).toBe("يتعامل مع الآخرين باحترام ومهنية.");
    expect(firstRow[6]).toBe(4.33);
    expect(firstRow[7]).toBe(83.33);

    const execSummary = await buildExportTable(d1, CAMPAIGN_ID, "executive_summary");
    expect(execSummary!.blocked).toBe(false);
    // exec-a: 2 categories + exec-b: 1 category.
    expect(execSummary!.rows.length).toBe(3);
    expect(execSummary!.rows[0][1]).toBe("مروان الحربي");
    expect(execSummary!.rows[0][3]).toBe("الاحترام والمهنية");
    expect(execSummary!.rows[0][11]).toBe("فوق المتوسط");

    const envSummary = await buildExportTable(d1, CAMPAIGN_ID, "environment_summary");
    expect(envSummary!.rows.length).toBe(1);
    expect(envSummary!.rows[0][1]).toBe("الاحترام والسلامة");

    const envQuestions = await buildExportTable(d1, CAMPAIGN_ID, "environment_questions");
    expect(envQuestions!.rows.length).toBe(1);
    expect(envQuestions!.rows[0][5]).toBe(4.33);

    const future = await buildExportTable(d1, CAMPAIGN_ID, "future_priorities");
    expect(future!.blocked).toBe(false);
    expect(future!.rows.length).toBe(3);
    expect(future!.rows[0][3]).toBe("التدريب ونقل المعرفة");
    expect(future!.rows[0][4]).toBe(8);
    expect(future!.rows[0][5]).toBe(100);
    expect(future!.rows[0][6]).toBe(1);

    const campaign = await buildExportTable(d1, CAMPAIGN_ID, "campaign_summary");
    expect(
      campaign!.rows.some((r) => r[0] === "الحد الأدنى لعرض النتائج" && r[1] === 7)
    ).toBe(true);
    expect(
      campaign!.rows.some((r) => r[0] === "عدد الأسئلة المخصصة" && r[1] === 4)
    ).toBe(true);
    const availabilityRow = campaign!.rows.find((r) => r[0] === "تقرير بيئة العمل");
    expect(availabilityRow?.[1]).toBe("متاح");
  });

  it("serializes tables to CSV and XLSX", async () => {
    const { d1 } = seedFull();
    const table = await buildExportTable(d1, CAMPAIGN_ID, "environment_questions");

    const csv = tableToCsv(table!);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv.split("\r\n")[0]).toContain("نص السؤال");
    expect(csv).toContain("تُعامل الموظفين في بيئة العمل باحترام.");

    expect(csvField("plain")).toBe("plain");
    expect(csvField("with,comma")).toBe('"with,comma"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField(null)).toBe("");
    expect(csvField(42)).toBe("42");

    const buffer = await tableToXlsx(table!);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("returns null for an unknown export type", async () => {
    const { d1 } = seedFull();
    const table = await buildExportTable(
      d1,
      CAMPAIGN_ID,
      "not_a_type" as never
    );
    expect(table).toBeNull();
  });
});
