/**
 * Report services (spec §8, §10, §11).
 *
 * One place turns frozen snapshots + anonymous responses into the report
 * payloads returned by the administrator endpoints:
 *
 *   • `buildExecutiveReport`  — per-executive leadership report
 *   • `buildEnvironmentReport`— organization work-environment report
 *   • `buildFutureReport`     — future-priority selection report
 *   • `buildCampaignSummary`  — availability / participation summary
 *
 * Privacy: every payload passes through `reportGate` first. Below the
 * campaign's minimum reporting threshold the service returns only the gate
 * (no scores, no distributions, no category labels) — and never any
 * employee identity, HMAC, response group id, IP or user agent.
 *
 * The functions accept the structural subset of the D1 API they use, so the
 * same code runs against the real binding in Workers and against
 * `bun:sqlite` in the test suite.
 */

import { MESSAGES } from "@/lib/messages";
import { CATEGORY_LABEL_AR } from "@/lib/constants";
import {
  FUTURE_SELECTION_NOTE_AR,
  buildDistribution,
  buildDistributionList,
  buildSelectionReport,
  combineMetrics,
  computeScoredMetrics,
  interpretationBandAr,
  perQuestionSuppressed,
  rankDevelopmentAreas,
  rankDevelopmentPriorities,
  rankStrengths,
  reportGate,
  type AnswerRow,
  type OptionDefinition,
  type OptionSentiment,
  type RankedCategory,
  type ReportGate,
  type ScoredMetrics,
} from "@/lib/scoring";

// ---------------------------------------------------------------------------
// D1 structural types
// ---------------------------------------------------------------------------

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface CampaignRow {
  id: string;
  titleAr: string;
  status: string;
  minimumReportingThreshold: number;
  startsAt?: string | null;
  endsAt?: string | null;
  enableEnvironmentSurvey?: number;
  enableFutureSurvey?: number;
  allowMultipleExecutiveEvaluations?: number;
  timezone?: string;
}

interface SnapshotRow {
  id: string;
  questionCode: string;
  questionAr: string;
  questionType: string;
  section: string;
  dimension: string | null;
  categoryCode: string | null;
  categoryAr: string | null;
  scaleCode: string | null;
  scope: string | null;
  isRequired: number;
  displayOrder: number;
  maxSelections: number | null;
}

interface OptionRow {
  campaignQuestionSnapshotId: string;
  value: string;
  labelAr: string;
  score: number | null;
  displayOrder: number;
  isFavorable: number;
  isUnfavorable: number;
  isExcludedFromCalculation: number;
}

interface ResponseRow {
  questionSnapshotId: string;
  responseGroupId: string;
  executiveId: string | null;
  selectedValue: string;
  selectedScore: number | null;
}

export interface ExecutiveRef {
  id: string;
  nameAr: string;
  titleAr: string;
  category: string;
  departmentAr: string | null;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export async function loadCampaign(
  db: D1Like,
  campaignId: string
): Promise<CampaignRow | null> {
  return db
    .prepare(
      `SELECT id, titleAr, status, minimumReportingThreshold, startsAt, endsAt,
              enableEnvironmentSurvey, enableFutureSurvey,
              allowMultipleExecutiveEvaluations, timezone
       FROM Campaign WHERE id = ?`
    )
    .bind(campaignId)
    .first<CampaignRow>();
}

async function loadSnapshots(
  db: D1Like,
  campaignId: string,
  section: string
): Promise<SnapshotRow[]> {
  const result = await db
    .prepare(
      `SELECT id, questionCode, questionAr, questionType, section, dimension,
              categoryCode, categoryAr, scaleCode, scope, isRequired,
              displayOrder, maxSelections
       FROM CampaignQuestionSnapshot
       WHERE campaignId = ? AND section = ?
       ORDER BY displayOrder ASC`
    )
    .bind(campaignId, section)
    .all<SnapshotRow>();
  return result.results;
}

async function loadOptions(
  db: D1Like,
  campaignId: string,
  section: string
): Promise<OptionRow[]> {
  const result = await db
    .prepare(
      `SELECT cos.campaignQuestionSnapshotId, cos.value, cos.labelAr, cos.score,
              cos.displayOrder, cos.isFavorable, cos.isUnfavorable,
              cos.isExcludedFromCalculation
       FROM CampaignQuestionOptionSnapshot cos
       JOIN CampaignQuestionSnapshot cs ON cs.id = cos.campaignQuestionSnapshotId
       WHERE cs.campaignId = ? AND cs.section = ?
       ORDER BY cos.displayOrder ASC`
    )
    .bind(campaignId, section)
    .all<OptionRow>();
  return result.results;
}

async function loadResponses(
  db: D1Like,
  campaignId: string,
  responseType: string,
  executiveId?: string
): Promise<ResponseRow[]> {
  const sql = executiveId
    ? `SELECT questionSnapshotId, responseGroupId, executiveId, selectedValue, selectedScore
       FROM Response
       WHERE campaignId = ? AND responseType = ? AND executiveId = ?`
    : `SELECT questionSnapshotId, responseGroupId, executiveId, selectedValue, selectedScore
       FROM Response
       WHERE campaignId = ? AND responseType = ?`;
  const stmt = executiveId
    ? db.prepare(sql).bind(campaignId, responseType, executiveId)
    : db.prepare(sql).bind(campaignId, responseType);
  const result = await stmt.all<ResponseRow>();
  return result.results;
}

function distinctGroupCount(rows: readonly ResponseRow[]): number {
  return new Set(rows.map((r) => r.responseGroupId)).size;
}

// ---------------------------------------------------------------------------
// Indexing helpers
// ---------------------------------------------------------------------------

interface OptionSet {
  options: OptionDefinition[];
  sentiment: Map<string, OptionSentiment>;
}

function indexOptionSets(rows: readonly OptionRow[]): Map<string, OptionSet> {
  const map = new Map<string, OptionSet>();
  for (const row of rows) {
    let set = map.get(row.campaignQuestionSnapshotId);
    if (!set) {
      set = { options: [], sentiment: new Map() };
      map.set(row.campaignQuestionSnapshotId, set);
    }
    set.options.push({
      value: row.value,
      labelAr: row.labelAr,
      displayOrder: row.displayOrder,
      score: row.score,
      isFavorable: row.isFavorable,
      isUnfavorable: row.isUnfavorable,
      isExcludedFromCalculation: row.isExcludedFromCalculation,
    });
    set.sentiment.set(row.value, {
      isFavorable: row.isFavorable === 1,
      isUnfavorable: row.isUnfavorable === 1,
      isExcludedFromCalculation: row.isExcludedFromCalculation === 1,
    });
  }
  for (const set of map.values()) {
    set.options.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }
  return map;
}

function groupResponsesBySnapshot(
  rows: readonly ResponseRow[]
): Map<string, AnswerRow[]> {
  const map = new Map<string, AnswerRow[]>();
  for (const row of rows) {
    const list = map.get(row.questionSnapshotId);
    const answer: AnswerRow = {
      selectedValue: row.selectedValue,
      selectedScore: row.selectedScore,
    };
    if (list) list.push(answer);
    else map.set(row.questionSnapshotId, [answer]);
  }
  return map;
}

function categoryOf(snap: SnapshotRow): {
  categoryCode: string;
  categoryAr: string;
} {
  const code = snap.categoryCode ?? snap.dimension ?? "uncategorized";
  const label = snap.categoryAr ?? CATEGORY_LABEL_AR[code] ?? code;
  return { categoryCode: code, categoryAr: label };
}

function metricsPublic(metrics: ScoredMetrics) {
  return {
    averageScore: metrics.averageScore,
    indexScore: metrics.indexScore,
    favorableRate: metrics.favorableRate,
    neutralRate: metrics.neutralRate,
    unfavorableRate: metrics.unfavorableRate,
    notApplicableRate: metrics.notApplicableRate,
    validScoredAnswers: metrics.validScoredAnswers,
    totalSubmittedAnswers: metrics.totalSubmittedAnswers,
    notApplicableCount: metrics.notApplicableCount,
    interpretationLabelAr: interpretationBandAr(metrics.averageScore),
  };
}

function emptyCategories(): RankedCategory[] {
  return [];
}

function emptyStrengths() {
  return {
    strengths: [] as RankedCategory[],
    developmentAreas: [] as RankedCategory[],
    developmentPriorities: [] as RankedCategory[],
  };
}

// ---------------------------------------------------------------------------
// Shared scored-section computation
// ---------------------------------------------------------------------------

interface ScoredQuestion {
  snapshot: SnapshotRow;
  rows: AnswerRow[];
  metrics: ScoredMetrics;
  suppressed: boolean;
}

function computeScoredQuestions(
  snapshots: readonly SnapshotRow[],
  responsesBySnapshot: Map<string, AnswerRow[]>,
  optionSets: Map<string, OptionSet>,
  threshold: number
): ScoredQuestion[] {
  return snapshots.map((snapshot) => {
    const rows = responsesBySnapshot.get(snapshot.id) ?? [];
    const set = optionSets.get(snapshot.id);
    const metrics = computeScoredMetrics(rows, set?.sentiment);
    return {
      snapshot,
      rows,
      metrics,
      suppressed: perQuestionSuppressed(rows.length, threshold),
    };
  });
}

interface CategoryRollup extends RankedCategory {
  dimension: string | null;
}

function rollupCategories(
  questions: readonly ScoredQuestion[]
): CategoryRollup[] {
  const buckets = new Map<
    string,
    {
      categoryAr: string;
      dimension: string | null;
      metrics: ScoredMetrics[];
      questionCount: number;
    }
  >();

  for (const q of questions) {
    if (q.suppressed) continue;
    const { categoryCode, categoryAr } = categoryOf(q.snapshot);
    let bucket = buckets.get(categoryCode);
    if (!bucket) {
      bucket = { categoryAr, dimension: q.snapshot.dimension, metrics: [], questionCount: 0 };
      buckets.set(categoryCode, bucket);
    }
    bucket.metrics.push(q.metrics);
    bucket.questionCount++;
  }

  const rollups: CategoryRollup[] = [];
  for (const [categoryCode, bucket] of buckets) {
    const combined = combineMetrics(bucket.metrics);
    rollups.push({
      categoryCode,
      categoryAr: bucket.categoryAr,
      dimension: bucket.dimension,
      averageScore: combined.averageScore ?? 0,
      indexScore: combined.indexScore,
      favorableRate: combined.favorableRate,
      neutralRate: combined.neutralRate,
      unfavorableRate: combined.unfavorableRate,
      notApplicableRate: combined.notApplicableRate,
      questionCount: bucket.questionCount,
    });
  }

  return rollups.filter((r) => r.averageScore > 0 || r.favorableRate !== null);
}

/** Legacy per-dimension rollup: mean of per-question averages. */
function legacyDimensionRollup(
  questions: readonly ScoredQuestion[]
): Array<{
  dimension: string;
  dimensionLabelAr: string;
  averageScore: number;
  questionCount?: number;
}> {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const q of questions) {
    if (q.suppressed) continue;
    const dimension = q.snapshot.dimension;
    if (!dimension || q.metrics.averageScore === null) continue;
    const cur = buckets.get(dimension) ?? { sum: 0, count: 0 };
    cur.sum += q.metrics.averageScore;
    cur.count++;
    buckets.set(dimension, cur);
  }
  return Array.from(buckets.entries())
    .map(([dimension, v]) => ({
      dimension,
      dimensionLabelAr: CATEGORY_LABEL_AR[dimension] ?? dimension,
      averageScore: v.count > 0 ? Math.round((v.sum / v.count) * 100) / 100 : 0,
      questionCount: v.count,
    }))
    .filter((d) => d.questionCount > 0);
}

function classificationLists(categories: readonly RankedCategory[]) {
  return {
    strengths: rankStrengths(categories),
    developmentAreas: rankDevelopmentAreas(categories),
    developmentPriorities: rankDevelopmentPriorities(categories),
  };
}

function suppressedScoredPayload<T extends Record<string, unknown>>(input: {
  campaign: CampaignRow;
  gate: ReportGate;
  totalResponses: number;
  respondentCount: number;
  legacy: T;
}) {
  return {
    reportAvailable: false as const,
    reason: input.gate.reason,
    messageAr: input.gate.messageAr,
    message: input.gate.messageAr ?? MESSAGES.belowThreshold,
    threshold: input.gate.threshold,
    respondentCount: input.respondentCount,
    campaign: {
      id: input.campaign.id,
      titleAr: input.campaign.titleAr,
      status: input.campaign.status,
    },
    responseSummary: {
      respondentCount: input.respondentCount,
      threshold: input.gate.threshold,
      reportAvailable: false as const,
      reason: input.gate.reason,
      messageAr: input.gate.messageAr,
      totalResponses: input.totalResponses,
    },
    overallScore: null,
    categories: emptyCategories(),
    questionResults: [],
    ...emptyStrengths(),
    suppressed: true,
    ...input.legacy,
  };
}

// ---------------------------------------------------------------------------
// Executive report
// ---------------------------------------------------------------------------

export async function buildExecutiveReport(
  db: D1Like,
  campaignId: string,
  executiveId: string
) {
  const campaign = await loadCampaign(db, campaignId);
  if (!campaign) return null;

  const executive = await db
    .prepare(
      `SELECT id, nameAr, titleAr, category, departmentAr
       FROM Executive WHERE id = ?`
    )
    .bind(executiveId)
    .first<ExecutiveRef>();
  if (!executive) return { notFound: "executive" as const, campaign };

  const [snapshots, optionRows, execResponses, orgResponses] = await Promise.all([
    loadSnapshots(db, campaignId, "leadership"),
    loadOptions(db, campaignId, "leadership"),
    loadResponses(db, campaignId, "executive", executiveId),
    loadResponses(db, campaignId, "executive"),
  ]);

  const threshold = campaign.minimumReportingThreshold;
  const evaluationCount = distinctGroupCount(execResponses);
  const gate = reportGate(evaluationCount, threshold);
  const campaignPublic = {
    id: campaign.id,
    titleAr: campaign.titleAr,
    status: campaign.status,
  };
  const executivePublic = {
    id: executive.id,
    nameAr: executive.nameAr,
    titleAr: executive.titleAr,
    category: executive.category,
    departmentAr: executive.departmentAr,
  };

  if (!gate.reportAvailable) {
    return {
      ...suppressedScoredPayload({
        campaign,
        gate,
        totalResponses: execResponses.length,
        respondentCount: evaluationCount,
        legacy: {
          evaluationCount,
          questions: [],
          dimensions: [],
          strength: null,
          improvement: null,
          orgWideComparison: null,
        },
      }),
      executive: executivePublic,
      responseSummary: {
        respondentCount: evaluationCount,
        threshold: gate.threshold,
        reportAvailable: false as const,
        reason: gate.reason,
        messageAr: gate.messageAr,
        evaluationCount,
        totalResponses: execResponses.length,
      },
    };
  }

  const optionSets = indexOptionSets(optionRows);
  const bySnapshot = groupResponsesBySnapshot(execResponses);
  const questions = computeScoredQuestions(snapshots, bySnapshot, optionSets, threshold);

  const questionResults = questions.map((q) => {
    const { categoryCode, categoryAr } = categoryOf(q.snapshot);
    const set = optionSets.get(q.snapshot.id);
    return {
      questionCode: q.snapshot.questionCode,
      questionAr: q.snapshot.questionAr,
      categoryCode,
      categoryAr,
      questionType: q.snapshot.questionType,
      respondedCount: q.rows.length,
      reportAvailable: !q.suppressed,
      ...(q.suppressed
        ? {
            validScoredAnswers: 0,
            averageScore: null,
            indexScore: null,
            favorableRate: null,
            neutralRate: null,
            unfavorableRate: null,
            notApplicableCount: 0,
            notApplicableRate: null,
            distribution: {} as Record<string, never>,
          }
        : {
            validScoredAnswers: q.metrics.validScoredAnswers,
            averageScore: q.metrics.averageScore,
            indexScore: q.metrics.indexScore,
            favorableRate: q.metrics.favorableRate,
            neutralRate: q.metrics.neutralRate,
            unfavorableRate: q.metrics.unfavorableRate,
            notApplicableCount: q.metrics.notApplicableCount,
            notApplicableRate: q.metrics.notApplicableRate,
            distribution: buildDistribution(
              set?.options ?? [],
              q.rows,
              q.metrics,
              q.suppressed
            ),
          }),
    };
  });

  // Legacy payload consumed by the existing executive report view.
  const legacyQuestions = questions.map((q) => {
    const set = optionSets.get(q.snapshot.id);
    return {
      snapshotId: q.snapshot.id,
      questionCode: q.snapshot.questionCode,
      questionAr: q.snapshot.questionAr,
      dimension: q.snapshot.dimension,
      count: q.rows.length,
      validCount: q.metrics.validScoredAnswers,
      averageScore: q.suppressed ? null : q.metrics.averageScore,
      distribution: buildDistributionList(set?.options ?? [], q.rows, q.suppressed),
      favorableRate:
        q.suppressed || q.metrics.favorableRate === null
          ? null
          : q.metrics.favorableRate / 100,
      notApplicableCount: q.suppressed ? 0 : q.metrics.notApplicableCount,
      perQuestionSuppressed: q.suppressed,
    };
  });

  const categories = rollupCategories(questions);
  const overall = combineMetrics(
    questions.filter((q) => !q.suppressed).map((q) => q.metrics)
  );
  const { strengths, developmentAreas, developmentPriorities } =
    classificationLists(categories);

  const dimensions = legacyDimensionRollup(questions).map((d) => ({
    dimension: d.dimension,
    dimensionLabelAr: d.dimensionLabelAr,
    averageScore: d.averageScore,
    questionCount: d.questionCount ?? 0,
  }));
  const sortedDimensions = [...dimensions].sort(
    (a, b) => b.averageScore - a.averageScore
  );

  // Organization-wide comparison (same snapshots, every executive).
  const orgOptionSets = indexOptionSets(optionRows);
  const orgBySnapshot = groupResponsesBySnapshot(orgResponses);
  const orgQuestions = computeScoredQuestions(
    snapshots,
    orgBySnapshot,
    orgOptionSets,
    threshold
  );
  const orgDimensions = legacyDimensionRollup(orgQuestions).map((d) => ({
    dimension: d.dimension,
    dimensionLabelAr: d.dimensionLabelAr,
    averageScore: d.averageScore,
  }));
  const orgOverall = combineMetrics(
    orgQuestions.filter((q) => !q.suppressed).map((q) => q.metrics)
  );

  return {
    reportAvailable: true as const,
    threshold,
    respondentCount: evaluationCount,
    campaign: campaignPublic,
    executive: executivePublic,
    responseSummary: {
      respondentCount: evaluationCount,
      threshold,
      reportAvailable: true as const,
      evaluationCount,
      totalResponses: execResponses.length,
    },
    overallScore: metricsPublic(overall),
    categories,
    questionResults,
    strengths,
    developmentAreas,
    developmentPriorities,
    organizationComparison: {
      respondentCount: distinctGroupCount(orgResponses),
      reportAvailable: reportGate(distinctGroupCount(orgResponses), threshold)
        .reportAvailable,
      overallScore: metricsPublic(orgOverall),
      categories: rollupCategories(orgQuestions),
    },
    // Legacy payload (kept in sync for the existing admin views).
    suppressed: false,
    evaluationCount,
    questions: legacyQuestions,
    dimensions,
    strength: sortedDimensions[0] ?? null,
    improvement: sortedDimensions[sortedDimensions.length - 1] ?? null,
    orgWideComparison: {
      totalResponses: orgResponses.length,
      suppressed: orgResponses.length < threshold,
      dimensions: orgDimensions,
    },
  };
}

// ---------------------------------------------------------------------------
// Environment report
// ---------------------------------------------------------------------------

export async function buildEnvironmentReport(
  db: D1Like,
  campaignId: string
) {
  const campaign = await loadCampaign(db, campaignId);
  if (!campaign) return null;

  const [snapshots, optionRows, responses] = await Promise.all([
    loadSnapshots(db, campaignId, "environment"),
    loadOptions(db, campaignId, "environment"),
    loadResponses(db, campaignId, "environment"),
  ]);

  const threshold = campaign.minimumReportingThreshold;
  const distinctSubmitters = distinctGroupCount(responses);
  const gate = reportGate(distinctSubmitters, threshold);

  const campaignPublic = {
    id: campaign.id,
    titleAr: campaign.titleAr,
    status: campaign.status,
    minimumReportingThreshold: threshold,
    enableEnvironmentSurvey: campaign.enableEnvironmentSurvey,
  };

  if (!gate.reportAvailable) {
    return {
      ...suppressedScoredPayload({
        campaign,
        gate,
        totalResponses: responses.length,
        respondentCount: distinctSubmitters,
        legacy: {
          questions: [],
          distinctSubmitters,
          totalResponses: responses.length,
        },
      }),
      campaign: campaignPublic,
      responseSummary: {
        respondentCount: distinctSubmitters,
        threshold: gate.threshold,
        reportAvailable: false as const,
        reason: gate.reason,
        messageAr: gate.messageAr,
        distinctSubmitters,
        totalResponses: responses.length,
      },
    };
  }

  const optionSets = indexOptionSets(optionRows);
  const bySnapshot = groupResponsesBySnapshot(responses);
  const questions = computeScoredQuestions(snapshots, bySnapshot, optionSets, threshold);

  const questionResults = questions.map((q) => {
    const { categoryCode, categoryAr } = categoryOf(q.snapshot);
    const set = optionSets.get(q.snapshot.id);
    return {
      questionCode: q.snapshot.questionCode,
      questionAr: q.snapshot.questionAr,
      categoryCode,
      categoryAr,
      questionType: q.snapshot.questionType,
      respondedCount: q.rows.length,
      reportAvailable: !q.suppressed,
      ...(q.suppressed
        ? {
            validScoredAnswers: 0,
            averageScore: null,
            indexScore: null,
            favorableRate: null,
            neutralRate: null,
            unfavorableRate: null,
            notApplicableCount: 0,
            notApplicableRate: null,
            distribution: {} as Record<string, never>,
          }
        : {
            validScoredAnswers: q.metrics.validScoredAnswers,
            averageScore: q.metrics.averageScore,
            indexScore: q.metrics.indexScore,
            favorableRate: q.metrics.favorableRate,
            neutralRate: q.metrics.neutralRate,
            unfavorableRate: q.metrics.unfavorableRate,
            notApplicableCount: q.metrics.notApplicableCount,
            notApplicableRate: q.metrics.notApplicableRate,
            distribution: buildDistribution(
              set?.options ?? [],
              q.rows,
              q.metrics,
              q.suppressed
            ),
          }),
    };
  });

  const legacyQuestions = questions.map((q) => {
    const set = optionSets.get(q.snapshot.id);
    return {
      snapshotId: q.snapshot.id,
      questionCode: q.snapshot.questionCode,
      questionAr: q.snapshot.questionAr,
      dimension: q.snapshot.dimension,
      count: q.rows.length,
      validCount: q.metrics.validScoredAnswers,
      averageScore: q.suppressed ? null : q.metrics.averageScore,
      distribution: buildDistributionList(set?.options ?? [], q.rows, q.suppressed),
      favorableRate:
        q.suppressed || q.metrics.favorableRate === null
          ? null
          : q.metrics.favorableRate / 100,
      notApplicableCount: q.suppressed ? 0 : q.metrics.notApplicableCount,
      perQuestionSuppressed: q.suppressed,
    };
  });

  const categories = rollupCategories(questions);
  const overall = combineMetrics(
    questions.filter((q) => !q.suppressed).map((q) => q.metrics)
  );
  const { strengths, developmentAreas, developmentPriorities } =
    classificationLists(categories);

  return {
    reportAvailable: true as const,
    threshold,
    respondentCount: distinctSubmitters,
    campaign: campaignPublic,
    responseSummary: {
      respondentCount: distinctSubmitters,
      threshold,
      reportAvailable: true as const,
      distinctSubmitters,
      totalResponses: responses.length,
    },
    overallScore: metricsPublic(overall),
    categories,
    questionResults,
    strengths,
    developmentAreas,
    developmentPriorities,
    // Legacy payload.
    suppressed: false,
    totalResponses: responses.length,
    distinctSubmitters,
    questions: legacyQuestions,
  };
}

// ---------------------------------------------------------------------------
// Future report
// ---------------------------------------------------------------------------

export async function buildFutureReport(db: D1Like, campaignId: string) {
  const campaign = await loadCampaign(db, campaignId);
  if (!campaign) return null;

  const [snapshots, optionRows, responses] = await Promise.all([
    loadSnapshots(db, campaignId, "future"),
    loadOptions(db, campaignId, "future"),
    loadResponses(db, campaignId, "future"),
  ]);

  const threshold = campaign.minimumReportingThreshold;
  const distinctSubmitters = distinctGroupCount(responses);
  const gate = reportGate(distinctSubmitters, threshold);

  const campaignPublic = {
    id: campaign.id,
    titleAr: campaign.titleAr,
    status: campaign.status,
    minimumReportingThreshold: threshold,
    enableFutureSurvey: campaign.enableFutureSurvey,
  };

  if (!gate.reportAvailable) {
    return {
      reportAvailable: false as const,
      reason: gate.reason,
      messageAr: gate.messageAr,
      message: gate.messageAr ?? MESSAGES.belowThreshold,
      threshold: gate.threshold,
      respondentCount: distinctSubmitters,
      campaign: campaignPublic,
      responseSummary: {
        respondentCount: distinctSubmitters,
        threshold: gate.threshold,
        reportAvailable: false as const,
        reason: gate.reason,
        messageAr: gate.messageAr,
        distinctSubmitters,
        totalResponses: responses.length,
      },
      questions: [],
      noteAr: FUTURE_SELECTION_NOTE_AR,
      suppressed: true,
      totalResponses: responses.length,
      distinctSubmitters,
    };
  }

  const optionSets = indexOptionSets(optionRows);

  const countsBySnapshot = new Map<string, Map<string, number>>();
  for (const row of responses) {
    let bucket = countsBySnapshot.get(row.questionSnapshotId);
    if (!bucket) {
      bucket = new Map<string, number>();
      countsBySnapshot.set(row.questionSnapshotId, bucket);
    }
    bucket.set(row.selectedValue, (bucket.get(row.selectedValue) ?? 0) + 1);
  }

  const questions = snapshots.map((snapshot) => {
    const set = optionSets.get(snapshot.id);
    const counts = countsBySnapshot.get(snapshot.id) ?? new Map<string, number>();
    const totalSelections = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const suppressed = perQuestionSuppressed(totalSelections, threshold);
    const { categoryCode, categoryAr } = categoryOf(snapshot);
    const isMulti = snapshot.questionType === "multi_choice";

    const options = buildSelectionReport(
      set?.options ?? [],
      counts,
      distinctSubmitters,
      suppressed
    );

    // Legacy array form (percentage over this question's own selections).
    const distribution = (set?.options ?? []).map((option) => {
      const count = suppressed ? 0 : (counts.get(option.value) ?? 0);
      return {
        value: option.value,
        labelAr: option.labelAr,
        count,
        percentage:
          suppressed || totalSelections === 0
            ? 0
            : Math.round((count / totalSelections) * 10000) / 100,
      };
    });

    return {
      // Spec fields
      questionCode: snapshot.questionCode,
      questionAr: snapshot.questionAr,
      questionType: snapshot.questionType,
      categoryCode,
      categoryAr,
      uniqueRespondents: distinctSubmitters,
      totalSelections,
      options,
      noteAr: isMulti && (snapshot.maxSelections ?? 0) > 1
        ? FUTURE_SELECTION_NOTE_AR
        : null,
      reportAvailable: !suppressed,
      // Legacy fields (existing admin future view)
      snapshotId: snapshot.id,
      dimension: snapshot.dimension,
      total: totalSelections,
      distribution,
      perQuestionSuppressed: suppressed,
    };
  });

  return {
    reportAvailable: true as const,
    threshold,
    respondentCount: distinctSubmitters,
    campaign: campaignPublic,
    responseSummary: {
      respondentCount: distinctSubmitters,
      threshold,
      reportAvailable: true as const,
      distinctSubmitters,
      totalResponses: responses.length,
    },
    questions,
    noteAr: FUTURE_SELECTION_NOTE_AR,
    suppressed: false,
    totalResponses: responses.length,
    distinctSubmitters,
  };
}

// ---------------------------------------------------------------------------
// Campaign summary
// ---------------------------------------------------------------------------

export async function buildCampaignSummary(db: D1Like, campaignId: string) {
  const campaign = await loadCampaign(db, campaignId);
  if (!campaign) return null;
  const threshold = campaign.minimumReportingThreshold;

  const [execResponses, envResponses, futureResponses, configResult, eligibleRow, ledgerResult] =
    await Promise.all([
      loadResponses(db, campaignId, "executive"),
      loadResponses(db, campaignId, "environment"),
      loadResponses(db, campaignId, "future"),
      db
        .prepare(
          `SELECT section, COUNT(*) AS cnt
           FROM CampaignQuestionSnapshot
           WHERE campaignId = ?
           GROUP BY section`
        )
        .bind(campaignId)
        .all<{ section: string; cnt: number }>(),
      db
        .prepare(`SELECT valueAr FROM SystemSetting WHERE key = 'eligible_employees_count'`)
        .first<{ valueAr: string }>(),
      db
        .prepare(
          `SELECT participationType, status, COUNT(*) AS cnt
           FROM ParticipationLedger
           WHERE campaignId = ?
           GROUP BY participationType, status`
        )
        .bind(campaignId)
        .all<{ participationType: string; status: string; cnt: number }>(),
    ]);

  const gateFor = (rows: readonly ResponseRow[]) => {
    const respondentCount = distinctGroupCount(rows);
    return { ...reportGate(respondentCount, threshold), respondentCount };
  };

  const executive = gateFor(execResponses);
  const environment = gateFor(envResponses);
  const future = gateFor(futureResponses);

  const questionCounts = { leadership: 0, environment: 0, future: 0 };
  let assignedQuestions = 0;
  for (const row of configResult.results) {
    if (row.section in questionCounts) {
      questionCounts[row.section as keyof typeof questionCounts] = row.cnt;
    }
    assignedQuestions += row.cnt;
  }

  const eligibleParticipants = eligibleRow
    ? Number(eligibleRow.valueAr)
    : null;
  const submittedTotal = new Set(
    [...execResponses, ...envResponses, ...futureResponses].map(
      (r) => r.responseGroupId
    )
  ).size;

  let startedTotal = 0;
  let submittedLedger = 0;
  for (const row of ledgerResult.results) {
    if (row.status === "started") startedTotal += row.cnt;
    if (row.status === "submitted") submittedLedger += row.cnt;
  }
  const completionRate =
    startedTotal + submittedLedger > 0
      ? Math.round((submittedLedger / (startedTotal + submittedLedger)) * 10000) / 100
      : null;

  return {
    campaign: {
      id: campaign.id,
      titleAr: campaign.titleAr,
      status: campaign.status,
      startsAt: campaign.startsAt ?? null,
      endsAt: campaign.endsAt ?? null,
      timezone: campaign.timezone ?? null,
      minimumReportingThreshold: threshold,
      enableEnvironmentSurvey: campaign.enableEnvironmentSurvey,
      enableFutureSurvey: campaign.enableFutureSurvey,
      allowMultipleExecutiveEvaluations: campaign.allowMultipleExecutiveEvaluations,
    },
    participation: {
      eligibleParticipants,
      participantsWithAnySubmission: submittedTotal,
      participationRate:
        eligibleParticipants && eligibleParticipants > 0
          ? Math.round((submittedTotal / eligibleParticipants) * 10000) / 100
          : null,
      completionRate,
      averageCompletionTimeSeconds: null,
      startedSubmissions: startedTotal,
      submittedSubmissions: submittedLedger,
    },
    reports: {
      executive,
      environment,
      future,
    },
    assignedQuestions: {
      total: assignedQuestions,
      leadership: questionCounts.leadership,
      environment: questionCounts.environment,
      future: questionCounts.future,
    },
  };
}
