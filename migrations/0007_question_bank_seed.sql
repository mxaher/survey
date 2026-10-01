-- ============================================================
-- APPROVED QUESTION BANK (seed, idempotent)
--
-- 36 questions + 3 answer scales for the three reportable surveys:
--   * 20 executive/leadership questions  (scope = executive)
--   * 13 organization work-environment  (scope = organization)
--   * 3 future-priority questions        (scope = organization, choice)
--
-- Idempotency key: Question.code (UNIQUE) + deterministic option ids, so
-- re-running this file never creates duplicates and never clobbers an
-- administrator's edits (INSERT OR IGNORE only).
--
-- Also (re)wires the development demo campaign `camp-001` to exactly this
-- bank and returns it to `draft` with the spec default reporting threshold
-- (7) so the assignment can be reviewed before the next activation.
-- ============================================================

-- ------------------------------------------------------------
-- 1. QUESTIONS
-- ------------------------------------------------------------
-- chunk 1/3 (12 rows; split to stay within D1's per-statement compound-SELECT limit)
INSERT OR IGNORE INTO Question
  (id, code, questionAr, questionType, section, dimension,
   categoryCode, categoryAr, scaleCode, scope,
   isRequired, displayOrder, maxSelections, isActive, version)
VALUES
  ('q_LEAD_RESPECT_01', 'LEAD_RESPECT_01',
   'يتعامل المسؤول مع الموظفين باحترام ومهنية.',
   'scale', 'leadership', 'respect_professionalism',
   'respect_professionalism', 'الاحترام والمهنية', 'FREQUENCY_SCALE_AR', 'executive', 1, 10, NULL, 1, 1),
  ('q_LEAD_RESPECT_02', 'LEAD_RESPECT_02',
   'يحافظ المسؤول على كرامة الموظفين عند مناقشة الأخطاء أو الملاحظات.',
   'scale', 'leadership', 'respect_professionalism',
   'respect_professionalism', 'الاحترام والمهنية', 'FREQUENCY_SCALE_AR', 'executive', 1, 20, NULL, 1, 1),
  ('q_LEAD_FAIRNESS_01', 'LEAD_FAIRNESS_01',
   'يطبق المسؤول السياسات والإجراءات بعدالة واتساق.',
   'scale', 'leadership', 'fairness_objectivity',
   'fairness_objectivity', 'العدالة والموضوعية', 'FREQUENCY_SCALE_AR', 'executive', 1, 30, NULL, 1, 1),
  ('q_LEAD_FAIRNESS_02', 'LEAD_FAIRNESS_02',
   'يتخذ المسؤول قراراته بناءً على معايير واضحة ومهنية دون تحيز.',
   'scale', 'leadership', 'fairness_objectivity',
   'fairness_objectivity', 'العدالة والموضوعية', 'FREQUENCY_SCALE_AR', 'executive', 1, 40, NULL, 1, 1),
  ('q_LEAD_COMMUNICATION_01', 'LEAD_COMMUNICATION_01',
   'يوضح المسؤول الأولويات والتوقعات المطلوبة من الموظفين.',
   'scale', 'leadership', 'communication_clarity',
   'communication_clarity', 'وضوح التواصل', 'FREQUENCY_SCALE_AR', 'executive', 1, 50, NULL, 1, 1),
  ('q_LEAD_COMMUNICATION_02', 'LEAD_COMMUNICATION_02',
   'يشارك المسؤول المعلومات المهمة في الوقت المناسب.',
   'scale', 'leadership', 'communication_clarity',
   'communication_clarity', 'وضوح التواصل', 'FREQUENCY_SCALE_AR', 'executive', 1, 60, NULL, 1, 1),
  ('q_LEAD_COMMUNICATION_03', 'LEAD_COMMUNICATION_03',
   'يشرح المسؤول أسباب القرارات التي تؤثر على العمل عند الحاجة.',
   'scale', 'leadership', 'communication_clarity',
   'communication_clarity', 'وضوح التواصل', 'FREQUENCY_SCALE_AR', 'executive', 1, 70, NULL, 1, 1),
  ('q_LEAD_LISTENING_01', 'LEAD_LISTENING_01',
   'يستمع المسؤول إلى آراء الموظفين وملاحظاتهم.',
   'scale', 'leadership', 'listening_psychological_safety',
   'listening_psychological_safety', 'الاستماع والأمان النفسي', 'FREQUENCY_SCALE_AR', 'executive', 1, 80, NULL, 1, 1),
  ('q_LEAD_LISTENING_02', 'LEAD_LISTENING_02',
   'يستطيع الموظف طرح رأي مهني مختلف دون الخوف من رد فعل سلبي.',
   'scale', 'leadership', 'listening_psychological_safety',
   'listening_psychological_safety', 'الاستماع والأمان النفسي', 'FREQUENCY_SCALE_AR', 'executive', 1, 90, NULL, 1, 1),
  ('q_LEAD_LISTENING_03', 'LEAD_LISTENING_03',
   'يتعامل المسؤول مع الملاحظات بطريقة بناءة.',
   'scale', 'leadership', 'listening_psychological_safety',
   'listening_psychological_safety', 'الاستماع والأمان النفسي', 'FREQUENCY_SCALE_AR', 'executive', 1, 100, NULL, 1, 1),
  ('q_LEAD_FOLLOWUP_01', 'LEAD_FOLLOWUP_01',
   'يتتبع المسؤول تنفيذ القرارات والمهام حتى اكتمالها.',
   'scale', 'leadership', 'followup_problem_solving',
   'followup_problem_solving', 'المتابعة وحل المشكلات', 'FREQUENCY_SCALE_AR', 'executive', 1, 110, NULL, 1, 1),
  ('q_LEAD_DEVELOPMENT_01', 'LEAD_DEVELOPMENT_01',
   'يساعد المسؤول الموظفين على فهم فرص النمو المهني.',
   'scale', 'leadership', 'development_knowledge_transfer',
   'development_knowledge_transfer', 'التطوير ونقل المعرفة', 'FREQUENCY_SCALE_AR', 'executive', 1, 120, NULL, 1, 1);

-- chunk 2/3 (12 rows; split to stay within D1's per-statement compound-SELECT limit)
INSERT OR IGNORE INTO Question
  (id, code, questionAr, questionType, section, dimension,
   categoryCode, categoryAr, scaleCode, scope,
   isRequired, displayOrder, maxSelections, isActive, version)
VALUES
  ('q_LEAD_DEVELOPMENT_02', 'LEAD_DEVELOPMENT_02',
   'يوفر المسؤول فرصاً لتطوير مهارات الموظفين ونقل المعرفة.',
   'scale', 'leadership', 'development_knowledge_transfer',
   'development_knowledge_transfer', 'التطوير ونقل المعرفة', 'FREQUENCY_SCALE_AR', 'executive', 1, 130, NULL, 1, 1),
  ('q_LEAD_RECOGNITION_01', 'LEAD_RECOGNITION_01',
   'يقدر المسؤول الإنجازات والجهود بصورة مناسبة.',
   'scale', 'leadership', 'recognition_motivation',
   'recognition_motivation', 'التقدير والتحفيز', 'FREQUENCY_SCALE_AR', 'executive', 1, 140, NULL, 1, 1),
  ('q_LEAD_RECOGNITION_02', 'LEAD_RECOGNITION_02',
   'يشجع المسؤول الموظفين على تقديم الأفضل عبر التقدير والتحفيز.',
   'scale', 'leadership', 'recognition_motivation',
   'recognition_motivation', 'التقدير والتحفيز', 'FREQUENCY_SCALE_AR', 'executive', 1, 150, NULL, 1, 1),
  ('q_LEAD_ACCOUNTABILITY_01', 'LEAD_ACCOUNTABILITY_01',
   'يتحمل المسؤول مسؤولية قراراته ونتائجها.',
   'scale', 'leadership', 'accountability',
   'accountability', 'المساءلة', 'FREQUENCY_SCALE_AR', 'executive', 1, 160, NULL, 1, 1),
  ('q_LEAD_ACCOUNTABILITY_02', 'LEAD_ACCOUNTABILITY_02',
   'يطبق المسؤول المساءلة على الجميع بعدالة.',
   'scale', 'leadership', 'accountability',
   'accountability', 'المساءلة', 'FREQUENCY_SCALE_AR', 'executive', 1, 170, NULL, 1, 1),
  ('q_LEAD_COLLABORATION_01', 'LEAD_COLLABORATION_01',
   'يشجع المسؤول التعاون بين أعضاء الفريق.',
   'scale', 'leadership', 'collaboration',
   'collaboration', 'التعاون', 'FREQUENCY_SCALE_AR', 'executive', 1, 180, NULL, 1, 1),
  ('q_LEAD_COLLABORATION_02', 'LEAD_COLLABORATION_02',
   'يساعد المسؤول على إزالة العوائق التي تؤثر على أداء الفريق.',
   'scale', 'leadership', 'collaboration',
   'collaboration', 'التعاون', 'FREQUENCY_SCALE_AR', 'executive', 1, 190, NULL, 1, 1),
  ('q_LEAD_IMPACT_01', 'LEAD_IMPACT_01',
   'تسهم قرارات المسؤول في تحسين أداء الفريق وبيئة العمل.',
   'scale', 'leadership', 'leadership_impact',
   'leadership_impact', 'أثر القيادة', 'FREQUENCY_SCALE_AR', 'executive', 1, 200, NULL, 1, 1),
  ('q_ENV_RESPECT_01', 'ENV_RESPECT_01',
   'أشعر أن بيئة العمل تحترم الموظفين وتحافظ على كرامتهم.',
   'scale', 'environment', 'org_respect_safety',
   'org_respect_safety', 'الاحترام والسلامة', 'FREQUENCY_SCALE_AR', 'organization', 1, 10, NULL, 1, 1),
  ('q_ENV_SAFETY_01', 'ENV_SAFETY_01',
   'أستطيع التعبير عن رأيي المهني دون الخوف من رد فعل سلبي.',
   'scale', 'environment', 'org_respect_safety',
   'org_respect_safety', 'الاحترام والسلامة', 'FREQUENCY_SCALE_AR', 'organization', 1, 20, NULL, 1, 1),
  ('q_ENV_FAIRNESS_01', 'ENV_FAIRNESS_01',
   'يتم التعامل مع الموظفين بعدالة في القرارات والتقييم.',
   'scale', 'environment', 'org_fairness_performance',
   'org_fairness_performance', 'العدالة والأداء', 'FREQUENCY_SCALE_AR', 'organization', 1, 30, NULL, 1, 1),
  ('q_ENV_PERFORMANCE_01', 'ENV_PERFORMANCE_01',
   'تساعدني بيئة العمل على تقديم أفضل أداء لدي.',
   'scale', 'environment', 'org_fairness_performance',
   'org_fairness_performance', 'العدالة والأداء', 'FREQUENCY_SCALE_AR', 'organization', 1, 40, NULL, 1, 1);

-- chunk 3/3 (12 rows; split to stay within D1's per-statement compound-SELECT limit)
INSERT OR IGNORE INTO Question
  (id, code, questionAr, questionType, section, dimension,
   categoryCode, categoryAr, scaleCode, scope,
   isRequired, displayOrder, maxSelections, isActive, version)
VALUES
  ('q_ENV_TARGETS_01', 'ENV_TARGETS_01',
   'أملك وضوحاً كافياً حول الأهداف والمؤشرات المطلوبة مني.',
   'scale', 'environment', 'org_fairness_performance',
   'org_fairness_performance', 'العدالة والأداء', 'FREQUENCY_SCALE_AR', 'organization', 1, 50, NULL, 1, 1),
  ('q_ENV_COMMUNICATION_01', 'ENV_COMMUNICATION_01',
   'تصل المعلومات المهمة إلى الموظفين بوضوح وفي الوقت المناسب.',
   'scale', 'environment', 'org_communication_collaboration',
   'org_communication_collaboration', 'التواصل والتعاون', 'FREQUENCY_SCALE_AR', 'organization', 1, 60, NULL, 1, 1),
  ('q_ENV_COLLABORATION_01', 'ENV_COLLABORATION_01',
   'يوجد تعاون فعال بين الإدارات المختلفة.',
   'scale', 'environment', 'org_communication_collaboration',
   'org_communication_collaboration', 'التواصل والتعاون', 'FREQUENCY_SCALE_AR', 'organization', 1, 70, NULL, 1, 1),
  ('q_ENV_ISSUES_01', 'ENV_ISSUES_01',
   'يتم التعامل مع المشكلات والشكاوى بجدية وسرعة.',
   'scale', 'environment', 'org_communication_collaboration',
   'org_communication_collaboration', 'التواصل والتعاون', 'FREQUENCY_SCALE_AR', 'organization', 1, 80, NULL, 1, 1),
  ('q_ENV_CAREER_01', 'ENV_CAREER_01',
   'توجد فرص واضحة للتطور والترقي داخل المؤسسة.',
   'scale', 'environment', 'org_development_recognition',
   'org_development_recognition', 'التطوير والتقدير', 'FREQUENCY_SCALE_AR', 'organization', 1, 90, NULL, 1, 1),
  ('q_ENV_RECOGNITION_01', 'ENV_RECOGNITION_01',
   'يتم تقدير الجهود والإنجازات بصورة عادلة.',
   'scale', 'environment', 'org_development_recognition',
   'org_development_recognition', 'التطوير والتقدير', 'FREQUENCY_SCALE_AR', 'organization', 1, 100, NULL, 1, 1),
  ('q_ENV_TRAINING_01', 'ENV_TRAINING_01',
   'تتوفر برامج تدريبية تساعدني على بناء مهاراتي.',
   'scale', 'environment', 'org_development_recognition',
   'org_development_recognition', 'التطوير والتقدير', 'FREQUENCY_SCALE_AR', 'organization', 1, 110, NULL, 1, 1),
  ('q_ENV_ALIGNMENT_01', 'ENV_ALIGNMENT_01',
   'أفهم بدوري ما هو متوقع مني في وظيفتي.',
   'scale', 'environment', 'org_alignment_retention',
   'org_alignment_retention', 'الانسجام والاستبقاء', 'FREQUENCY_SCALE_AR', 'organization', 1, 120, NULL, 1, 1),
  ('q_ENV_RETENTION_01', 'ENV_RETENTION_01',
   'تشعرني بيئة العمل بالانتماء والرغبة في الاستمرار في العمل داخل المؤسسة.',
   'scale', 'environment', 'org_alignment_retention',
   'org_alignment_retention', 'الانسجام والاستبقاء', 'FREQUENCY_SCALE_AR', 'organization', 1, 130, NULL, 1, 1),
  ('q_FUTURE_PRIORITY_TOP_3', 'FUTURE_PRIORITY_TOP_3',
   'ما أهم ثلاثة جوانب تحتاج إلى تحسين خلال الفترة القادمة؟',
   'multi_choice', 'future', NULL,
   'future_priorities', 'أولويات التحسين', 'MULTI_CHOICE_TOP_3_AR', 'organization', 1, 10, 3, 1, 1),
  ('q_FUTURE_LEADERSHIP_BEHAVIOR', 'FUTURE_LEADERSHIP_BEHAVIOR',
   'ما السلوك الإداري الأكثر أهمية بالنسبة لك؟',
   'single_choice', 'future', NULL,
   'future_leadership', 'السلوك الإداري المطلوب', 'SINGLE_CHOICE_PRIORITY_AR', 'organization', 1, 20, 1, 1, 1),
  ('q_FUTURE_DESIRED_WORK_ENVIRONMENT', 'FUTURE_DESIRED_WORK_ENVIRONMENT',
   'ما بيئة العمل التي ترغب في أن نصل إليها؟',
   'multi_choice', 'future', NULL,
   'future_work_environment', 'بيئة العمل المستهدفة', 'MULTI_CHOICE_TOP_3_AR', 'organization', 1, 30, 3, 1, 1);

-- ------------------------------------------------------------
-- 2. ANSWER SCALES
--    (a) FREQUENCY_SCALE_AR → the 33 scored questions
-- ------------------------------------------------------------
-- D1 rejects a compound SELECT with more than 5 terms
-- ("too many terms in compound SELECT"), so every scale is inserted in
-- chunks of 5 rows. INSERT OR IGNORE keeps the chunks idempotent.
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT
  'opt_' || q.code || '_' || s.value,
  q.id,
  s.value,
  s.labelAr,
  s.score,
  s.ord,
  s.fav,
  s.unfav,
  s.excl,
  1
FROM Question q
JOIN (
  SELECT 'always' AS value, 'دائماً' AS labelAr, 5 AS score, 1 AS ord, 1 AS fav, 0 AS unfav, 0 AS excl
  UNION ALL SELECT 'often', 'غالباً', 4, 2, 1, 0, 0
  UNION ALL SELECT 'sometimes', 'أحياناً', 3, 3, 0, 0, 0
  UNION ALL SELECT 'rarely', 'نادراً', 2, 4, 0, 1, 0
  UNION ALL SELECT 'never', 'أبداً', 1, 5, 0, 1, 0
) s
WHERE (q.code GLOB 'LEAD_*' OR q.code GLOB 'ENV_*')
  AND q.questionType = 'scale';

INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT
  'opt_' || q.code || '_' || s.value,
  q.id,
  s.value,
  s.labelAr,
  s.score,
  s.ord,
  s.fav,
  s.unfav,
  s.excl,
  1
FROM Question q
JOIN (
  SELECT 'not_applicable' AS value, 'لا ينطبق / لا أملك معلومات كافية' AS labelAr, NULL AS score, 6 AS ord, 0 AS fav, 0 AS unfav, 1 AS excl
) s
WHERE (q.code GLOB 'LEAD_*' OR q.code GLOB 'ENV_*')
  AND q.questionType = 'scale';

--    (b) MULTI_CHOICE_TOP_3_AR → FUTURE_PRIORITY_TOP_3 (12 options)
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, NULL, s.ord, 0, 0, 0, 1
FROM Question q
JOIN (
  SELECT 'clarity_communication' AS value, 'وضوح القرارات والتواصل الداخلي' AS labelAr, 1 AS ord
  UNION ALL SELECT 'fairness_policy_application', 'العدالة وتطبيق السياسات', 2
  UNION ALL SELECT 'employee_recognition', 'تقدير الموظفين والاعتراف بجهودهم', 3
  UNION ALL SELECT 'career_growth', 'فرص التطور والترقي', 4
  UNION ALL SELECT 'inter_department_collaboration', 'التعاون بين الإدارات', 5
) s
WHERE q.code = 'FUTURE_PRIORITY_TOP_3';

INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, NULL, s.ord, 0, 0, 0, 1
FROM Question q
JOIN (
  SELECT 'leadership_style' AS value, 'أسلوب القيادة والإدارة' AS labelAr, 6 AS ord
  UNION ALL SELECT 'workload_pressure', 'توزيع الأعباء وضغط العمل', 7
  UNION ALL SELECT 'issue_resolution_speed', 'سرعة معالجة المشكلات', 8
  UNION ALL SELECT 'training_capability_building', 'التدريب وبناء القدرات', 9
  UNION ALL SELECT 'role_clarity', 'وضوح الأدوار والمسؤوليات', 10
) s
WHERE q.code = 'FUTURE_PRIORITY_TOP_3';

INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, NULL, s.ord, 0, 0, 0, 1
FROM Question q
JOIN (
  SELECT 'systems_technology' AS value, 'الأنظمة والتقنية' AS labelAr, 11 AS ord
  UNION ALL SELECT 'incentives_benefits', 'الحوافز والمزايا', 12
) s
WHERE q.code = 'FUTURE_PRIORITY_TOP_3';

--    (c) SINGLE_CHOICE_PRIORITY_AR → FUTURE_LEADERSHIP_BEHAVIOR (10 options)
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, NULL, s.ord, 0, 0, 0, 1
FROM Question q
JOIN (
  SELECT 'respect' AS value, 'الاحترام' AS labelAr, 1 AS ord
  UNION ALL SELECT 'clarity', 'الوضوح', 2
  UNION ALL SELECT 'fairness', 'العدالة', 3
  UNION ALL SELECT 'listening', 'الاستماع', 4
  UNION ALL SELECT 'empowerment', 'التمكين', 5
) s
WHERE q.code = 'FUTURE_LEADERSHIP_BEHAVIOR';

INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, NULL, s.ord, 0, 0, 0, 1
FROM Question q
JOIN (
  SELECT 'professional_discipline' AS value, 'الحزم المهني' AS labelAr, 6 AS ord
  UNION ALL SELECT 'recognition', 'التقدير', 7
  UNION ALL SELECT 'development', 'التطوير', 8
  UNION ALL SELECT 'response_speed', 'سرعة الاستجابة', 9
  UNION ALL SELECT 'accountability', 'تحمل المسؤولية', 10
) s
WHERE q.code = 'FUTURE_LEADERSHIP_BEHAVIOR';

--    (d) MULTI_CHOICE_TOP_3_AR → FUTURE_DESIRED_WORK_ENVIRONMENT (8 options)
INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, NULL, s.ord, 0, 0, 0, 1
FROM Question q
JOIN (
  SELECT 'fair_orderly' AS value, 'بيئة عادلة ومنظمة' AS labelAr, 1 AS ord
  UNION ALL SELECT 'collaborative', 'بيئة تعاونية', 2
  UNION ALL SELECT 'innovative', 'بيئة مبتكرة', 3
  UNION ALL SELECT 'results_focused', 'بيئة تركز على النتائج', 4
  UNION ALL SELECT 'development_oriented', 'بيئة تهتم بتطوير الموظفين', 5
) s
WHERE q.code = 'FUTURE_DESIRED_WORK_ENVIRONMENT';

INSERT OR IGNORE INTO QuestionOption
  (id, questionId, value, labelAr, score, displayOrder,
   isFavorable, isUnfavorable, isExcludedFromCalculation, isActive)
SELECT 'opt_' || q.code || '_' || s.value, q.id, s.value, s.labelAr, NULL, s.ord, 0, 0, 0, 1
FROM Question q
JOIN (
  SELECT 'transparent' AS value, 'بيئة تتسم بالشفافية' AS labelAr, 6 AS ord
  UNION ALL SELECT 'safe_expression', 'بيئة آمنة للتعبير عن الرأي', 7
  UNION ALL SELECT 'work_life_balance', 'بيئة تحقق توازناً بين الأداء ورفاه الموظف', 8
) s
WHERE q.code = 'FUTURE_DESIRED_WORK_ENVIRONMENT';

-- ------------------------------------------------------------
-- 3. DEMO CAMPAIGN — assign exactly this bank
-- ------------------------------------------------------------
-- Drop assignments that are not part of the approved bank (the legacy
-- 50-question library), keep everything else untouched.
DELETE FROM CampaignQuestionConfig
WHERE campaignId = 'camp-001'
  AND questionId NOT IN (SELECT id FROM Question
                         WHERE code GLOB 'LEAD_*' OR code GLOB 'ENV_*' OR code GLOB 'FUTURE_*');

INSERT OR IGNORE INTO CampaignQuestionConfig
  (campaignId, questionId, scope, isRequired, displayOrder)
SELECT 'camp-001', q.id, q.scope, q.isRequired, q.displayOrder
FROM Question q
WHERE (q.code GLOB 'LEAD_*' OR q.code GLOB 'ENV_*' OR q.code GLOB 'FUTURE_*')
  AND q.isCurrent = 1
  AND q.deletedAt IS NULL
  AND q.isActive = 1;

-- Return the demo campaign to draft (spec: admin reviews the assignment,
-- then activates) and apply the default reporting threshold.
UPDATE Campaign
SET status = 'draft',
    minimumReportingThreshold = 7,
    updatedAt = datetime('now')
WHERE id = 'camp-001';

-- Stale snapshots from the previous activation are invalid once the
-- assignment changes; they are regenerated on the next activation.
DELETE FROM CampaignQuestionSnapshot WHERE campaignId = 'camp-001';
