-- ============================================================
-- 0008 — PRIVACY HARDENING
-- ============================================================
--
-- 1. Break the participation-ledger <-> response link.
--
--    The submit handlers bound one `now` into BOTH the ParticipationLedger
--    insert and every Response insert, so Response.submittedAt was
--    byte-identical to ParticipationLedger.submittedAt for a given
--    submission. That made
--
--      JOIN Response ON campaignId = ... AND submittedAt = ...
--
--    sufficient to recover `employeeHmac -> responseGroupId -> all answers`.
--    No code reads Response.submittedAt (reporting, scoring, exports and
--    trend queries never reference it; the test fixture never sets it), so
--    the column is dropped outright — which also removes the link from rows
--    that already exist.
--
-- 2. Stop the employee-facing privacy notice being shadowed by stale
--    stored copies. Resolution order is:
--      Campaign.privacyNoticeAr -> SystemSetting('privacy_notice') -> PRIVACY_NOTICE
--    Both stored copies held the old default text, so an updated constant
--    would never reach the employee UI. Exact-match UPDATEs preserve any
--    notice an administrator has customised.
-- ============================================================

ALTER TABLE Response DROP COLUMN submittedAt;

UPDATE SystemSetting
   SET valueAr = 'يتحقق النظام من أهلية المشاركة فقط لمنع تكرار الإجابة. لا يتم حفظ الاسم أو البريد الإلكتروني أو الرقم الوظيفي مع إجاباتك، ولا تظهر النتائج إلا بصورة إجمالية وبعد الوصول إلى الحد الأدنى من المشاركات الذي يحمي سرية المشاركين.',
       updatedAt = datetime('now')
 WHERE key = 'privacy_notice'
   AND valueAr = 'إجابات الاستبيان غير مرتبطة بهوية الموظف داخل قاعدة بيانات النتائج، مع استخدام آلية منفصلة لمنع تكرار التقييم.';

UPDATE Campaign
   SET privacyNoticeAr = 'يتحقق النظام من أهلية المشاركة فقط لمنع تكرار الإجابة. لا يتم حفظ الاسم أو البريد الإلكتروني أو الرقم الوظيفي مع إجاباتك، ولا تظهر النتائج إلا بصورة إجمالية وبعد الوصول إلى الحد الأدنى من المشاركات الذي يحمي سرية المشاركين.'
 WHERE privacyNoticeAr = 'إجابات الاستبيان غير مرتبطة بهوية الموظف داخل قاعدة بيانات النتائج، مع استخدام آلية منفصلة لمنع تكرار التقييم. (نظام تحويل الهوية إلى رمز غير قابل للربط بالإجابات.)';
