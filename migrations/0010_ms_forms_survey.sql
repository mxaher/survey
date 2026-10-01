-- ============================================================
-- 0010 — MS FORMS PARITY: "استبيان الاستمرار في تطوير بيئة العمل"
--
-- Ports the Microsoft Forms executive survey
-- (https://forms.cloud.microsoft/r/gvGakjg2Ki) into the app verbatim:
--
--   1. QUESTIONS — the 15 approved statements, re-worded exactly as the
--      form renders them and re-ordered to the form's order
--      (displayOrder 10..150 = form items 1..15). Codes stay
--      `LEAD_Q01` … `LEAD_Q15`, so history, reports and admin links keep
--      pointing at the same rows.
--   2. OPTIONS — the form's five choices per question, label for label
--      ("دائما / غالبا / أحيانا / <question-specific negative> /
--       لا ينطبق / لا يمكنني التقييم"). Scores stay database-driven:
--      5 / 4 / 3 / 2 for the substantive choices, NULL for the
--      not-applicable choice (excluded from every average and rate).
--   3. EXECUTIVES — the 13 named executives replace the 8 seeded
--      placeholders (which are deactivated, not deleted).
--   4. CAMPAIGN `camp-001` — form title + description, every executive
--      assignable, environment/future sections off, question snapshots
--      frozen and the campaign activated so the survey is live as soon as
--      this migration is applied (no admin sign-in needed to respond).
--
-- Guard: the snapshot re-freeze + activation only run while the campaign
-- holds no responses. A campaign that already collected answers keeps its
-- immutable snapshot history (reports stay readable) and its status.
--
-- Idempotency: `INSERT OR IGNORE` + deterministic ids
-- (`opt_<code>_<value>`, `snap_<code>`, `snapopt_<code>_<value>`) +
-- `DELETE` before every option/snapshot insert — re-running produces the
-- same rows and never duplicates them.
-- ============================================================

-- ------------------------------------------------------------
-- 1. QUESTIONS — verbatim copy + form order + scale code.
--    (code, questionAr, scaleCode, displayOrder)
-- ------------------------------------------------------------
UPDATE Question SET questionAr = 'ما تأثيره على مستوى نسبة ولاءك وانتماءك للشركة؟',
                    scaleCode = 'IMPACT_SCALE_AR', displayOrder = 10,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q06';

UPDATE Question SET questionAr = 'ما احتمالية رغبتك بالاستمرار بالعمل معه سواء داخل الشركة او خارجها؟',
                    scaleCode = 'LIKELIHOOD_SCALE_AR', displayOrder = 20,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q07';

UPDATE Question SET questionAr = 'هل يقوم بنشر الطاقة الإيجابية في المكان؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 30,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q03';

UPDATE Question SET questionAr = 'هل يظهر تقديره المعنوى لمن يستحق؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 40,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q15';

UPDATE Question SET questionAr = 'هل يساهم في تطوير أساليب وأنظمة العمل المعمول بها في الإدارة/الشركة؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 50,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q02';

UPDATE Question SET questionAr = 'ما مدى اظهار دعمه وانتماؤه للشركة سواء بشكل مباشر او من خلال منصات التواصل الاجتماعي؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 60,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q05';

UPDATE Question SET questionAr = 'إلى أي مدى يدعم مستوى التوازن بين حياتك الشخصية والعملية من خلال تجنب التواصل معكخارج ساعات العمل وأيام إجازتك الرسمية (المجدولة)؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 70,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q10';

UPDATE Question SET questionAr = 'إلى أي مدى تعتقد أنه يساهم في العمل على تحقيق استراتيجية الشركة؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 80,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q14';

UPDATE Question SET questionAr = 'هل يتميز بالتعاون والعمل الجماعي المثمر مع الإدارات الأخرى بما يحقق مصلحة الشركة؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 90,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q12';

UPDATE Question SET questionAr = 'هل تعامله مع زملاءه مبنى على معايير ثابته وواضحة؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 100,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q01';

UPDATE Question SET questionAr = 'ما مدى مساهمته في خلق حلول مهنية فورية تساهم في حل المشكلة دون تصعيدها للمستوى الأعلى؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 110,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q08';

UPDATE Question SET questionAr = 'إلى أي مدى يساهم في نقل معرفته وخبراته إلى فريق العمل وتطوير قدراتهم؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 120,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q11';

UPDATE Question SET questionAr = 'ما مدى مساهمته في دعمك لاتمام مسؤولياتك ومهامك على اكمل وجه؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 130,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q09';

UPDATE Question SET questionAr = 'هل يتحقق من نتائج اعمالك قبل اعتمادها او تمريرها للمستوى الأعلى؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 140,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q13';

UPDATE Question SET questionAr = 'هل يتحمل نتائج أخطاء فريق عمله امام المستوى الأعلى، أم يتنصل من المسؤولية؟',
                    scaleCode = 'FREQUENCY_4_SCALE_AR', displayOrder = 150,
                    questionType = 'scale', section = 'leadership', scope = 'executive',
                    isRequired = 1, isActive = 1, deletedAt = NULL, updatedAt = datetime('now')
WHERE code = 'LEAD_Q04';

-- ------------------------------------------------------------
-- 2. OPTIONS — drop the previous answer set, then re-seed the form's
--    five choices per question (75 rows total).
--    `Response` stores `selectedValue` only (no FK to the option rows) and
--    the campaign's snapshots are re-frozen below, so this is safe.
-- ------------------------------------------------------------
DELETE FROM QuestionOption
WHERE questionId IN (SELECT id FROM Question WHERE code GLOB 'LEAD_Q[0-9][0-9]');

-- (a) Shared first three choices of the 13 frequency questions
--     (3 × 13 = 39 rows): دائما / غالبا / أحيانا.
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, s.score, s.ord,
       s.fav, s.unfav, s.excl, 1
FROM Question q
JOIN (
  SELECT 'always' AS value, 'دائما' AS labelAr, 5 AS score, 1 AS ord, 1 AS fav, 0 AS unfav, 0 AS excl
  UNION ALL SELECT 'often', 'غالبا', 4, 2, 1, 0, 0
  UNION ALL SELECT 'sometimes', 'أحيانا', 3, 3, 0, 0, 0
) s
WHERE q.code IN ('LEAD_Q01','LEAD_Q02','LEAD_Q03','LEAD_Q04','LEAD_Q05',
                 'LEAD_Q08','LEAD_Q09','LEAD_Q10','LEAD_Q11','LEAD_Q12',
                 'LEAD_Q13','LEAD_Q14','LEAD_Q15');

-- (b) The question-specific fourth choice of those 13 questions (13 rows).
--     D1 caps a compound SELECT at 5 terms, so this runs in 3 chunks.
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_never', q.id, 'never', m.labelAr, 2, 4, 0, 1, 0, 1
FROM Question q
JOIN (
  SELECT 'LEAD_Q01' AS code, 'غير عادل' AS labelAr
  UNION ALL SELECT 'LEAD_Q02', 'لا يساهم أبدا'
  UNION ALL SELECT 'LEAD_Q03', 'ينشر الطاقة السلبية'
  UNION ALL SELECT 'LEAD_Q04', 'لا يتحمل المسؤولية'
  UNION ALL SELECT 'LEAD_Q05', 'لا يدعم الشركة'
) m ON m.code = q.code;

INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_never', q.id, 'never', m.labelAr, 2, 4, 0, 1, 0, 1
FROM Question q
JOIN (
  SELECT 'LEAD_Q08' AS code, 'لا يساهم أبدا' AS labelAr
  UNION ALL SELECT 'LEAD_Q09', 'لا يساهم أبدا'
  UNION ALL SELECT 'LEAD_Q10', 'لا يدعم'
  UNION ALL SELECT 'LEAD_Q11', 'لا يساهم أبدا'
  UNION ALL SELECT 'LEAD_Q12', 'غير متعاون'
) m ON m.code = q.code;

INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_never', q.id, 'never', m.labelAr, 2, 4, 0, 1, 0, 1
FROM Question q
JOIN (
  SELECT 'LEAD_Q13' AS code, 'لا يتحقق اطلاقا' AS labelAr
  UNION ALL SELECT 'LEAD_Q14', 'لا يساهم أبدا'
  UNION ALL SELECT 'LEAD_Q15', 'لا يظهر اطلاقا'
) m ON m.code = q.code;

-- (c) Item 1 — loyalty/impact (4 rows).
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, s.score, s.ord,
       s.fav, s.unfav, s.excl, 1
FROM Question q
JOIN (
  SELECT 'impact_high' AS value, 'إيجابي جدا' AS labelAr, 5 AS score, 1 AS ord, 1 AS fav, 0 AS unfav, 0 AS excl
  UNION ALL SELECT 'impact_medium', 'إيجابي', 4, 2, 1, 0, 0
  UNION ALL SELECT 'impact_low', 'لا يؤثر', 3, 3, 0, 0, 0
  UNION ALL SELECT 'impact_negative', 'تأثير سلبي', 2, 4, 0, 1, 0
) s
WHERE q.code = 'LEAD_Q06';

-- (d) Item 2 — intent to stay (4 rows).
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, s.score, s.ord,
       s.fav, s.unfav, s.excl, 1
FROM Question q
JOIN (
  SELECT 'likelihood_high' AS value, 'عالية' AS labelAr, 5 AS score, 1 AS ord, 1 AS fav, 0 AS unfav, 0 AS excl
  UNION ALL SELECT 'likelihood_medium', 'متوسطة', 4, 2, 0, 0, 0
  UNION ALL SELECT 'likelihood_low', 'ضعيفة', 3, 3, 0, 1, 0
  UNION ALL SELECT 'likelihood_none', 'لا ارغب', 2, 4, 0, 1, 0
) s
WHERE q.code = 'LEAD_Q07';

-- (e) The not-applicable choice of every question (15 rows) — stored,
--     reported separately, never scored.
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_not_applicable', q.id, 'not_applicable',
       'لا ينطبق / لا يمكنني التقييم', NULL, 5, 0, 0, 1, 1
FROM Question q
WHERE q.code GLOB 'LEAD_Q[0-9][0-9]';

-- ------------------------------------------------------------
-- 3. EXECUTIVES — the 13 named executives replace the 8 placeholders.
--    The placeholders are deactivated (kept for history), never deleted:
--    `Response` / `ParticipationLedger` may still reference them.
-- ------------------------------------------------------------
UPDATE Executive
SET isActive = 0, deletedAt = datetime('now'), updatedAt = datetime('now')
WHERE id IN ('exec-001','exec-002','exec-003','exec-004',
             'exec-005','exec-006','exec-007','exec-008')
  AND isActive = 1;

INSERT OR IGNORE INTO Executive
  (id, nameAr, titleAr, category, departmentAr, displayOrder, isActive, createdAt, updatedAt)
VALUES
  ('exec-101', 'م. سعد القحطاني',    'الإدارة التنفيذية', 'executive', NULL, 0, 1, datetime('now'), datetime('now')),
  ('exec-102', 'أ. محمد المطيري',     'الإدارة التنفيذية', 'executive', NULL, 1, 1, datetime('now'), datetime('now')),
  ('exec-103', 'أ. محمد عبد الحميد',  'الإدارة التنفيذية', 'executive', NULL, 2, 1, datetime('now'), datetime('now')),
  ('exec-104', 'أ. عبدالاله المرشد',  'الإدارة التنفيذية', 'executive', NULL, 3, 1, datetime('now'), datetime('now')),
  ('exec-105', 'أ. منصور القعود',     'الإدارة التنفيذية', 'executive', NULL, 4, 1, datetime('now'), datetime('now')),
  ('exec-106', 'أ. معتصم العقاد',     'الإدارة التنفيذية', 'executive', NULL, 5, 1, datetime('now'), datetime('now')),
  ('exec-107', 'أ. فهد الحازمي',      'الإدارة التنفيذية', 'executive', NULL, 6, 1, datetime('now'), datetime('now')),
  ('exec-108', 'م. محمد زاهر',        'الإدارة التنفيذية', 'executive', NULL, 7, 1, datetime('now'), datetime('now')),
  ('exec-109', 'أ. أمتياز أحمد',      'الإدارة التنفيذية', 'executive', NULL, 8, 1, datetime('now'), datetime('now')),
  ('exec-110', 'أ. محمد خضر',         'الإدارة التنفيذية', 'executive', NULL, 9, 1, datetime('now'), datetime('now')),
  ('exec-111', 'م. عوض الغوازي',      'الإدارة التنفيذية', 'executive', NULL, 10, 1, datetime('now'), datetime('now')),
  ('exec-112', 'د. محمد بطران',       'الإدارة التنفيذية', 'executive', NULL, 11, 1, datetime('now'), datetime('now')),
  ('exec-113', 'أ. ليلى السهلي',      'الإدارة التنفيذية', 'executive', NULL, 12, 1, datetime('now'), datetime('now'));

-- Replace the campaign roster (stale rows dropped first so a re-run is a
-- no-op rather than an accumulating union of both rosters).
DELETE FROM CampaignExecutive WHERE campaignId = 'camp-001';

INSERT OR IGNORE INTO CampaignExecutive
  (campaignId, executiveId, displayOrder, isEnabled, createdAt, updatedAt)
SELECT 'camp-001', e.id, e.displayOrder, 1, datetime('now'), datetime('now')
FROM Executive e
WHERE e.id IN ('exec-101','exec-102','exec-103','exec-104','exec-105','exec-106',
               'exec-107','exec-108','exec-109','exec-110','exec-111','exec-112','exec-113')
ORDER BY e.displayOrder;

-- ------------------------------------------------------------
-- 4. CAMPAIGN — the form's title/description, all 13 executives
--    assignable (no ceiling), leadership section only.
-- ------------------------------------------------------------
UPDATE Campaign
SET titleAr = 'استبيان الاستمرار في تطوير بيئة العمل',
    descriptionAr = 'يهدف هذا الاستبيان للتعرف على تفاصيل تجربة الموظف وعلاقته بالإدارة التنفيذية، وفهم الجوانب التي تسهم في توفير بيئة عمل أكثر جاذبية وتعاون مستمر بين الموظف والمدير وتطوير مفهوم روح العائلة الواحدة، بالإضافة إلى التعرف على الجوانب التي يمكن تطويرها مستقبلا.',
    instructionsAr = 'تُجب على جميع الأسئلة بناءً على تجربتك المباشرة مع المسؤول. الإجابة مجهولة الهوية بالكامل ولا يمكن ربطها بأي موظف.',
    enableEnvironmentSurvey = 0,
    enableFutureSurvey = 0,
    allowMultipleExecutiveEvaluations = 1,
    minExecutives = 1,
    maxExecutives = NULL,
    startsAt = '2026-09-24T00:00:00Z',
    endsAt = '2027-12-31T23:59:59Z',
    updatedAt = datetime('now')
WHERE id = 'camp-001';

-- ------------------------------------------------------------
-- 5. FREEZE + ACTIVATE — only while the campaign holds no responses.
--    Deterministic snapshot ids make the block idempotent; the guards keep
--    an answered campaign's immutable history untouched.
-- ------------------------------------------------------------
DELETE FROM CampaignQuestionOptionSnapshot
WHERE campaignQuestionSnapshotId IN (
        SELECT id FROM CampaignQuestionSnapshot WHERE campaignId = 'camp-001')
  AND NOT EXISTS (SELECT 1 FROM Response WHERE campaignId = 'camp-001');

DELETE FROM CampaignQuestionSnapshot
WHERE campaignId = 'camp-001'
  AND NOT EXISTS (SELECT 1 FROM Response WHERE campaignId = 'camp-001');

INSERT OR IGNORE INTO CampaignQuestionSnapshot
  (id, campaignId, originalQuestionId, questionCode, questionAr, questionType,
   section, dimension, isRequired, displayOrder, maxSelections,
   categoryCode, categoryAr, scaleCode, scope, createdAt)
SELECT 'snap_' || q.code, 'camp-001', q.id, q.code, q.questionAr, q.questionType,
       q.section, q.dimension, c.isRequired, q.displayOrder, q.maxSelections,
       q.categoryCode, q.categoryAr, q.scaleCode, q.scope, datetime('now')
FROM CampaignQuestionConfig c
JOIN Question q ON q.id = c.questionId
WHERE c.campaignId = 'camp-001'
  AND q.isActive = 1
  AND q.deletedAt IS NULL;

INSERT OR IGNORE INTO CampaignQuestionOptionSnapshot
  (id, campaignQuestionSnapshotId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, createdAt)
SELECT 'snapopt_' || q.code || '_' || o.value, 'snap_' || q.code,
       o.value, o.labelAr, o.score, o.displayOrder,
       o.isFavorable, o.isUnfavorable, o.isExcludedFromCalculation, datetime('now')
FROM Question q
JOIN QuestionOption o ON o.questionId = q.id
WHERE q.code GLOB 'LEAD_Q[0-9][0-9]'
  AND o.isActive = 1;

UPDATE Campaign
SET status = 'active',
    activatedAt = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    updatedAt = datetime('now')
WHERE id = 'camp-001'
  AND NOT EXISTS (SELECT 1 FROM Response WHERE campaignId = 'camp-001');
