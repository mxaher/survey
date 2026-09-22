/**
 * Behavioral dimensions (spec §10.1, §16).
 * Used both for question tagging and for reporting roll-ups.
 */
export const LEADERSHIP_DIMENSIONS = [
  { key: "respect",            labelAr: "الاحترام والمهنية" },
  { key: "fairness",           labelAr: "العدالة والاتساق" },
  { key: "communication",      labelAr: "التواصل" },
  { key: "listening_safety",   labelAr: "الاستماع والأمان النفسي" },
  { key: "empowerment",        labelAr: "التمكين والتفويض" },
  { key: "performance",        labelAr: "إدارة الأداء" },
  { key: "development",        labelAr: "التطوير والتقدير" },
  { key: "collaboration",      labelAr: "التعاون" },
  { key: "role_model",         labelAr: "القيادة بالقدوة" },
] as const;

export const ENVIRONMENT_DIMENSIONS = [
  { key: "respect_fairness",    labelAr: "الاحترام والعدالة" },
  { key: "communication",       labelAr: "التواصل" },
  { key: "leadership",          labelAr: "القيادة" },
  { key: "empowerment",         labelAr: "التمكين" },
  { key: "development",        labelAr: "التطوير" },
  { key: "collaboration",      labelAr: "التعاون" },
  { key: "psych_safety",       labelAr: "الأمان النفسي" },
  { key: "role_clarity",       labelAr: "وضوح الأدوار" },
] as const;

export const CAMPAIGN_STATUSES = [
  { key: "draft",     labelAr: "مسودة",       color: "secondary" },
  { key: "scheduled", labelAr: "مجدولة",     color: "default" },
  { key: "active",    labelAr: "نشطة",       color: "default" },
  { key: "closed",    labelAr: "مغلقة",      color: "default" },
  { key: "archived",  labelAr: "مؤرشفة",     color: "default" },
] as const;

export const EXECUTIVE_CATEGORIES = [
  { key: "ceo",              labelAr: "الرئيس التنفيذي" },
  { key: "executive",        labelAr: "مسؤول تنفيذي" },
  { key: "manager",          labelAr: "مدير" },
  { key: "department_head", labelAr: "رئيس قسم" },
] as const;

export const QUESTION_TYPES = [
  { key: "scale",          labelAr: "مقياس (5 درجات)" },
  { key: "yes_no",         labelAr: "نعم/لا/لا ينطبق" },
  { key: "single_choice",  labelAr: "اختيار واحد" },
  { key: "multi_choice",   labelAr: "اختيار متعدد" },
] as const;

export const QUESTION_SECTIONS = [
  { key: "environment", labelAr: "بيئة العمل" },
  { key: "leadership",  labelAr: "تقييم القيادات" },
  { key: "future",      labelAr: "البيئة المستقبلية" },
] as const;

export const QUESTION_SCOPES = [
  { key: "organization", labelAr: "على مستوى المؤسسة" },
  { key: "executive",    labelAr: "على مستوى المسؤول" },
  { key: "both",         labelAr: "كلاهما" },
] as const;

/**
 * Standard option sets — used as default seed values when creating
 * questions of these types. The score column is what feeds `selected_score`.
 * "not_applicable" is always excluded from averages.
 */
export const STANDARD_SCALES = {
  // 5(+1) leadership scale (spec §9)
  leadership: [
    { value: "always",           labelAr: "دائماً",        score: 5 },
    { value: "often",            labelAr: "غالباً",        score: 4 },
    { value: "sometimes",        labelAr: "أحياناً",       score: 3 },
    { value: "rarely",           labelAr: "نادراً",        score: 2 },
    { value: "never",            labelAr: "أبداً",         score: 1 },
    { value: "not_applicable",   labelAr: "لا ينطبق / لا أملك معلومات كافية", score: null },
  ],
  // environment agreement scale (spec §9)
  environment: [
    { value: "agree_strongly",   labelAr: "أوافق بشدة",   score: 5 },
    { value: "agree",            labelAr: "أوافق",        score: 4 },
    { value: "neutral",          labelAr: "محايد",        score: 3 },
    { value: "disagree",         labelAr: "لا أوافق",      score: 2 },
    { value: "disagree_strongly",labelAr: "لا أوافق بشدة", score: 1 },
  ],
  yes_no: [
    { value: "yes",             labelAr: "نعم",            score: 1 },
    { value: "no",              labelAr: "لا",             score: 0 },
    { value: "not_applicable",  labelAr: "لا ينطبق",       score: null },
  ],
} as const;

export const FAVORABLE_VALUES = new Set(["always", "often", "agree_strongly", "agree"]);
