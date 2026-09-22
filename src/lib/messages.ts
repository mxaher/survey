/**
 * Arabic system messages (spec §4). Single source of truth so the UI
 * and the API both return the exact copy the spec mandates.
 */
export const MESSAGES = {
  duplicateCampaign: "تم تسجيل مشاركتك في هذا الاستبيان مسبقًا.",
  duplicateExecutive:
    "تم تسجيل تقييمك لهذا المسؤول مسبقًا، ولا يمكن إرسال تقييم آخر له ضمن هذه الحملة.",
  campaignClosed: "انتهت فترة المشاركة في هذا الاستبيان.",
  noActiveCampaign: "لا يوجد حالياً استبيان نشط للمشاركة.",
  incompleteAnswers: "يرجى استكمال جميع الأسئلة المطلوبة قبل إرسال الاستبيان.",
  unauthorized: "لا تملك صلاحية الوصول إلى هذا الاستبيان.",
  configIncomplete: "لا يمكن نشر الاستبيان قبل استكمال الإعدادات المطلوبة.",
  submissionSuccess:
    "تم تسجيل تقييمك بنجاح. شكراً لمساهمتك في تحسين بيئة العمل.",
  cannotEditActiveCampaign:
    "لا يمكن تعديل هيكل الاستبيان بعد بدء المشاركة حفاظاً على سلامة النتائج.",
  belowThreshold:
    "لا تتوفر بيانات كافية لعرض النتائج حالياً حفاظاً على سرية المشاركين.",
  deleteQuestionBlocked:
    "لا يمكن حذف هذا السؤال نهائياً لأنه مرتبط بحملة أو بنتائج سابقة. يمكنك تعطيله بدلاً من ذلك.",
  removeExecutiveFromActiveWithHistory:
    "لا يمكن حذف هذا المسؤول من السجلات التاريخية. سيتم إيقاف ظهوره للمشاركين مع الحفاظ على نتائجه السابقة.",
  confirmActivate:
    "أنت على وشك فتح الاستبيان أمام الموظفين. بعد بدء المشاركة لن تتمكن من حذف الأسئلة أو تعديل بنيتها أو إزالة المسؤولين الذين لديهم إجابات. هل تريد المتابعة؟",
  confirmDeleteQuestion:
    "هل أنت متأكد من حذف هذا السؤال؟ إذا كان مستخدماً في حملة أو مرتبطاً بنتائج سابقة، سيتم تعطيله بدلاً من حذفه نهائياً.",
  confirmRemoveManager:
    "هل تريد إزالة هذا المسؤول من الحملة؟ لن يتم حذف سجله العام، وسيظل متاحاً لإضافته لاحقاً.",
  confirmDeactivateExecWithHistory:
    "هذا المسؤول لديه نتائج سابقة. سيتم إيقاف ظهوره للمشاركين مع الاحتفاظ بنتائجه التاريخية. هل تريد المتابعة؟",
  previewBanner: "وضع المعاينة — لن يتم حفظ أي إجابات.",
  submitFinalWarning: "بعد إرسال الاستبيان لن تتمكن من إرسال مشاركة أخرى لهذا الاستبيان.",
  confirmCheckbox: "أؤكد أن إجاباتي تعكس رأيي المهني وتجربتي في بيئة العمل.",
  selectExecutivePrompt: "اختر المسؤول الذي ترغب في تقييمه",
  evaluatedManagersLabel: "المديرون الذين تم تقييمهم",
  alreadyEvaluatedLabel: "تم التقييم مسبقًا",
  reviewSubmit: "إرسال الاستبيان",
} as const;

export type MessageKey = keyof typeof MESSAGES;

/** Intro + privacy notices (spec §4). The UI shows the privacy statement
 * as written — but the README and the privacy-statement banner in the
 * admin Readiness screen call this out as "de-identified" if the
 * identity provider may retain logs outside the app's control. */
export const INTRO_COPY =
  "يهدف هذا الاستبيان إلى فهم مستوى بيئة العمل والقيادة داخل المؤسسة، وتحديد الجوانب التي تحتاج إلى تطوير. لن يتم طلب اسمك أو بريدك الإلكتروني ضمن إجابات الاستبيان، وستُعرض النتائج بصورة إجمالية لأغراض التحسين المؤسسي.";

export const PRIVACY_NOTICE =
  "إجابات الاستبيان غير مرتبطة بهوية الموظف داخل قاعدة بيانات النتائج، مع استخدام آلية منفصلة لمنع تكرار التقييم. (نظام تحويل الهوية إلى رمز غير قابل للربط بالإجابات.)";

export const APP_TITLE = "استبيان بيئة العمل والقيادة المؤسسية";
