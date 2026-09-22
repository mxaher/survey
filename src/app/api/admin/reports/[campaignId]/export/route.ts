import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";
import {
  FAVORABLE_VALUES,
  LEADERSHIP_DIMENSIONS,
} from "@/lib/constants";

export const dynamic = "force-dynamic";

const DIM_LABEL_AR: Record<string, string> = Object.fromEntries(
  LEADERSHIP_DIMENSIONS.map((d) => [d.key, d.labelAr])
);

const CSV_HEADERS = [
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

// Count columns in fixed order — the last 6 headers map to these values.
const SCALE_VALUE_ORDER = [
  "always",
  "often",
  "sometimes",
  "rarely",
  "never",
  "not_applicable",
] as const;

/** RFC-4180 CSV field escaping. Wraps in quotes if it contains a
 * comma, double-quote, newline, or leading/trailing whitespace; doubles
 * any internal double-quotes. */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsvRow(
  fields: ReadonlyArray<string | number | null | undefined>
): string {
  return fields.map(csvField).join(",");
}

/** Row aggregate computed once per (executive × leadership question). */
interface RowAggregate {
  campaignTitle: string;
  execName: string;
  execDepartment: string;
  dimensionLabel: string;
  questionText: string;
  count: number;
  averageScore: number | null;
  favorableRate: number | null;
  scaleCounts: number[];
}

/**
 * Shared aggregation for both CSV and XLSX exports.
 * - Respects the per-campaign `minimumReportingThreshold` (executives
 *   below the threshold are skipped entirely).
 * - Returns aggregate numbers only — no employee identity, no
 *   `employeeHmac`, no participation-ledger data.
 */
async function computeExportRows(campaignId: string): Promise<{
  rows: RowAggregate[];
  threshold: number;
  campaignTitle: string;
}> {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      titleAr: true,
      minimumReportingThreshold: true,
    },
  });
  if (!campaign) {
    return { rows: [], threshold: 0, campaignTitle: "" };
  }
  const threshold = campaign.minimumReportingThreshold;

  const [snapshots, campaignExecs] = await Promise.all([
    db.campaignQuestionSnapshot.findMany({
      where: { campaignId, section: "leadership" },
      include: { options: true },
      orderBy: { displayOrder: "asc" },
    }),
    db.campaignExecutive.findMany({
      where: { campaignId, isEnabled: true },
      include: { executive: true },
      orderBy: { displayOrder: "asc" },
    }),
  ]);

  const activeExecs = campaignExecs.filter(
    (ce) => ce.executive?.isActive && ce.executive?.deletedAt === null
  );

  const allExecResponses = await db.response.findMany({
    where: { campaignId, responseType: "executive" },
    select: {
      executiveId: true,
      responseGroupId: true,
      questionSnapshotId: true,
      selectedValue: true,
      selectedScore: true,
    },
  });

  const evalGroupIdsByExec = new Map<string, Set<string>>();
  const responsesByPair = new Map<
    string,
    Array<{ selectedValue: string; selectedScore: number | null }>
  >();

  for (const r of allExecResponses) {
    const execId = r.executiveId ?? "";
    if (!evalGroupIdsByExec.has(execId)) {
      evalGroupIdsByExec.set(execId, new Set());
    }
    evalGroupIdsByExec.get(execId)!.add(r.responseGroupId);

    const key = `${execId}::${r.questionSnapshotId}`;
    const arr = responsesByPair.get(key) ?? [];
    arr.push({
      selectedValue: r.selectedValue,
      selectedScore: r.selectedScore,
    });
    responsesByPair.set(key, arr);
  }

  const rows: RowAggregate[] = [];

  for (const ce of activeExecs) {
    const exec = ce.executive;
    const evalCount = evalGroupIdsByExec.get(exec.id)?.size ?? 0;
    if (evalCount < threshold) continue;

    for (const snap of snapshots) {
      const key = `${exec.id}::${snap.id}`;
      const rowsForPair = responsesByPair.get(key) ?? [];
      const count = rowsForPair.length;
      const validRows = rowsForPair.filter((r) => r.selectedScore !== null);
      const validCount = validRows.length;
      const sumScore = validRows.reduce(
        (acc, r) => acc + (r.selectedScore ?? 0),
        0
      );
      const averageScore =
        validCount > 0
          ? Math.round((sumScore / validCount) * 100) / 100
          : null;
      const favorableCount = rowsForPair.filter((r) =>
        FAVORABLE_VALUES.has(r.selectedValue)
      ).length;
      const favorableRate =
        validCount > 0
          ? Math.round((favorableCount / validCount) * 10000) / 100
          : null;

      const valueCounts = new Map<string, number>();
      for (const r of rowsForPair) {
        valueCounts.set(
          r.selectedValue,
          (valueCounts.get(r.selectedValue) ?? 0) + 1
        );
      }

      const dimensionLabel = snap.dimension
        ? DIM_LABEL_AR[snap.dimension] ?? snap.dimension
        : "";

      const scaleCounts = SCALE_VALUE_ORDER.map(
        (v) => valueCounts.get(v) ?? 0
      );

      rows.push({
        campaignTitle: campaign.titleAr,
        execName: exec.nameAr,
        execDepartment: exec.departmentAr ?? "",
        dimensionLabel,
        questionText: snap.questionAr,
        count,
        averageScore,
        favorableRate,
        scaleCounts,
      });
    }
  }

  return { rows, threshold, campaignTitle: campaign.titleAr };
}

/** Build the UTF-8-BOM CSV body (Excel-compatible, CRLF). */
function buildCsv(rows: RowAggregate[]): string {
  const lines: string[] = [buildCsvRow(CSV_HEADERS)];
  for (const r of rows) {
    lines.push(
      buildCsvRow([
        r.campaignTitle,
        r.execName,
        r.execDepartment,
        r.dimensionLabel,
        r.questionText,
        r.count,
        r.averageScore,
        r.favorableRate,
        ...r.scaleCounts,
      ])
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/**
 * Build an XLSX workbook with two sheets:
 *  - "ملخص الأبعاد" — per (executive × dimension) rollup averages.
 *  - "تفصيل الأسئلة" — per (executive × question) full breakdown.
 *
 * Returns a Node Buffer (xlsx writes to a buffer when `type: "buffer"`
 * is passed). Arabic strings are preserved as UTF-8 inside the XLSX
 * XML, so no BOM is needed (unlike CSV).
 */
async function buildXlsx(
  rows: RowAggregate[],
  meta: { campaignTitle: string; threshold: number }
): Promise<Buffer> {
  // Dynamic import so the dependency is only loaded when XLSX is actually
  // requested (CSV path stays light).
  const XLSX = await import("xlsx");

  // Sheet 1: per-question detail (mirrors the CSV).
  const detailData = rows.map((r) => ({
    "اسم الحملة": r.campaignTitle,
    "اسم المسؤول": r.execName,
    "الإدارة": r.execDepartment,
    "المحور": r.dimensionLabel,
    "نص السؤال": r.questionText,
    "عدد الإجابات": r.count,
    "المتوسط": r.averageScore,
    "نسبة الإجابات الإيجابية": r.favorableRate,
    "دائماً": r.scaleCounts[0],
    "غالباً": r.scaleCounts[1],
    "أحياناً": r.scaleCounts[2],
    "نادراً": r.scaleCounts[3],
    "أبداً": r.scaleCounts[4],
    "لا ينطبق": r.scaleCounts[5],
  }));
  const wsDetail = XLSX.utils.json_to_sheet(detailData, {
    header: CSV_HEADERS,
  });
  // Set RTL view + column widths for readability.
  wsDetail["!cols"] = [
    { wch: 32 }, // campaign
    { wch: 22 }, // exec name
    { wch: 18 }, // department
    { wch: 18 }, // dimension
    { wch: 50 }, // question
    { wch: 12 }, // count
    { wch: 10 }, // avg
    { wch: 18 }, // favorable
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
  ];
  wsDetail["!margins"] = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };

  // Sheet 2: per-dimension rollup per executive.
  const dimRollup = new Map<
    string, // `${execName}::${dimensionLabel}`
    { execName: string; department: string; dimension: string; sum: number; valid: number; total: number; favorable: number; favorableValid: number }
  >();
  for (const r of rows) {
    const key = `${r.execName}::${r.dimensionLabel}`;
    const cur =
      dimRollup.get(key) ?? {
        execName: r.execName,
        department: r.execDepartment,
        dimension: r.dimensionLabel,
        sum: 0,
        valid: 0,
        total: 0,
        favorable: 0,
        favorableValid: 0,
      };
    cur.total += r.count;
    if (r.averageScore != null && r.count > 0) {
      // weighted by count so dimensions with more responses weigh correctly
      cur.sum += r.averageScore * r.count;
      cur.valid += r.count;
    }
    if (r.favorableRate != null && r.count > 0) {
      cur.favorable += (r.favorableRate / 100) * r.count;
      cur.favorableValid += r.count;
    }
    dimRollup.set(key, cur);
  }
  const summaryData = Array.from(dimRollup.values()).map((d) => ({
    "اسم المسؤول": d.execName,
    "الإدارة": d.department,
    "المحور": d.dimension,
    "متوسط الدرجة": d.valid > 0 ? Math.round((d.sum / d.valid) * 100) / 100 : null,
    "نسبة الإيجابية": d.favorableValid > 0 ? Math.round((d.favorable / d.favorableValid) * 10000) / 100 : null,
    "عدد الإجابات": d.total,
  }));
  const wsSummary = XLSX.utils.json_to_sheet(summaryData, {
    header: [
      "اسم المسؤول",
      "الإدارة",
      "المحور",
      "متوسط الدرجة",
      "نسبة الإيجابية",
      "عدد الإجابات",
    ],
  });
  wsSummary["!cols"] = [
    { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  // Mark the workbook as RTL (Excel will respect this for sheet view).
  (wb as unknown as { Views?: unknown[] }).Views = [{ RTL: true }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "ملخص الأبعاد");
  XLSX.utils.book_append_sheet(wb, wsDetail, "تفصيل الأسئلة");

  const buf = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }) as Buffer;

  // Reference meta to satisfy TS (campaignTitle/threshold are used in audit
  // outside this function; we keep them in the signature for future use).
  void meta;

  return buf;
}

/**
 * GET /api/admin/reports/[campaignId]/export?format=csv|xlsx
 *
 * Exports the per-executive leadership question aggregates.
 *
 * - `csv`  → UTF-8 with BOM (Excel-compatible), CRLF line endings.
 * - `xlsx` → Two-sheet workbook (summary + detail), RTL view.
 *
 * One row per (executive × leadership question). Executives whose
 * evaluation count is below `minimumReportingThreshold` are skipped
 * entirely. Aggregate numbers only — no employee identity, no
 * `employeeHmac`, no participation-ledger data.
 *
 * Auth required (both roles). Audited as `report.export`.
 */
export const GET = apiHandler(
  async (
    request: NextRequest,
    ctx: { params: Promise<{ campaignId: string }> }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { campaignId } = await ctx.params;
    const format = (request.nextUrl.searchParams.get("format") ?? "csv").toLowerCase();
    if (format !== "csv" && format !== "xlsx") {
      return fail("صيغة التصدير غير مدعومة. الصيغ المدعومة: csv، xlsx.", 400);
    }

    const { rows, threshold, campaignTitle } = await computeExportRows(campaignId);
    if (!campaignTitle) return fail("الحملة غير موجودة.", 404);

    await writeAudit({
      adminUserId: admin.adminId,
      action: "report.export",
      entityType: "campaign",
      entityId: campaignId,
      campaignId,
      metadata: {
        format,
        rowCount: rows.length,
        threshold,
      },
    });

    if (format === "csv") {
      const csv = buildCsv(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="report.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // format === "xlsx"
    const buf = await buildXlsx(rows, { campaignTitle, threshold });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="report.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
);
