-- ============================================================
-- QUESTION BANK v2 — the approved 15 leadership questions
--
-- Replaces every previously seeded question with the 15 statements
-- supplied for this release (each with its own five choices):
--
--   * removes the legacy library seeded by `0002_seed.sql`
--     (L01–L36 leadership, E01–E10 environment, F01–F04 future) and the
--     36-question bank seeded by `0007_question_bank_seed.sql`;
--   * seeds 15 `scale` questions (`LEAD_Q01` … `LEAD_Q15`), 5 options each
--     = 75 options — no free-text, no multi/single choice;
--   * reports stay question-level: `dimension` / `categoryCode` /
--     `categoryAr` are intentionally NULL (the report groups only when a
--     question carries a category);
--   * re-wires the demo campaign `camp-001` to exactly these 15 questions
--     and switches off the environment / future surveys, which no longer
--     have any questions in the library.
--
-- Scoring is database-driven (spec §9):
--   scores 5 / 4 / 3 / 2 for the four substantive options, `NULL` for
--   "لا ينطبق / لا أستطيع التقييم" (excluded from every average, favourable
--   and unfavourable rate). Sentiment flags:
--     frequency scale : دائماً + غالباً favourable, أحياناً neutral, أبداً unfavourable
--     degree scales   : top option favourable, second neutral, bottom two unfavourable
--
-- Idempotency key: `Question.code` (UNIQUE) + deterministic option ids
-- (`opt_<code>_<value>`), INSERT OR IGNORE only — re-running never
-- duplicates rows and never clobbers an administrator's edits.
-- ============================================================

-- ------------------------------------------------------------
-- 1. REMOVE THE PREVIOUSLY SEEDED QUESTIONS
--    (options + campaign assignments first, so the delete does not
--     depend on the foreign-key pragma being enabled).
--    The v2 questions (`LEAD_Q01` … `LEAD_Q15`) are never touched, so the
--    statement below is safe to re-run: administrator edits survive.
--    The scope of the removal — everything `0002` + `0007` ever seeded —
--    is spelled out as a subquery and reused by every statement.
-- ------------------------------------------------------------
DELETE FROM QuestionOption
WHERE questionId IN (
  SELECT id FROM Question
  WHERE (code GLOB 'LEAD_*' OR code GLOB 'ENV_*' OR code GLOB 'FUTURE_*'
         OR code GLOB 'L[0-9][0-9]' OR code GLOB 'E[0-9][0-9]' OR code GLOB 'F[0-9][0-9]')
    AND code NOT GLOB 'LEAD_Q[0-9][0-9]'
);

DELETE FROM CampaignQuestionConfig
WHERE questionId IN (
  SELECT id FROM Question
  WHERE (code GLOB 'LEAD_*' OR code GLOB 'ENV_*' OR code GLOB 'FUTURE_*'
         OR code GLOB 'L[0-9][0-9]' OR code GLOB 'E[0-9][0-9]' OR code GLOB 'F[0-9][0-9]')
    AND code NOT GLOB 'LEAD_Q[0-9][0-9]'
);

DELETE FROM Question
WHERE (code GLOB 'LEAD_*' OR code GLOB 'ENV_*' OR code GLOB 'FUTURE_*'
       OR code GLOB 'L[0-9][0-9]' OR code GLOB 'E[0-9][0-9]' OR code GLOB 'F[0-9][0-9]')
  AND code NOT GLOB 'LEAD_Q[0-9][0-9]';

-- ------------------------------------------------------------
-- 2. QUESTIONS — 15 rows, chunked to stay well inside D1's
--    per-statement compound-SELECT term budget.
--    (id, code, questionAr, questionType, section, dimension,
--     categoryCode, categoryAr, scaleCode, scope,
--     isRequired, displayOrder, maxSelections, isActive, version)
-- ------------------------------------------------------------
INSERT OR IGNORE INTO Question
  (id, code, questionAr, questionType, section, dimension,
   categoryCode, categoryAr, scaleCode, scope,
   isRequired, displayOrder, maxSelections, isActive, version)
VALUES
  ('q_LEAD_Q01', 'LEAD_Q01',
   'هل تعامله مع زملاءه مبنى على معايير ثابته وواضحة؟',
   'scale', 'leadership', NULL, NULL, NULL, 'FREQUENCY_4_SCALE_AR', 'executive', 1, 10, NULL, 1, 1),
  ('q_LEAD_Q02', 'LEAD_Q02',
   'هل يقود مسيرة تطوير أساليب وأنظمة العمل المعمول بها في الإدارة/الشركة؟',
   'scale', 'leadership', NULL, NULL, NULL, 'DEGREE_SCALE_AR', 'executive', 1, 20, NULL, 1, 1),
  ('q_LEAD_Q03', 'LEAD_Q03',
   'هل يقوم بنشر الطاقة الإيجابية في المكان؟',
   'scale', 'leadership', NULL, NULL, NULL, 'FREQUENCY_4_SCALE_AR', 'executive', 1, 30, NULL, 1, 1),
  ('q_LEAD_Q04', 'LEAD_Q04',
   'هل يتحمل نتائج أخطاء فريق عمله امام المستوى الأعلى، أم يتنصل من المسؤولية؟',
   'scale', 'leadership', NULL, NULL, NULL, 'ACCOUNTABILITY_SCALE_AR', 'executive', 1, 40, NULL, 1, 1),
  ('q_LEAD_Q05', 'LEAD_Q05',
   'ما مدى اظهار دعمه وانتماؤه للشركة سواء بشكل مباشر او من خلال منصات التواصل الاجتماعي؟',
   'scale', 'leadership', NULL, NULL, NULL, 'DEGREE_SCALE_AR', 'executive', 1, 50, NULL, 1, 1);

INSERT OR IGNORE INTO Question
  (id, code, questionAr, questionType, section, dimension,
   categoryCode, categoryAr, scaleCode, scope,
   isRequired, displayOrder, maxSelections, isActive, version)
VALUES
  ('q_LEAD_Q06', 'LEAD_Q06',
   'ما تأثيره على مستوى نسبة ولاءك وانتماءك للشركة؟',
   'scale', 'leadership', NULL, NULL, NULL, 'IMPACT_SCALE_AR', 'executive', 1, 60, NULL, 1, 1),
  ('q_LEAD_Q07', 'LEAD_Q07',
   'ما احتمالية رغبتك بالاستمرار بالعمل معه سواء داخل الشركة او خارجها؟',
   'scale', 'leadership', NULL, NULL, NULL, 'LIKELIHOOD_SCALE_AR', 'executive', 1, 70, NULL, 1, 1),
  ('q_LEAD_Q08', 'LEAD_Q08',
   'ما مدى مساهمته في خلق حلول مهنية فورية تساهم في حل المشكلة دون تصعيدها للمستوى الأعلى؟',
   'scale', 'leadership', NULL, NULL, NULL, 'DEGREE_SCALE_AR', 'executive', 1, 80, NULL, 1, 1),
  ('q_LEAD_Q09', 'LEAD_Q09',
   'ما مدى مساهمته في دعمك لاتمام مسؤولياتك ومهامك على اكمل وجه؟',
   'scale', 'leadership', NULL, NULL, NULL, 'DEGREE_SCALE_AR', 'executive', 1, 90, NULL, 1, 1),
  ('q_LEAD_Q10', 'LEAD_Q10',
   'هل يساهم في توضيح تفاصيل المهام الموكله لك؟',
   'scale', 'leadership', NULL, NULL, NULL, 'FREQUENCY_4_SCALE_AR', 'executive', 1, 100, NULL, 1, 1);

INSERT OR IGNORE INTO Question
  (id, code, questionAr, questionType, section, dimension,
   categoryCode, categoryAr, scaleCode, scope,
   isRequired, displayOrder, maxSelections, isActive, version)
VALUES
  ('q_LEAD_Q11', 'LEAD_Q11',
   'إلى أي مدى يساهم المدير في نقل معرفته وخبراته إلى فرق العمل وتطوير قدراتهم؟',
   'scale', 'leadership', NULL, NULL, NULL, 'DEGREE_SCALE_AR', 'executive', 1, 110, NULL, 1, 1),
  ('q_LEAD_Q12', 'LEAD_Q12',
   'هل يتميز بالتعاون والعمل الجماعي المثمر بما يحقق مصلحة الشركة مع الإدارات الأخرى',
   'scale', 'leadership', NULL, NULL, NULL, 'DEGREE_SCALE_AR', 'executive', 1, 120, NULL, 1, 1),
  ('q_LEAD_Q13', 'LEAD_Q13',
   'هل يهتم بمتابعة تفاصيل الاعمال الموكله اليك وفحص النتائج المقدمة منك؟',
   'scale', 'leadership', NULL, NULL, NULL, 'FREQUENCY_4_SCALE_AR', 'executive', 1, 130, NULL, 1, 1),
  ('q_LEAD_Q14', 'LEAD_Q14',
   'هل يتابع معك بشكل منظم المهام الموكلة لك لتتمكن من انهاؤها في الوقت المحدد؟',
   'scale', 'leadership', NULL, NULL, NULL, 'FREQUENCY_4_SCALE_AR', 'executive', 1, 140, NULL, 1, 1),
  ('q_LEAD_Q15', 'LEAD_Q15',
   'هل يظهر تقديره المعنوى لمن يستحق؟',
   'scale', 'leadership', NULL, NULL, NULL, 'FREQUENCY_4_SCALE_AR', 'executive', 1, 150, NULL, 1, 1);

-- ------------------------------------------------------------
-- 3. OPTIONS — 5 per question (4 scored + "لا ينطبق" excluded)
--    (id, questionId, value, labelAr, score, displayOrder,
--     isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
-- ------------------------------------------------------------

-- (a) Frequency scale: LEAD_Q01, Q03, Q10, Q13, Q14, Q15 (4 × 6 = 24 rows)
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, s.score, s.ord,
       s.fav, s.unfav, s.excl, 1
FROM Question q
JOIN (
  SELECT 'always' AS value, 'دائماً' AS labelAr, 5 AS score, 1 AS ord, 1 AS fav, 0 AS unfav, 0 AS excl
  UNION ALL SELECT 'often', 'غالباً', 4, 2, 1, 0, 0
  UNION ALL SELECT 'sometimes', 'أحياناً', 3, 3, 0, 0, 0
  UNION ALL SELECT 'never', 'أبداً', 2, 4, 0, 1, 0
) s
WHERE q.code IN ('LEAD_Q01','LEAD_Q03','LEAD_Q10','LEAD_Q13','LEAD_Q14','LEAD_Q15');

-- (b) Degree scale — shared first three options:
--     LEAD_Q02, Q05, Q08, Q09, Q11, Q12 (3 × 6 = 18 rows)
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, s.score, s.ord,
       s.fav, s.unfav, s.excl, 1
FROM Question q
JOIN (
  SELECT 'degree_high' AS value, 'بدرجة كبيرة' AS labelAr, 5 AS score, 1 AS ord, 1 AS fav, 0 AS unfav, 0 AS excl
  UNION ALL SELECT 'degree_medium', 'بدرجة متوسطة', 4, 2, 0, 0, 0
  UNION ALL SELECT 'degree_low', 'بدرجة قليلة', 3, 3, 0, 1, 0
) s
WHERE q.code IN ('LEAD_Q02','LEAD_Q05','LEAD_Q08','LEAD_Q09','LEAD_Q11','LEAD_Q12');

-- (b2) Degree scale — the question-specific fourth option (6 rows)
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_degree_none', q.id, 'degree_none', s.labelAr, 2, 4, 0, 1, 0, 1
FROM Question q
JOIN (
  SELECT 'LEAD_Q02' AS qcode, 'لا يساهم في تطوير أساليب وأنظمة العمل' AS labelAr
  UNION ALL SELECT 'LEAD_Q05', 'لا يظهر دعماً أو انتماءً واضحاً للشركة'
  UNION ALL SELECT 'LEAD_Q08', 'لا يساهم في ايجاد حلول مهنية فورية'
  UNION ALL SELECT 'LEAD_Q09', 'لا يقدم الدعم'
  UNION ALL SELECT 'LEAD_Q11', 'لا يساهم إطلاقا'
  UNION ALL SELECT 'LEAD_Q12', 'لا يتميز بالتعاون والعمل الجماعي'
) s ON s.qcode = q.code
WHERE q.code IN ('LEAD_Q02','LEAD_Q05','LEAD_Q08','LEAD_Q09','LEAD_Q11','LEAD_Q12');

-- (c) Accountability scale — LEAD_Q04 (4 rows)
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, s.score, s.ord,
       s.fav, s.unfav, s.excl, 1
FROM Question q
JOIN (
  SELECT 'accountability_full' AS value, 'يتحمل المسؤولية بشكل كامل' AS labelAr, 5 AS score, 1 AS ord, 1 AS fav, 0 AS unfav, 0 AS excl
  UNION ALL SELECT 'accountability_sometimes', 'يتحمل المسؤولية أحياناً', 4, 2, 0, 0, 0
  UNION ALL SELECT 'accountability_rarely', 'نادراً ما يتحمل المسؤولية', 3, 3, 0, 1, 0
  UNION ALL SELECT 'accountability_disowns', 'يتنصل من المسؤولية', 2, 4, 0, 1, 0
) s
WHERE q.code = 'LEAD_Q04';

-- (d) Impact scale — LEAD_Q06 (4 rows)
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, s.score, s.ord,
       s.fav, s.unfav, s.excl, 1
FROM Question q
JOIN (
  SELECT 'impact_high' AS value, 'تأثير كبير' AS labelAr, 5 AS score, 1 AS ord, 1 AS fav, 0 AS unfav, 0 AS excl
  UNION ALL SELECT 'impact_medium', 'تأثير متوسط', 4, 2, 0, 0, 0
  UNION ALL SELECT 'impact_low', 'تأثير بسيط', 3, 3, 0, 1, 0
  UNION ALL SELECT 'impact_negative', 'تأثير سلبي', 2, 4, 0, 1, 0
) s
WHERE q.code = 'LEAD_Q06';

-- (e) Likelihood scale — LEAD_Q07 (4 rows)
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, s.score, s.ord,
       s.fav, s.unfav, s.excl, 1
FROM Question q
JOIN (
  SELECT 'likelihood_high' AS value, 'احتمالية عالية' AS labelAr, 5 AS score, 1 AS ord, 1 AS fav, 0 AS unfav, 0 AS excl
  UNION ALL SELECT 'likelihood_medium', 'احتمالية متوسطة', 4, 2, 0, 0, 0
  UNION ALL SELECT 'likelihood_low', 'احتمالية بسيطة', 3, 3, 0, 1, 0
  UNION ALL SELECT 'likelihood_none', 'لا أرغب بالاستمرار بالعمل معه', 2, 4, 0, 1, 0
) s
WHERE q.code = 'LEAD_Q07';

-- (f) Excluded option for every question (15 rows):
--     stored, reported separately, never scored.
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_not_applicable', q.id, 'not_applicable',
       'لا ينطبق / لا أستطيع التقييم', NULL, 5, 0, 0, 1, 1
FROM Question q
WHERE q.code GLOB 'LEAD_Q[0-9][0-9]';

-- ------------------------------------------------------------
-- 4. DEMO CAMPAIGN — assign exactly these 15 questions
--    Stale rows (left over from the previous bank, including orphans when
--    the foreign-key pragma is off) are dropped; the new ones are added
--    with INSERT OR IGNORE so an administrator's ordering survives a re-run.
-- ------------------------------------------------------------
DELETE FROM CampaignQuestionConfig
WHERE campaignId = 'camp-001'
  AND questionId NOT IN (SELECT id FROM Question WHERE code GLOB 'LEAD_Q[0-9][0-9]');

INSERT OR IGNORE INTO CampaignQuestionConfig
  (campaignId, questionId, scope, isRequired, displayOrder)
SELECT 'camp-001', q.id, q.scope, q.isRequired, q.displayOrder
FROM Question q
WHERE q.code GLOB 'LEAD_Q[0-9][0-9]'
  AND q.isCurrent = 1
  AND q.deletedAt IS NULL
  AND q.isActive = 1;

-- Frozen snapshots belong to the assignment they were taken from. Drop them
-- only while the campaign holds no responses — a campaign that already
-- collected answers keeps its immutable history (reports stay readable).
DELETE FROM CampaignQuestionSnapshot
WHERE campaignId = 'camp-001'
  AND NOT EXISTS (SELECT 1 FROM Response WHERE campaignId = 'camp-001');

-- The bank no longer contains environment or future questions, so the demo
-- campaign must not offer those steps (the feature itself stays available:
-- an administrator can re-enable the toggles after adding questions).
UPDATE Campaign
SET enableEnvironmentSurvey = 0,
    enableFutureSurvey = 0,
    status = CASE
      WHEN status = 'active'
       AND NOT EXISTS (SELECT 1 FROM Response WHERE campaignId = 'camp-001')
      THEN 'draft'
      ELSE status
    END,
    updatedAt = datetime('now')
WHERE id = 'camp-001';
