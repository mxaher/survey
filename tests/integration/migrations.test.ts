import { describe, it, expect } from "bun:test";
import {
  openMemoryDb,
  applyMigrations,
  applyMigration,
} from "../helpers/d1";

const BANK_GLOB = "(code GLOB 'LEAD_*' OR code GLOB 'ENV_*' OR code GLOB 'FUTURE_*')";

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
    ]);
    db.close();
  });

  it("seeds exactly 36 approved questions with their categories", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const bankQuestions = count(
      db,
      `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB}`
    );
    expect(bankQuestions).toBe(36);

    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND section = 'leadership'`)
    ).toBe(20);
    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND section = 'environment'`)
    ).toBe(13);
    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND section = 'future'`)
    ).toBe(3);

    // Every question carries a category + a scope; no free-text question types.
    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND (categoryCode IS NULL OR categoryAr IS NULL)`)
    ).toBe(0);
    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND scope NOT IN ('executive','organization')`)
    ).toBe(0);
    expect(
      count(db, `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND questionType NOT IN ('scale','yes_no','single_choice','multi_choice')`)
    ).toBe(0);

    // Category coverage: 10 leadership + 5 environment + 3 future = 18.
    const categoryCount = count(
      db,
      `SELECT COUNT(DISTINCT categoryCode) c FROM Question WHERE ${BANK_GLOB}`
    );
    expect(categoryCount).toBe(18);

    db.close();
  });

  it("seeds the three answer scales with the correct option flags", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    // 33 frequency-scale questions x 6 options + 12 + 10 + 8 choice options.
    const optionCount = count(
      db,
      `SELECT COUNT(*) c FROM QuestionOption o JOIN Question q ON q.id = o.questionId WHERE ${BANK_GLOB}`
    );
    expect(optionCount).toBe(228);

    const scored = count(
      db,
      `SELECT COUNT(*) c FROM Question WHERE ${BANK_GLOB} AND questionType = 'scale'`
    );
    expect(scored).toBe(33);
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM Question q JOIN QuestionOption o ON o.questionId = q.id
         WHERE ${BANK_GLOB} AND q.questionType = 'scale' AND o.value = 'always' AND o.isFavorable = 1 AND o.score = 5`
      )
    ).toBe(33);
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM Question q JOIN QuestionOption o ON o.questionId = q.id
         WHERE ${BANK_GLOB} AND q.questionType = 'scale' AND o.value = 'not_applicable'
           AND o.isExcludedFromCalculation = 1 AND o.score IS NULL`
      )
    ).toBe(33);

    // Choice questions: no scores, not favourable/unfavourable.
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM Question q JOIN QuestionOption o ON o.questionId = q.id
         WHERE ${BANK_GLOB} AND q.questionType IN ('multi_choice','single_choice')
           AND (o.score IS NOT NULL OR o.isFavorable = 1 OR o.isUnfavorable = 1)`
      )
    ).toBe(0);

    // Option counts per future question.
    const futureOptions = db
      .prepare(
        `SELECT q.code, COUNT(*) c FROM Question q JOIN QuestionOption o ON o.questionId = q.id
         WHERE ${BANK_GLOB} AND q.section = 'future' GROUP BY q.code ORDER BY q.code`
      )
      .all() as Array<{ code: string; c: number }>;
    expect(futureOptions).toEqual([
      { code: "FUTURE_DESIRED_WORK_ENVIRONMENT", c: 8 },
      { code: "FUTURE_LEADERSHIP_BEHAVIOR", c: 10 },
      { code: "FUTURE_PRIORITY_TOP_3", c: 12 },
    ]);

    db.close();
  });

  it("re-running the seed is idempotent (no duplicates, no clobbering)", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const before = {
      questions: count(db, "SELECT COUNT(*) c FROM Question"),
      options: count(db, "SELECT COUNT(*) c FROM QuestionOption"),
      config: count(db, "SELECT COUNT(*) c FROM CampaignQuestionConfig"),
    };

    applyMigration(db, "0007_question_bank_seed.sql");
    applyMigration(db, "0007_question_bank_seed.sql");

    const after = {
      questions: count(db, "SELECT COUNT(*) c FROM Question"),
      options: count(db, "SELECT COUNT(*) c FROM QuestionOption"),
      config: count(db, "SELECT COUNT(*) c FROM CampaignQuestionConfig"),
    };
    expect(after).toEqual(before);

    // An administrator edit survives a re-run (INSERT OR IGNORE only).
    db.prepare(
      `UPDATE Question SET questionAr = 'نص معدل' WHERE code = 'LEAD_RESPECT_01'`
    ).run();
    applyMigration(db, "0007_question_bank_seed.sql");
    const edited = db
      .prepare(`SELECT questionAr FROM Question WHERE code = 'LEAD_RESPECT_01'`)
      .get() as { questionAr: string };
    expect(edited.questionAr).toBe("نص معدل");

    db.close();
  });

  it("wires the demo campaign to the bank with threshold 7 and draft status", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const campaign = db
      .prepare(
        `SELECT status, minimumReportingThreshold, enableEnvironmentSurvey,
                enableFutureSurvey, allowMultipleExecutiveEvaluations, timezone
         FROM Campaign WHERE id = 'camp-001'`
      )
      .get() as Record<string, unknown>;
    expect(campaign.status).toBe("draft");
    expect(campaign.minimumReportingThreshold).toBe(7);
    expect(campaign.enableEnvironmentSurvey).toBe(1);
    expect(campaign.enableFutureSurvey).toBe(1);
    expect(campaign.allowMultipleExecutiveEvaluations).toBe(1);
    expect(campaign.timezone).toBe("Asia/Riyadh");

    // Exactly the approved bank is assigned, and nothing else.
    expect(
      count(db, `SELECT COUNT(*) c FROM CampaignQuestionConfig WHERE campaignId = 'camp-001'`)
    ).toBe(36);
    expect(
      count(
        db,
        `SELECT COUNT(*) c FROM CampaignQuestionConfig c JOIN Question q ON q.id = c.questionId
         WHERE c.campaignId = 'camp-001' AND NOT (${BANK_GLOB})`
      )
    ).toBe(0);
    expect(
      count(db, `SELECT COUNT(*) c FROM CampaignQuestionSnapshot WHERE campaignId = 'camp-001'`)
    ).toBe(0);

    // Assignment scope mirrors the question scope (executive vs organization).
    const scopes = db
      .prepare(
        `SELECT q.scope, COUNT(*) c FROM CampaignQuestionConfig c JOIN Question q ON q.id = c.questionId
         WHERE c.campaignId = 'camp-001' GROUP BY q.scope ORDER BY q.scope`
      )
      .all() as Array<{ scope: string; c: number }>;
    expect(scopes).toEqual([
      { scope: "executive", c: 20 },
      { scope: "organization", c: 16 },
    ]);

    db.close();
  });

  it("backfills reporting indexes and sentiment flags for legacy options", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    // Legacy agreement scale still classifies correctly after 0006.
    const agree = db
      .prepare(
        `SELECT isFavorable, isUnfavorable FROM QuestionOption WHERE value = 'agree_strongly' LIMIT 1`
      )
      .get() as { isFavorable: number; isUnfavorable: number };
    expect(agree.isFavorable).toBe(1);
    expect(agree.isUnfavorable).toBe(0);

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
