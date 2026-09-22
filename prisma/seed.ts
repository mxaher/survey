/**
 * Seed data (spec §10, §22) — runs against the Prisma SQLite database.
 *
 * Usage:
 *   bun run db:push
 *   bun run db:seed   (add this script to package.json if you want)
 *   or: bun run prisma/seed.ts
 *
 * Idempotent: safe to run multiple times. Uses `code` uniqueness for
 * questions, `externalId` for executives, and `titleAr` for the demo
 * campaign to dedupe.
 */
import { db } from "../src/lib/db";
import { STANDARD_SCALES } from "../src/lib/constants";

// ---- 1. Executives (spec §22) ----
const EXECUTIVES = [
  { nameAr: "الرئيس التنفيذي",                            titleAr: "الرئيس التنفيذي",                   category: "ceo",              departmentAr: "الإدارة العليا" },
  { nameAr: "المدير التنفيذي للعمليات",                 titleAr: "المدير التنفيذي للعمليات",         category: "executive",        departmentAr: "العمليات" },
  { nameAr: "المدير التنفيذي للمالية",                   titleAr: "المدير التنفيذي للمالية",           category: "executive",        departmentAr: "المالية" },
  { nameAr: "مدير إدارة الموارد البشرية",                titleAr: "مدير إدارة الموارد البشرية",       category: "manager",          departmentAr: "الموارد البشرية" },
  { nameAr: "مدير إدارة تقنية المعلومات",               titleAr: "مدير إدارة تقنية المعلومات",       category: "manager",          departmentAr: "تقنية المعلومات" },
  { nameAr: "مدير إدارة العقارات",                       titleAr: "مدير إدارة العقارات",              category: "manager",          departmentAr: "العقارات" },
  { nameAr: "مدير إدارة المقاولات",                       titleAr: "مدير إدارة المقاولات",              category: "manager",          departmentAr: "المقاولات" },
  { nameAr: "مدير إدارة المعدات الكهربائية",             titleAr: "مدير إدارة المعدات الكهربائية",    category: "manager",          departmentAr: "المعدات الكهربائية" },
];

// ---- 2. Leadership questions (spec §10.1, 36 items) ----
const LEADERSHIP_QUESTIONS: { code: string; text: string; dimension: string }[] = [
  // الاحترام والمهنية (1-3)
  { code: "L01", text: "يتعامل المسؤول مع الموظفين باحترام ومهنية.",                                    dimension: "respect" },
  { code: "L02", text: "يحافظ المسؤول على كرامة الموظفين عند مناقشة الأخطاء أو الملاحظات.",          dimension: "respect" },
  { code: "L03", text: "يتجنب المسؤول الأساليب التي قد تسبب الإحراج أو التخويف أو التقليل من شأن الموظف.", dimension: "respect" },
  // العدالة والاتساق (4-7)
  { code: "L04", text: "يطبق المسؤول السياسات والإجراءات بعدالة واتساق.",                            dimension: "fairness" },
  { code: "L05", text: "يتعامل المسؤول مع الحالات المتشابهة بطريقة متقاربة.",                          dimension: "fairness" },
  { code: "L06", text: "يتخذ المسؤول قراراته بناءً على معايير واضحة ومهنية.",                          dimension: "fairness" },
  { code: "L07", text: "لا يميز المسؤول بين الموظفين دون مبرر مهني واضح.",                              dimension: "fairness" },
  // التواصل (8-11)
  { code: "L08", text: "يوضح المسؤول الأولويات والتوقعات المطلوبة من الموظفين.",                     dimension: "communication" },
  { code: "L09", text: "يشارك المسؤول المعلومات المهمة في الوقت المناسب.",                            dimension: "communication" },
  { code: "L10", text: "يشرح المسؤول أسباب القرارات التي تؤثر على العمل عند الحاجة.",                  dimension: "communication" },
  { code: "L11", text: "يستخدم المسؤول أسلوباً واضحاً ومهنياً في التواصل.",                            dimension: "communication" },
  // الاستماع والأمان النفسي (12-15)
  { code: "L12", text: "يستمع المسؤول إلى آراء الموظفين وملاحظاتهم.",                                    dimension: "listening_safety" },
  { code: "L13", text: "يستطيع الموظف طرح رأي مهني مختلف دون الخوف من الانتقام.",                       dimension: "listening_safety" },
  { code: "L14", text: "يتعامل المسؤول مع الملاحظات بطريقة بناءة.",                                       dimension: "listening_safety" },
  { code: "L15", text: "يشجع المسؤول الموظفين على الإبلاغ عن المشكلات مبكراً.",                       dimension: "listening_safety" },
  // التمكين والتفويض (16-19)
  { code: "L16", text: "يمنح المسؤول الموظفين الصلاحيات المناسبة لإنجاز أعمالهم.",                    dimension: "empowerment" },
  { code: "L17", text: "يثق المسؤول بالموظفين عند تفويض المهام.",                                          dimension: "empowerment" },
  { code: "L18", text: "يتجنب المسؤول التدخل غير الضروري في التفاصيل التشغيلية.",                       dimension: "empowerment" },
  { code: "L19", text: "يوفر المسؤول التوجيه عند الحاجة دون إلغاء استقلالية الموظف.",                 dimension: "empowerment" },
  // إدارة الأداء (20-24)
  { code: "L20", text: "يوضح المسؤول معايير قياس الأداء.",                                                  dimension: "performance" },
  { code: "L21", text: "يقدم المسؤول ملاحظات مفيدة وفي الوقت المناسب.",                                  dimension: "performance" },
  { code: "L22", text: "يتعامل المسؤول مع ضعف الأداء بطريقة مهنية ومتدرجة.",                          dimension: "performance" },
  { code: "L23", text: "يطبق المساءلة على الجميع بعدالة.",                                                  dimension: "performance" },
  { code: "L24", text: "يميز المسؤول بين الأخطاء غير المقصودة وسلوك الإهمال المتكرر.",              dimension: "performance" },
  // التطوير والتقدير (25-28)
  { code: "L25", text: "يشجع المسؤول على التعلم والتطوير.",                                                dimension: "development" },
  { code: "L26", text: "يساعد المسؤول الموظفين على فهم فرص النمو المهني.",                              dimension: "development" },
  { code: "L27", text: "يقدر المسؤول الإنجازات والجهود بصورة مناسبة.",                                  dimension: "development" },
  { code: "L28", text: "يوجه المسؤول الموظفين لتحسين أدائهم بدلاً من الاكتفاء بالنقد.",            dimension: "development" },
  // التعاون (29-32)
  { code: "L29", text: "يشجع المسؤول التعاون بين أعضاء الفريق.",                                          dimension: "collaboration" },
  { code: "L30", text: "يتعاون المسؤول مع الإدارات الأخرى لتحقيق أهداف المؤسسة.",                     dimension: "collaboration" },
  { code: "L31", text: "يتعامل المسؤول مع الخلافات بطريقة مهنية.",                                         dimension: "collaboration" },
  { code: "L32", text: "يساعد المسؤول على إزالة العوائق التي تؤثر على أداء الفريق.",                dimension: "collaboration" },
  // القيادة بالقدوة (33-36)
  { code: "L33", text: "يلتزم المسؤول بالسلوكيات والقواعد التي يتوقعها من الموظفين.",                dimension: "role_model" },
  { code: "L34", text: "يتحمل المسؤول مسؤولية قراراته ونتائجها.",                                          dimension: "role_model" },
  { code: "L35", text: "يتصرف المسؤول بهدوء ومهنية في أوقات الضغط.",                                       dimension: "role_model" },
  { code: "L36", text: "يوازن المسؤول بين تحقيق النتائج والمحافظة على بيئة عمل صحية.",            dimension: "role_model" },
];

// ---- 3. Environment questions (spec §10.2, 10 items) ----
const ENVIRONMENT_QUESTIONS: { code: string; text: string; dimension: string }[] = [
  { code: "E01", text: "أشعر أن بيئة العمل تحترم الموظفين وتحافظ على كرامتهم.",            dimension: "respect_fairness" },
  { code: "E02", text: "أستطيع التعبير عن رأيي المهني بأمان.",                                   dimension: "psych_safety" },
  { code: "E03", text: "يتم التعامل مع الموظفين بعدالة.",                                          dimension: "respect_fairness" },
  { code: "E04", text: "تصل المعلومات المهمة إلى الموظفين بوضوح وفي الوقت المناسب.",        dimension: "communication" },
  { code: "E05", text: "يوجد تعاون فعال بين الإدارات.",                                            dimension: "collaboration" },
  { code: "E06", text: "يتم التعامل مع الأخطاء بهدف التعلم والتحسين.",                          dimension: "development" },
  { code: "E07", text: "يتم تقدير الجهود والإنجازات بصورة عادلة.",                              dimension: "development" },
  { code: "E08", text: "يتم التعامل مع المشكلات والشكاوى بجدية.",                              dimension: "psych_safety" },
  { code: "E09", text: "أعرف بوضوح ما هو متوقع مني في وظيفتي.",                                dimension: "role_clarity" },
  { code: "E10", text: "أشعر أن بيئة العمل تساعدني على تقديم أفضل أداء.",                    dimension: "leadership" },
];

// ---- 4. Future-environment questions (spec §10.3, 4 items, multi/single choice) ----
const FUTURE_QUESTIONS: {
  code: string;
  text: string;
  type: "multi_choice" | "single_choice";
  maxSelections?: number;
  options: { value: string; labelAr: string }[];
}[] = [
  {
    code: "F01",
    text: "أهم ثلاثة جوانب يجب تحسينها خلال الفترة القادمة (اختر حتى 3):",
    type: "multi_choice",
    maxSelections: 3,
    options: [
      { value: "decisions_comms",    labelAr: "وضوح القرارات والتواصل الداخلي" },
      { value: "fairness_policies",  labelAr: "العدالة وتطبيق السياسات" },
      { value: "recognition",        labelAr: "تقدير الموظفين والاعتراف بجهودهم" },
      { value: "growth_promotion",   labelAr: "فرص التطور والترقي" },
      { value: "interdept_collab",   labelAr: "التعاون بين الإدارات" },
      { value: "leadership_style",   labelAr: "أسلوب القيادة والإدارة" },
      { value: "workload_pressure",  labelAr: "توزيع الأعباء وضغط العمل" },
      { value: "issue_speed",        labelAr: "سرعة معالجة المشكلات" },
      { value: "training_capacity",  labelAr: "التدريب وبناء القدرات" },
      { value: "roles_clarity",      labelAr: "وضوح الأدوار والمسؤوليات" },
      { value: "systems_tech",       labelAr: "الأنظمة والتقنية" },
      { value: "incentives_benefits",labelAr: "الحوافز والمزايا" },
    ],
  },
  {
    code: "F02",
    text: "كيف تصف بيئة العمل التي ترغب في أن نصل إليها (اختر حتى 3):",
    type: "multi_choice",
    maxSelections: 3,
    options: [
      { value: "fair_organized",     labelAr: "بيئة عادلة ومنظمة" },
      { value: "collaborative",      labelAr: "بيئة تعاونية" },
      { value: "innovative",         labelAr: "بيئة مبتكرة" },
      { value: "results_focused",    labelAr: "بيئة تركز على النتائج" },
      { value: "people_development", labelAr: "بيئة تهتم بتطوير الموظفين" },
      { value: "transparent",        labelAr: "بيئة تتسم بالشفافية" },
      { value: "safe_expression",    labelAr: "بيئة آمنة للتعبير عن الرأي" },
      { value: "fast_decisions",     labelAr: "بيئة سريعة في اتخاذ القرار" },
      { value: "balance_wellbeing",  labelAr: "بيئة توازن بين الأداء ورفاه الموظف" },
    ],
  },
  {
    code: "F03",
    text: "ما السلوك الإداري الأكثر أهمية بالنسبة لك (اختر واحدًا):",
    type: "single_choice",
    options: [
      { value: "respect",         labelAr: "الاحترام" },
      { value: "clarity",         labelAr: "الوضوح" },
      { value: "fairness",        labelAr: "العدالة" },
      { value: "listening",       labelAr: "الاستماع" },
      { value: "empowerment",     labelAr: "التمكين" },
      { value: "professional_firmness", labelAr: "الحزم المهني" },
      { value: "recognition",     labelAr: "التقدير" },
      { value: "development",     labelAr: "التطوير" },
      { value: "responsiveness",   labelAr: "سرعة الاستجابة" },
      { value: "accountability",  labelAr: "تحمل المسؤولية" },
    ],
  },
  {
    code: "F04",
    text: "ما أهم نتيجة تتوقعها من هذا الاستبيان (اختر واحدًا):",
    type: "single_choice",
    options: [
      { value: "better_leadership",   labelAr: "تحسين أسلوب القيادة" },
      { value: "better_communication",labelAr: "تحسين التواصل الداخلي" },
      { value: "fairness_transparency", labelAr: "رفع مستوى العدالة والشفافية" },
      { value: "better_collaboration",labelAr: "تحسين التعاون بين الإدارات" },
      { value: "more_recognition",    labelAr: "زيادة تقدير الموظفين" },
      { value: "career_path",          labelAr: "تطوير التدريب والمسار المهني" },
      { value: "workload_balance",     labelAr: "تحسين توزيع الأعباء" },
      { value: "address_issues",      labelAr: "معالجة المشكلات المتكررة" },
    ],
  },
];

async function seedExecutives() {
  let order = 0;
  for (const e of EXECUTIVES) {
    const existing = await db.executive.findFirst({
      where: { nameAr: e.nameAr, titleAr: e.titleAr },
    });
    if (existing) continue;
    await db.executive.create({
      data: {
        nameAr: e.nameAr,
        titleAr: e.titleAr,
        category: e.category,
        departmentAr: e.departmentAr,
        displayOrder: order++,
        isActive: true,
      },
    });
  }
  console.log(`[seed] executives ensured`);
}

async function seedQuestions() {
  // Leadership
  let order = 1;
  for (const q of LEADERSHIP_QUESTIONS) {
    const existing = await db.question.findUnique({ where: { code: q.code } });
    if (existing) continue;
    const created = await db.question.create({
      data: {
        code: q.code,
        questionAr: q.text,
        questionType: "scale",
        section: "leadership",
        dimension: q.dimension,
        isRequired: true,
        displayOrder: order++,
        isActive: true,
        options: {
          create: STANDARD_SCALES.leadership.map((o, i) => ({
            value: o.value,
            labelAr: o.labelAr,
            score: o.score,
            displayOrder: i,
            isActive: true,
          })),
        },
      },
    });
    console.log(`[seed] question ${q.code} created (${created.id})`);
  }

  // Environment
  let eOrder = 1;
  for (const q of ENVIRONMENT_QUESTIONS) {
    const existing = await db.question.findUnique({ where: { code: q.code } });
    if (existing) continue;
    const created = await db.question.create({
      data: {
        code: q.code,
        questionAr: q.text,
        questionType: "scale",
        section: "environment",
        dimension: q.dimension,
        isRequired: true,
        displayOrder: eOrder++,
        isActive: true,
        options: {
          create: STANDARD_SCALES.environment.map((o, i) => ({
            value: o.value,
            labelAr: o.labelAr,
            score: o.score,
            displayOrder: i,
            isActive: true,
          })),
        },
      },
    });
    console.log(`[seed] question ${q.code} created (${created.id})`);
  }

  // Future
  let fOrder = 1;
  for (const q of FUTURE_QUESTIONS) {
    const existing = await db.question.findUnique({ where: { code: q.code } });
    if (existing) continue;
    const created = await db.question.create({
      data: {
        code: q.code,
        questionAr: q.text,
        questionType: q.type,
        section: "future",
        isRequired: true,
        displayOrder: fOrder++,
        maxSelections: q.maxSelections ?? null,
        isActive: true,
        options: {
          create: q.options.map((o, i) => ({
            value: o.value,
            labelAr: o.labelAr,
            score: null,
            displayOrder: i,
            isActive: true,
          })),
        },
      },
    });
    console.log(`[seed] question ${q.code} created (${created.id})`);
  }
}

async function seedDemoCampaign() {
  const title = "استبيان بيئة العمل والقيادة المؤسسية - نسخة تجريبية";
  let campaign = await db.campaign.findFirst({ where: { titleAr: title } });
  if (!campaign) {
    campaign = await db.campaign.create({
      data: {
        titleAr: title,
        descriptionAr:
          "حملة استبيان تجريبية لقياس بيئة العمل وتقييم القيادات المؤسسية في مجموعة المرشد.",
        instructionsAr:
          "يرجى الإجابة بكل مهنية وموضوعية. إجاباتك مجهولة الهوية ومحمية بآلية فصل الهوية عن الإجابات.",
        status: "draft",
        timezone: "Asia/Riyadh",
        minimumReportingThreshold: 5,
        enableEnvironmentSurvey: true,
        enableFutureSurvey: true,
        allowMultipleExecutiveEvaluations: true,
        minExecutives: 1,
        maxExecutives: 5,
        allowResume: true,
        privacyNoticeAr:
          "إجابات الاستبيان غير مرتبطة بهوية الموظف داخل قاعدة بيانات النتائج، مع استخدام آلية منفصلة لمنع تكرار التقييم. (نظام تحويل الهوية إلى رمز غير قابل للربط بالإجابات.)",
      },
    });
    console.log(`[seed] demo campaign created (${campaign.id})`);
  }

  // Assign all active executives to the demo campaign.
  const execs = await db.executive.findMany({ where: { isActive: true } });
  for (let i = 0; i < execs.length; i++) {
    const e = execs[i];
    const existing = await db.campaignExecutive.findUnique({
      where: { campaignId_executiveId: { campaignId: campaign.id, executiveId: e.id } },
    });
    if (existing) continue;
    await db.campaignExecutive.create({
      data: {
        campaignId: campaign.id,
        executiveId: e.id,
        displayOrder: i,
        isEnabled: true,
      },
    });
  }

  // Assign all active questions to the demo campaign.
  const questions = await db.question.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { displayOrder: "asc" },
  });
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const existing = await db.campaignQuestionConfig.findUnique({
      where: { campaignId_questionId: { campaignId: campaign.id, questionId: q.id } },
    });
    if (existing) continue;
    await db.campaignQuestionConfig.create({
      data: {
        campaignId: campaign.id,
        questionId: q.id,
        scope: q.section === "leadership" ? "executive" : "organization",
        isRequired: q.isRequired,
        displayOrder: i,
      },
    });
  }
  console.log(`[seed] demo campaign assignments ensured`);
}

async function seedSystemSettings() {
  const defaults = [
    {
      key: "privacy_notice",
      valueAr:
        "إجابات الاستبيان غير مرتبطة بهوية الموظف داخل قاعدة بيانات النتائج، مع استخدام آلية منفصلة لمنع تكرار التقييم.",
    },
    {
      key: "intro_copy",
      valueAr:
        "يهدف هذا الاستبيان إلى فهم مستوى بيئة العمل والقيادة داخل المؤسسة، وتحديد الجوانب التي تحتاج إلى تطوير.",
    },
  ];
  for (const s of defaults) {
    const existing = await db.systemSetting.findUnique({ where: { key: s.key } });
    if (existing) continue;
    await db.systemSetting.create({ data: s });
  }
  console.log(`[seed] system settings ensured`);
}

async function main() {
  console.log("=== Almarshad seed: start ===");
  await seedExecutives();
  await seedQuestions();
  await seedSystemSettings();
  await seedDemoCampaign();
  console.log("=== Almarshad seed: done ===");
}

main()
  .catch((err) => {
    console.error("[seed] FAILED", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
