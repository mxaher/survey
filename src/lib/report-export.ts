/**
 * Report exports (spec §10): CSV / XLSX builders for the six export types.
 *
 * Every table is aggregated only — no employee identity, no `employeeHmac`,
 * no response group id, no participation-ledger rows — and every table
 * respects the campaign's minimum reporting threshold: below it the export
 * carries the privacy notice and nothing else.
 */

import type { D1Like } from "@/lib/reporting";
import {
  buildCampaignSummary,
  buildEnvironmentReport,
  buildExecutiveReport,
  buildFutureReport,
} from "@/lib/reporting";
import { BELOW_THRESHOLD_MESSAGE_AR, interpretationBandAr } from "@/lib/scoring";

export const EXPORT_TYPES = [
  "executive_questions",
  "executive_summary",
  "environment_summary",
  "environment_questions",
  "future_priorities",
  "campaign_summary",
] as const;

export type ExportType = (typeof EXPORT_TYPES)[number];
export const DEFAULT_EXPORT_TYPE: ExportType = "executive_questions";

export const EXPORT_TYPE_LABEL_AR: Record<ExportType, string> = {
  executive_questions: "أسئلة التقييم القيادي",
  executive_summary: "ملخص التقييم القيادي",
  environment_summary: "ملخص بيئة العمل",
  environment_questions: "أسئلة بيئة العمل",
  future_priorities: "الأولويات المستقبلية",
  campaign_summary: "ملخص الحملة",
};

export interface ExportTable {
  type: ExportType;
  headers: string[];
  rows: Array<Array<string | number | null>>;
  sheetName: string;
  /** true when the threshold blocked the data (rows hold the notice only). */
  blocked: boolean;
  messageAr?: string;
}

function blockedTable(type: ExportType, messageAr: string): ExportTable {
  return {
    type,
    headers: ["تنبيه"],
    rows: [[messageAr]],
    sheetName: EXPORT_TYPE_LABEL_AR[type],
    blocked: true,
    messageAr,
  };
}

// ---------------------------------------------------------------------------
// executive_questions — per executive × question (existing format)
// ---------------------------------------------------------------------------

const EXEC_QUESTIONS_HEADERS = [
  "اسم الحملة",
  "اسم المسؤول",
  "الإدارة",
  "المحور",
  "نص السؤال",
  "عدد الإجابات",
  "المتوسط",
  "نسبة الإجابات الإيجابية",
  "دائماً",
  "غالباً",
  "أحياناً",
  "نادراً",
  "أبداً",
  "لا ينطبق",
];

const SCALE_VALUE_ORDER = [
  "always",
  "often",
  "sometimes",
  "rarely",
  "never",
  "not_applicable",
] as const;

async function buildExecutiveQuestionsTable(
  db: D1Like,
  campaignId: string
): Promise<ExportTable> {
  const campaign = await db
    .prepare(`SELECT id, titleAr, minimumReportingThreshold FROM Campaign WHERE id = ?`)
    .bind(campaignId)
    .first<{ id: string; titleAr: string; minimumReportingThreshold: number }>();
  if (!campaign) {
    return {
      type: "executive_questions",
      headers: EXEC_QUESTIONS_HEADERS,
      rows: [],
      sheetName: EXPORT_TYPE_LABEL_AR.executive_questions,
      blocked: false,
    };
  }

  const threshold = campaign.minimumReportingThreshold;

  const [snapshotsResult, campaignExecsResult, optionsResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, questionAr, dimension, categoryCode, categoryAr, displayOrder
         FROM CampaignQuestionSnapshot
         WHERE campaignId = ? AND section = 'leadership'
         ORDER BY displayOrder ASC`
      )
      .bind(campaignId)
      .all<{ id: string; questionAr: string; dimension: string | null; categoryCode: string | null; categoryAr: string | null }>(),
    db
      .prepare(
        `SELECT ce.executiveId, ce.displayOrder,
                e.nameAr, e.departmentAr, e.isActive, e.deletedAt
         FROM CampaignExecutive ce
         JOIN Executive e ON e.id = ce.executiveId
         WHERE ce.campaignId = ? AND ce.isEnabled = 1
         ORDER BY ce.displayOrder ASC`
      )
      .bind(campaignId)
      .all<{
        executiveId: string;
        nameAr: string;
        departmentAr: string | null;
        isActive: number;
        deletedAt: string | null;
      }>(),
    db
      .prepare(
        `SELECT cos.campaignQuestionSnapshotId AS snapshotId, cos.value, cos.displayOrder
         FROM CampaignQuestionOptionSnapshot cos
         JOIN CampaignQuestionSnapshot cs ON cs.id = cos.campaignQuestionSnapshotId
         WHERE cs.campaignId = ? AND cs.section = 'leadership'
         ORDER BY cos.displayOrder ASC`
      )
      .bind(campaignId)
      .all<{ snapshotId: string; value: string; displayOrder: number }>(),
  ]);

  const snapshots = snapshotsResult.results;
  const campaignExecs = campaignExecsResult.results;
  const optionRows = optionsResult.results;

  const responsesResult = await db
    .prepare(
      `SELECT executiveId, responseGroupId, questionSnapshotId, selectedValue, selectedScore
       FROM Response
       WHERE campaignId = ? AND responseType = 'executive'`
    )
    .bind(campaignId)
    .all<{
      executiveId: string | null;
      responseGroupId: string;
      questionSnapshotId: string;
      selectedValue: string;
      selectedScore: number | null;
    }>();
  const responses = responsesResult.results;

  const groupsByExec = new Map<string, Set<string>>();
  const rowsByPair = new Map<string, Array<{ value: string; score: number | null }>>();
  for (const row of responses) {
    const execId = row.executiveId ?? "";
    if (!groupsByExec.has(execId)) groupsByExec.set(execId, new Set());
    groupsByExec.get(execId)!.add(row.responseGroupId);
    const key = `${execId}::${row.questionSnapshotId}`;
    const list = rowsByPair.get(key) ?? [];
    list.push({ value: row.selectedValue, score: row.selectedScore });
    rowsByPair.set(key, list);
  }

  const rows: Array<Array<string | number | null>> = [];
  let belowThreshold = 0;

  for (const exec of campaignExecs) {
    if (!exec.isActive || exec.deletedAt !== null) continue;
    const evalCount = groupsByExec.get(exec.executiveId)?.size ?? 0;
    if (evalCount < threshold) {
      belowThreshold++;
      continue;
    }

    for (const snapshot of snapshots) {
      const pair = rowsByPair.get(`${exec.executiveId}::${snapshot.id}`) ?? [];
      const valid = pair.filter((r) => typeof r.score === "number");
      const sum = valid.reduce((acc, r) => acc + (r.score as number), 0);
      const average =
        valid.length > 0 ? Math.round((sum / valid.length) * 100) / 100 : null;
      const favorable = valid.filter((r) =>
        ["always", "often", "agree_strongly", "agree"].includes(r.value)
      ).length;
      const favorableRate =
        valid.length > 0 ? Math.round((favorable / valid.length) * 10000) / 100 : null;

      const counts = new Map<string, number>();
      for (const r of pair) counts.set(r.value, (counts.get(r.value) ?? 0) + 1);
      const scaleCounts = SCALE_VALUE_ORDER.map((v) => counts.get(v) ?? 0);

      rows.push([
        campaign.titleAr,
        exec.nameAr,
        exec.departmentAr ?? "",
        snapshot.categoryAr ?? snapshot.dimension ?? "",
        snapshot.questionAr,
        pair.length,
        average,
        favorableRate,
        ...scaleCounts,
      ]);
    }
  }

  if (rows.length === 0 && belowThreshold > 0) {
    return blockedTable("executive_questions", BELOW_THRESHOLD_MESSAGE_AR);
  }

  return {
    type: "executive_questions",
    headers: EXEC_QUESTIONS_HEADERS,
    rows,
    sheetName: EXPORT_TYPE_LABEL_AR.executive_questions,
    blocked: false,
  };
}

// ---------------------------------------------------------------------------
// executive_summary — per executive × reporting category
// ---------------------------------------------------------------------------

async function buildExecutiveSummaryTable(
  db: D1Like,
  campaignId: string
): Promise<ExportTable> {
  const headers = [
    "اسم الحملة",
    "اسم المسؤول",
    "الإدارة",
    "المحور",
    "متوسط الدرجة",
    "النسبة المئوية للمؤشر",
    "نسبة الإجابات الإيجابية",
    "نسبة الإجابات المحايدة",
    "نسبة الإجابات السلبية",
    "نسبة الإجابات غير المطبقة",
    "عدد الأسئلة",
    "التصنيف",
  ];

  const execsResult = await db
    .prepare(
      `SELECT ce.executiveId, e.nameAr, e.departmentAr, e.isActive, e.deletedAt
       FROM CampaignExecutive ce
       JOIN Executive e ON e.id = ce.executiveId
       WHERE ce.campaignId = ? AND ce.isEnabled = 1
       ORDER BY ce.displayOrder ASC`
    )
    .bind(campaignId)
    .all<{
      executiveId: string;
      nameAr: string;
      departmentAr: string | null;
      isActive: number;
      deletedAt: string | null;
    }>();

  const rows: Array<Array<string | number | null>> = [];
  let considered = 0;
  let blocked = 0;

  for (const exec of execsResult.results) {
    if (!exec.isActive || exec.deletedAt !== null) continue;
    considered++;
    const report = await buildExecutiveReport(db, campaignId, exec.executiveId);
    if (!report || "notFound" in report) continue;
    if (!report.reportAvailable) {
      blocked++;
      continue;
    }
    for (const category of report.categories) {
      rows.push([
        report.campaign.titleAr,
        exec.nameAr,
        exec.departmentAr ?? "",
        category.categoryAr,
        category.averageScore,
        category.indexScore,
        category.favorableRate,
        category.neutralRate,
        category.unfavorableRate,
        category.notApplicableRate,
        category.questionCount,
        (interpretationBandAr(category.averageScore) ?? ""),
      ]);
    }
  }

  if (rows.length === 0 && blocked > 0) {
    return blockedTable("executive_summary", BELOW_THRESHOLD_MESSAGE_AR);
  }
  void considered;

  return {
    type: "executive_summary",
    headers,
    rows,
    sheetName: EXPORT_TYPE_LABEL_AR.executive_summary,
    blocked: false,
  };
}

// ---------------------------------------------------------------------------
// environment_summary / environment_questions
// ---------------------------------------------------------------------------

async function buildEnvironmentTables(
  db: D1Like,
  campaignId: string
): Promise<{ summary: ExportTable; questions: ExportTable }> {
  const report = await buildEnvironmentReport(db, campaignId);
  const campaignTitle = report?.campaign.titleAr ?? "";

  if (!report || !report.reportAvailable) {
    const message = report?.messageAr ?? BELOW_THRESHOLD_MESSAGE_AR;
    return {
      summary: blockedTable("environment_summary", message),
      questions: blockedTable("environment_questions", message),
    };
  }

  const summaryHeaders = [
    "اسم الحملة",
    "المحور",
    "متوسط الدرجة",
    "النسبة المئوية للمؤشر",
    "نسبة الإجابات الإيجابية",
    "نسبة الإجابات المحايدة",
    "نسبة الإجابات السلبية",
    "نسبة الإجابات غير المطبقة",
    "عدد الأسئلة",
    "التصنيف",
  ];
  const summaryRows = report.categories.map((category) => [
    campaignTitle,
    category.categoryAr,
    category.averageScore,
    category.indexScore,
    category.favorableRate,
    category.neutralRate,
    category.unfavorableRate,
    category.notApplicableRate,
    category.questionCount,
    (interpretationBandAr(category.averageScore) ?? ""),
  ] as Array<string | number | null>);

  const questionHeaders = [
    "اسم الحملة",
    "المحور",
    "نص السؤال",
    "عدد الإجابات",
    "عدد الإجابات الصالحة",
    "المتوسط",
    "نسبة الإجابات الإيجابية",
    "دائماً",
    "غالباً",
    "أحياناً",
    "نادراً",
    "أبداً",
    "لا ينطبق",
  ];
  const questionRows = report.questionResults.map((q) => [
    campaignTitle,
    q.categoryAr,
    q.questionAr,
    q.respondedCount,
    q.validScoredAnswers,
    q.averageScore,
    q.favorableRate,
    q.distribution["always"]?.count ?? 0,
    q.distribution["often"]?.count ?? 0,
    q.distribution["sometimes"]?.count ?? 0,
    q.distribution["rarely"]?.count ?? 0,
    q.distribution["never"]?.count ?? 0,
    q.distribution["not_applicable"]?.count ?? 0,
  ] as Array<string | number | null>);

  return {
    summary: {
      type: "environment_summary",
      headers: summaryHeaders,
      rows: summaryRows,
      sheetName: EXPORT_TYPE_LABEL_AR.environment_summary,
      blocked: false,
    },
    questions: {
      type: "environment_questions",
      headers: questionHeaders,
      rows: questionRows,
      sheetName: EXPORT_TYPE_LABEL_AR.environment_questions,
      blocked: false,
    },
  };
}

// ---------------------------------------------------------------------------
// future_priorities
// ---------------------------------------------------------------------------

async function buildFuturePrioritiesTable(
  db: D1Like,
  campaignId: string
): Promise<ExportTable> {
  const report = await buildFutureReport(db, campaignId);
  const campaignTitle = report?.campaign.titleAr ?? "";

  if (!report || !report.reportAvailable) {
    const message = report?.messageAr ?? BELOW_THRESHOLD_MESSAGE_AR;
    return blockedTable("future_priorities", message);
  }

  const headers = [
    "اسم الحملة",
    "نص السؤال",
    "المحور",
    "الخيار",
    "عدد الاختيارات",
    "نسبة المشاركة",
    "الترتيب",
  ];
  const rows: Array<Array<string | number | null>> = [];
  for (const question of report.questions) {
    for (const option of question.options) {
      rows.push([
        campaignTitle,
        question.questionAr,
        question.categoryAr,
        option.labelAr,
        option.selectionCount,
        option.selectionRate,
        option.rank,
      ]);
    }
  }

  return {
    type: "future_priorities",
    headers,
    rows,
    sheetName: EXPORT_TYPE_LABEL_AR.future_priorities,
    blocked: false,
  };
}

// ---------------------------------------------------------------------------
// campaign_summary
// ---------------------------------------------------------------------------

async function buildCampaignSummaryTable(
  db: D1Like,
  campaignId: string
): Promise<ExportTable> {
  const summary = await buildCampaignSummary(db, campaignId);
  if (!summary) {
    return {
      type: "campaign_summary",
      headers: ["البند", "القيمة"],
      rows: [],
      sheetName: EXPORT_TYPE_LABEL_AR.campaign_summary,
      blocked: false,
    };
  }

  const availabilityLabel = (available: boolean, reason?: string) =>
    available ? "متاح" : `غير متاح (${reason ?? BELOW_THRESHOLD_MESSAGE_AR})`;

  const headers = ["البند", "القيمة"];
  const rows: Array<Array<string | number | null>> = [
    ["اسم الحملة", summary.campaign.titleAr],
    ["حالة الحملة", summary.campaign.status],
    ["تاريخ البداية", summary.campaign.startsAt ?? ""],
    ["تاريخ النهاية", summary.campaign.endsAt ?? ""],
    ["المنطقة الزمنية", summary.campaign.timezone ?? ""],
    ["الحد الأدنى لعرض النتائج", summary.campaign.minimumReportingThreshold],
    ["عدد الأسئلة المخصصة", summary.assignedQuestions.total],
    ["أسئلة التقييم القيادي", summary.assignedQuestions.leadership],
    ["أسئلة بيئة العمل", summary.assignedQuestions.environment],
    ["أسئلة الأولويات المستقبلية", summary.assignedQuestions.future],
    [
      "المشاركون (ذوو إجابات)",
      summary.participation.participantsWithAnySubmission,
    ],
    ["نسبة المشاركة", summary.participation.participationRate ?? "غير متاح"],
    ["نسبة إكمال المشاريع", summary.participation.completionRate ?? "غير متاح"],
    [
      "تقرير التقييم القيادي",
      availabilityLabel(
        summary.reports.executive.reportAvailable,
        summary.reports.executive.reason
      ),
    ],
    [
      "تقرير بيئة العمل",
      availabilityLabel(
        summary.reports.environment.reportAvailable,
        summary.reports.environment.reason
      ),
    ],
    [
      "تقرير الأولويات المستقبلية",
      availabilityLabel(
        summary.reports.future.reportAvailable,
        summary.reports.future.reason
      ),
    ],
  ];

  return {
    type: "campaign_summary",
    headers,
    rows,
    sheetName: EXPORT_TYPE_LABEL_AR.campaign_summary,
    blocked: false,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function buildExportTable(
  db: D1Like,
  campaignId: string,
  type: ExportType
): Promise<ExportTable | null> {
  switch (type) {
    case "executive_questions":
      return buildExecutiveQuestionsTable(db, campaignId);
    case "executive_summary":
      return buildExecutiveSummaryTable(db, campaignId);
    case "environment_summary":
    case "environment_questions": {
      const tables = await buildEnvironmentTables(db, campaignId);
      return type === "environment_summary" ? tables.summary : tables.questions;
    }
    case "future_priorities":
      return buildFuturePrioritiesTable(db, campaignId);
    case "campaign_summary":
      return buildCampaignSummaryTable(db, campaignId);
    default:
      return null;
  }
}

export function parseExportType(raw: string | null): ExportType | null {
  if (!raw) return DEFAULT_EXPORT_TYPE;
  const value = raw.trim().toLowerCase();
  return (EXPORT_TYPES as readonly string[]).includes(value)
    ? (value as ExportType)
    : null;
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function tableToCsv(table: ExportTable): string {
  const lines = [table.headers.map(csvField).join(",")];
  for (const row of table.rows) lines.push(row.map(csvField).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export async function tableToXlsx(table: ExportTable): Promise<Buffer> {
  const XLSX = await import("xlsx");

  const aoa: Array<Array<string | number | null>> = [table.headers, ...table.rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = table.headers.map((h) => ({
    wch: Math.max(14, Math.min(60, h.length + 8)),
  }));
  ws["!margins"] = {
    left: 0.5,
    right: 0.5,
    top: 0.5,
    bottom: 0.5,
    header: 0.3,
    footer: 0.3,
  };

  const wb = XLSX.utils.book_new();
  (wb as unknown as { Views?: unknown[] }).Views = [{ RTL: true }];
  XLSX.utils.book_append_sheet(wb, ws, table.sheetName);

  return XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }) as Buffer;
}
