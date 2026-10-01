import { describe, it, expect } from "bun:test";
import {
  openMemoryDb,
  applyMigrations,
  applyMigration,
} from "../helpers/d1";

const BANK_GLOB = "(code GLOB 'LEAD_*' OR code GLOB 'ENV_*' OR code GLOB 'FUTURE_*')";
const LEGACY_GLOB =
  "(code GLOB 'ENV_*' OR code GLOB 'FUTURE_*' OR code GLOB 'L[0-9][0-9]' OR code GLOB 'E[0-9][0-9]' OR code GLOB 'F[0-9][0-9]')";

function count(db: ReturnType<typeof openMemoryDb>, sql: string): number {
  const row = db.prepare(sql).get() as { c: number };
  return row.c;
}

describe("migrations + approved question bank seed", () => {
  it("applies every migration in order on a fresh database", () => {
    const db = openMemoryDb();
    const files = applyMigrations(db);
    expect(files).toEqual([
      "0001_init.sql",
      "0002_seed.sql",
      "0003_activate.sql",
      "0004_auth.sql",
      "0005_registration.sql",
      "0006_scoring_schema.sql",
      "0007_question_bank_seed.sql",
      "0008_privacy_hardening.sql",
      "0009_question_bank_v2.sql",
      "0010_ms_forms_survey.sql",
    ]);
    db.close();
  });

  it("seeds exactly the 15 approved questions and drops every earlier bank", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const bankQuestions = count(
      db,
      `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB}`
    );
    expect(bankQuestions).toBe(15);

    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND section = 'leadership'`)
    ).toBe(15);
    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND section = 'environment'`)
    ).toBe(0);
    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND section = 'future'`)
    ).toBe(0);

    // Nothing of the legacy library (0002) or the v1 bank (0007) survives.
    expect(count(db, `SELECT COUNT(*) c FROM Question WHERE ${LEGACY_GLOB}`)).toBe(0);
    expect(count(db, "SELECT COUNT(*) c FROM Question")).toBe(15);
    expect(count(db, "SELECT COUNT(*) c FROM QuestionOption")).toBe(75);

    // Question-level bank: no dimension/category — reports stay per question.
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB}
           AND (categoryCode IS NOT NULL OR categoryAr IS NOT NULL OR dimension IS NOT NULL)`
      )
    ).toBe(0);
    expect(
      count(db, `SELECT COUNT(DISTINCT categoryCode) c FROM Question WHERE ${BANK_GLOB}`)
    ).toBe(0);

    // Every question is an executive scale question.
    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND scope = 'executive'`)
    ).toBe(15);
    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND scope NOT IN ('executive','organization')`)
    ).toBe(0);
    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND questionType <> 'scale'`)
    ).toBe(0);
    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND questionType NOT IN ('scale','yes_no','single_choice','multi_choice')`)
    ).toBe(0);

    // One question per display order slot.
    expect(
      count(db, `SELECT COUNT(DISTINCT displayOrder) c FROM Question WHERE ${BANK_GLOB}`)
    ).toBe(15);

    db.close();
  });

  it("seeds five options per question with database-driven sentiment flags", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const optionCount = count(
      db,
      `SELECT COUNT(*) c FROM QuestionOption o JOIN Question q ON q.id = o.questionId WHERE ${BANK_GLOB}`
    );
    expect(optionCount).toBe(75);

    // Every question has exactly five choices (4 scored + "لا ينطبق").
    const perQuestion = db
      .prepare(
        `SELECT q.code, COUNT(*) c FROM Question q JOIN QuestionOption o ON o.questionId = q.id
         WHERE ${BANK_GLOB} GROUP BY q.code ORDER BY q.code`
      )
      .all() as Array<{ code: string; c: number }>;
    expect(perQuestion.length).toBe(15);
    expect(perQuestion.every((r) => r.c === 5)).toBe(true);

    // One top option (score 5, favourable) per question: 15.
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM Question q JOIN QuestionOption o ON o.questionId = q.id
         WHERE ${BANK_GLOB} AND o.score = 5 AND o.isFavorable = 1`
      )
    ).toBe(15);

    // Frequency questions carry دائما / غالبا as favourable (13 × 2 = 26) and
    // the loyalty item adds إيجابي جدا + إيجابي (2) — 29 favourable options;
    // the intent item contributes only its top choice (1) and reaches 29 too.
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM Question q JOIN QuestionOption o ON o.questionId = q.id
         WHERE ${BANK_GLOB} AND o.isFavorable = 1`
      )
    ).toBe(29);
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM Question q JOIN QuestionOption o ON o.questionId = q.id
         WHERE ${BANK_GLOB} AND o.isUnfavorable = 1`
      )
    ).toBe(16);

    // The excluded option: stored once per question, never scored.
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM Question q JOIN QuestionOption o ON o.questionId = q.id
         WHERE ${BANK_GLOB} AND o.value = 'not_applicable'
           AND o.isExcludedFromCalculation = 1 AND o.score IS NULL`
      )
    ).toBe(15);
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM Question q JOIN QuestionOption o ON o.questionId = q.id
         WHERE ${BANK_GLOB} AND o.score IS NULL`
      )
    ).toBe(15);

    db.close();
  });

  it("re-running the seed is idempotent (no duplicates, no clobbering)", () => {
    const db = openMemoryDb();
    // The v2 seed is exercised against the state it was written for — later
    // migrations (0010) re-word the same rows on purpose.
    applyMigrations(db, "0009_question_bank_v2.sql");

    const before = {
      questions: count(db, "SELECT COUNT(*) c FROM Question"),
      options: count(db, "SELECT COUNT(*) c FROM QuestionOption"),
      config: count(db, "SELECT COUNT(*) c FROM CampaignQuestionConfig"),
    };

    applyMigration(db, "0009_question_bank_v2.sql");
    applyMigration(db, "0009_question_bank_v2.sql");

    const after = {
      questions: count(db, "SELECT COUNT(*) c FROM Question"),
      options: count(db, "SELECT COUNT(*) c FROM QuestionOption"),
      config: count(db, "SELECT COUNT(*) c FROM CampaignQuestionConfig"),
    };
    expect(after).toEqual(before);
    expect(after).toEqual({ questions: 15, options: 75, config: 15 });

    // An administrator edit survives a re-run (INSERT OR IGNORE only).
    db.prepare(
      `UPDATE Question SET questionAr = 'نص معدل' WHERE code = 'LEAD_Q01'`
    ).run();
    applyMigration(db, "0009_question_bank_v2.sql");
    const edited = db
      .prepare(`SELECT questionAr FROM Question WHERE code = 'LEAD_Q01'`)
      .get() as { questionAr: string };
    expect(edited.questionAr).toBe("نص معدل");

    db.close();
  });

  it("wires the demo campaign to the bank, active with frozen snapshots", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const campaign = db
      .prepare(
        `SELECT status, minimumReportingThreshold, enableEnvironmentSurvey,
                enableFutureSurvey, allowMultipleExecutiveEvaluations,
                maxExecutives, timezone, titleAr
         FROM Campaign WHERE id = 'camp-001'`
      )
      .get() as Record<string, unknown>;
    // 0010 publishes the MS Forms survey: active on arrival, leadership-only,
    // every executive assignable (no ceiling).
    expect(campaign.status).toBe("active");
    expect(campaign.titleAr).toBe("استبيان الاستمرار في تطوير بيئة العمل");
    expect(campaign.minimumReportingThreshold).toBe(7);
    expect(campaign.enableEnvironmentSurvey).toBe(0);
    expect(campaign.enableFutureSurvey).toBe(0);
    expect(campaign.allowMultipleExecutiveEvaluations).toBe(1);
    expect(campaign.maxExecutives).toBeNull();
    expect(campaign.timezone).toBe("Asia/Riyadh");

    // Exactly the approved bank is assigned, and nothing else.
    expect(
      count(db, `SELECT COUNT(*) c FROM CampaignQuestionConfig WHERE campaignId = 'camp-001'`)
    ).toBe(15);
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM CampaignQuestionConfig c JOIN Question q ON q.id = c.questionId
         WHERE c.campaignId = 'camp-001' AND NOT (${BANK_GLOB})`
      )
    ).toBe(0);

    // The bank is entirely executive-scoped and already frozen for reading.
    const scopes = db
      .prepare(
        `SELECT q.scope, COUNT(*) c FROM CampaignQuestionConfig c JOIN Question q ON q.id = c.questionId
         WHERE c.campaignId = 'camp-001' GROUP BY q.scope ORDER BY q.scope`
      )
      .all() as Array<{ scope: string; c: number }>;
    expect(scopes).toEqual([{ scope: "executive", c: 15 }]);
    expect(
      count(db, `SELECT COUNT(*) c FROM CampaignQuestionSnapshot WHERE campaignId = 'camp-001'`)
    ).toBe(15);
    expect(
      count(db, `SELECT COUNT(*) c FROM CampaignQuestionOptionSnapshot`)
    ).toBe(75);

    db.close();
  });

  it("carries the MS Forms questions verbatim, in the form's order", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const questions = db
      .prepare(
        `SELECT id, questionAr, scaleCode, displayOrder
         FROM Question WHERE ${BANK_GLOB} ORDER BY displayOrder`
      )
      .all() as Array<{
      id: string;
      questionAr: string;
      scaleCode: string;
      displayOrder: number;
    }>;

    const labelsOf = (questionId: string) =>
      (
        db
          .prepare(
            "SELECT labelAr FROM QuestionOption WHERE questionId = ? ORDER BY displayOrder"
          )
          .all(questionId) as Array<{ labelAr: string }>
      ).map((o) => o.labelAr);

    expect(questions.length).toBe(15);
    expect(questions.map((q) => q.displayOrder)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150,
    ]);

    // First and last statements of the form, word for word.
    expect(questions[0].questionAr).toBe(
      "ما تأثيره على مستوى نسبة ولاءك وانتماءك للشركة؟"
    );
    expect(questions[14].questionAr).toBe(
      "هل يتحمل نتائج أخطاء فريق عمله امام المستوى الأعلى، أم يتنصل من المسؤولية؟"
    );

    // The form's five choices, on every single question.
    for (const q of questions) {
      const labels = labelsOf(q.id);
      expect(labels).toHaveLength(5);
      expect(labels[0]).not.toBe("");
      expect(labels[4]).toBe("لا ينطبق / لا يمكنني التقييم");
    }

    // The two items with their own answer sets.
    expect(labelsOf(questions[0].id).slice(0, 4)).toEqual([
      "إيجابي جدا",
      "إيجابي",
      "لا يؤثر",
      "تأثير سلبي",
    ]);
    expect(labelsOf(questions[1].id).slice(0, 4)).toEqual([
      "عالية",
      "متوسطة",
      "ضعيفة",
      "لا ارغب",
    ]);
    expect(questions[0].scaleCode).toBe("IMPACT_SCALE_AR");
    expect(questions[1].scaleCode).toBe("LIKELIHOOD_SCALE_AR");
    expect(
      questions.filter((q) => q.scaleCode === "FREQUENCY_4_SCALE_AR").length
    ).toBe(13);

    db.close();
  });

  it("assigns the 13 named executives and retires the 8 placeholders", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const assigned = db
      .prepare(
        `SELECT e.nameAr FROM CampaignExecutive ce
         JOIN Executive e ON e.id = ce.executiveId
         WHERE ce.campaignId = 'camp-001' AND ce.isEnabled = 1
         ORDER BY ce.displayOrder`
      )
      .all() as Array<{ nameAr: string }>;
    expect(assigned.map((r) => r.nameAr)).toEqual([
      "م. سعد القحطاني",
      "أ. محمد المطيري",
      "أ. محمد عبد الحميد",
      "أ. عبدالاله المرشد",
      "أ. منصور القعود",
      "أ. معتصم العقاد",
      "أ. فهد الحازمي",
      "م. محمد زاهر",
      "أ. أمتياز أحمد",
      "أ. محمد خضر",
      "م. عوض الغوازي",
      "د. محمد بطران",
      "أ. ليلى السهلي",
    ]);

    // The seeded placeholders are deactivated, never deleted.
    expect(count(db, "SELECT COUNT(*) c FROM Executive WHERE isActive = 1")).toBe(13);
    expect(
      count(db, "SELECT COUNT(*) c FROM Executive WHERE isActive = 0 AND deletedAt IS NOT NULL")
    ).toBe(8);

    db.close();
  });

  it("re-running 0010 is idempotent and leaves the campaign published", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const snapshot = () => ({
      questions: count(db, "SELECT COUNT(*) c FROM Question"),
      options: count(db, "SELECT COUNT(*) c FROM QuestionOption"),
      config: count(db, "SELECT COUNT(*) c FROM CampaignQuestionConfig"),
      campaignExecs: count(
        db,
        "SELECT COUNT(*) c FROM CampaignExecutive WHERE campaignId = 'camp-001'"
      ),
      activeExecs: count(db, "SELECT COUNT(*) c FROM Executive WHERE isActive = 1"),
      questionSnapshots: count(
        db,
        "SELECT COUNT(*) c FROM CampaignQuestionSnapshot WHERE campaignId = 'camp-001'"
      ),
      optionSnapshots: count(
        db,
        "SELECT COUNT(*) c FROM CampaignQuestionOptionSnapshot"
      ),
      status: (
        db.prepare("SELECT status FROM Campaign WHERE id = 'camp-001'").get() as {
          status: string;
        }
      ).status,
    });

    const before = snapshot();
    applyMigration(db, "0010_ms_forms_survey.sql");
    applyMigration(db, "0010_ms_forms_survey.sql");
    const after = snapshot();

    expect(after).toEqual(before);
    expect(after).toEqual({
      questions: 15,
      options: 75,
      config: 15,
      campaignExecs: 13,
      activeExecs: 13,
      questionSnapshots: 15,
      optionSnapshots: 75,
      status: "active",
    });

    db.close();
  });

  it("keeps the reporting indexes and flags every new option", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    // No agreement-scale option survives the v2 bank.
    expect(
      count(db, `SELECT COUNT(*) c FROM QuestionOption WHERE value = 'agree_strongly'`)
    ).toBe(0);

    // Every scored option of the new bank carries its sentiment flags.
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM QuestionOption
         WHERE score IS NOT NULL AND isExcludedFromCalculation = 0
           AND isFavorable = 0 AND isUnfavorable = 0`
      )
    ).toBe(15);
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM QuestionOption
         WHERE score IS NOT NULL AND isFavorable = 1 AND isUnfavorable = 1`
      )
    ).toBe(0);

    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (
           'idx_Response_campaignId_responseType_questionSnapshotId',
           'idx_Response_campaignId_executiveId_responseType',
           'idx_CampaignQuestionSnapshot_campaignId_categoryCode',
           'idx_ParticipationLedger_campaignId_participationType_status'
         )`
      )
      .all() as Array<{ name: string }>;
    expect(indexes.length).toBe(4);

    db.close();
  });
});
