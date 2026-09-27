-- Scoring / reporting schema for the approved question bank + report engine.
--
--   * Question gains categoryCode/categoryAr/scaleCode/scope so grouping is
--     schema-driven (spec: group report rows by category, not by a hardcoded
--     dimension list).
--   * QuestionOption gains the three sentiment flags that are the single
--     source of truth for favourable / unfavorable / excluded-from-average
--     classification (DB drives the scoring config — no hardcoded mapping in
--     more than one place).
--   * The frozen snapshot tables gain the same columns so reports stay
--     correct after the campaign is activated (snapshots are immutable).
--   * Reporting indexes for the aggregate queries.

-- ============================================================
-- 1. QUESTION — category / scale / scope
-- ============================================================
ALTER TABLE Question ADD COLUMN categoryCode TEXT;
ALTER TABLE Question ADD COLUMN categoryAr TEXT;
ALTER TABLE Question ADD COLUMN scaleCode TEXT;
ALTER TABLE Question ADD COLUMN scope TEXT NOT NULL DEFAULT 'organization';

-- ============================================================
-- 2. QUESTION OPTION — sentiment flags
-- ============================================================
ALTER TABLE QuestionOption ADD COLUMN isFavorable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE QuestionOption ADD COLUMN isUnfavorable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE QuestionOption ADD COLUMN isExcludedFromCalculation INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 3. FROZEN SNAPSHOTS — same columns, copied at activation time
-- ============================================================
ALTER TABLE CampaignQuestionSnapshot ADD COLUMN categoryCode TEXT;
ALTER TABLE CampaignQuestionSnapshot ADD COLUMN categoryAr TEXT;
ALTER TABLE CampaignQuestionSnapshot ADD COLUMN scaleCode TEXT;
ALTER TABLE CampaignQuestionSnapshot ADD COLUMN scope TEXT;

ALTER TABLE CampaignQuestionOptionSnapshot ADD COLUMN isFavorable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE CampaignQuestionOptionSnapshot ADD COLUMN isUnfavorable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE CampaignQuestionOptionSnapshot ADD COLUMN isExcludedFromCalculation INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 4. BACKFILL — existing rows
-- ============================================================
-- Sentiment for the scales already in the library (frequency + agreement).
-- neutral / محايد / yes / no stay "valid but neither favourable nor
-- unfavourable"; not_applicable is excluded from every average.
UPDATE QuestionOption
SET isFavorable = CASE
      WHEN value IN ('always', 'often', 'agree_strongly', 'agree') THEN 1
      ELSE 0
    END,
    isUnfavorable = CASE
      WHEN value IN ('rarely', 'never', 'disagree', 'disagree_strongly') THEN 1
      ELSE 0
    END,
    isExcludedFromCalculation = CASE
      WHEN value = 'not_applicable' THEN 1
      ELSE 0
    END
WHERE isFavorable = 0 AND isUnfavorable = 0 AND isExcludedFromCalculation = 0;

-- Existing questions: derive the grouping code from the legacy dimension so
-- reports can group every question through one code path. Arabic labels for
-- legacy dimensions are resolved in code (src/lib/constants.ts).
UPDATE Question SET categoryCode = dimension
WHERE categoryCode IS NULL AND dimension IS NOT NULL;

-- Scope of assignment: leadership questions are evaluated per executive.
UPDATE Question SET scope = 'executive'
WHERE section = 'leadership';

-- ============================================================
-- 5. INDEXES — report + participation lookups
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_Question_categoryCode ON Question(categoryCode);
CREATE INDEX IF NOT EXISTS idx_QuestionOption_questionId_isActive ON QuestionOption(questionId, isActive);

CREATE INDEX IF NOT EXISTS idx_CampaignQuestionSnapshot_campaignId_categoryCode
  ON CampaignQuestionSnapshot(campaignId, categoryCode);
CREATE INDEX IF NOT EXISTS idx_CampaignQuestionSnapshot_campaignId_section
  ON CampaignQuestionSnapshot(campaignId, section);

CREATE INDEX IF NOT EXISTS idx_Response_campaignId_responseType_questionSnapshotId
  ON Response(campaignId, responseType, questionSnapshotId);
CREATE INDEX IF NOT EXISTS idx_Response_campaignId_executiveId_responseType
  ON Response(campaignId, executiveId, responseType);
CREATE INDEX IF NOT EXISTS idx_Response_questionSnapshotId
  ON Response(questionSnapshotId);

CREATE INDEX IF NOT EXISTS idx_ParticipationLedger_campaignId_participationType_status
  ON ParticipationLedger(campaignId, participationType, status);
CREATE INDEX IF NOT EXISTS idx_ParticipationLedger_campaignId_executiveId
  ON ParticipationLedger(campaignId, executiveId);
