import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";
import { LEADERSHIP_DIMENSIONS } from "@/lib/constants";

export const dynamic = "force-dynamic";

const CSV_HEADERS = [
  "اسم الحملة",
  "الحالة",
  "تاريخ التفعيل",
  "مشاركات بيئة العمل",
  "مشاركات البيئة المستقبلية",
  "تقييمات المسؤولين",
  "المُقيِّمون",
  "معدل المشاركة (%)",
  "إجمالي الإجابات",
  ...LEADERSHIP_DIMENSIONS.map((d) => d.labelAr),
];

function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsvRow(fields: ReadonlyArray<string | number | null | undefined>): string {
  return fields.map(csvField).join(",");
}

interface TrendRow {
  titleAr: string;
  status: string;
  activatedAt: string;
  envCount: number;
  futureCount: number;
  execEvalCount: number;
  distinctEvaluators: number;
  participationRate: number | null;
  totalResp: number;
  dimAverages: (number | null)[];
}

/**
 * Shared aggregation for the trend CSV + XLSX exports. Pulls all the data
 * needed in a handful of queries, then computes per-campaign rows in JS.
 *
 * Respects each campaign's per-exec threshold (low-N execs are skipped
 * from the dimension averages). NO employee identifiers — aggregate
 * numbers only.
 */
async function computeTrendRows(
  allowedStatuses: string[]
): Promise<{ rows: TrendRow[]; eligibleCount: number }> {
  const campaigns = await db.campaign.findMany({
    where: { status: { in: allowedStatuses } },
    select: {
      id: true,
      titleAr: true,
      status: true,
      activatedAt: true,
      minimumReportingThreshold: true,
    },
    orderBy: { activatedAt: "asc" },
  });

  if (campaigns.length === 0) {
    return { rows: [], eligibleCount: 0 };
  }

  const campaignIds = campaigns.map((c) => c.id);
  const thresholdById = new Map(
    campaigns.map((c) => [c.id, c.minimumReportingThreshold])
  );

  const eligibleSetting = await db.systemSetting.findUnique({
    where: { key: "eligible_employees_count" },
  });
  const eligibleCount = eligibleSetting
    ? parseInt(eligibleSetting.valueAr, 10) || 0
    : 0;

  const participation = await db.participationLedger.groupBy({
    by: ["campaignId", "participationType"],
    where: { campaignId: { in: campaignIds }, status: "submitted" },
    _count: { _all: true },
  });

  const distinctEvaluatorsRaw = await db.participationLedger.groupBy({
    by: ["campaignId", "employeeHmac"],
    where: {
      campaignId: { in: campaignIds },
      participationType: "executive",
      status: "submitted",
    },
    _count: { _all: true },
  });
  const distinctEvaluatorsByCampaign = new Map<string, number>();
  for (const row of distinctEvaluatorsRaw) {
    distinctEvaluatorsByCampaign.set(
      row.campaignId,
      (distinctEvaluatorsByCampaign.get(row.campaignId) ?? 0) + 1
    );
  }

  const totalResponses = await db.response.groupBy({
    by: ["campaignId"],
    where: { campaignId: { in: campaignIds } },
    _count: { _all: true },
  });
  const totalByCampaign = new Map<string, number>();
  for (const row of totalResponses) {
    totalByCampaign.set(row.campaignId, row._count._all);
  }

  const [responses, snapshots] = await Promise.all([
    db.response.findMany({
      where: {
        campaignId: { in: campaignIds },
        responseType: "executive",
      },
      select: {
        campaignId: true,
        executiveId: true,
        responseGroupId: true,
        questionSnapshotId: true,
        selectedScore: true,
      },
    }),
    db.campaignQuestionSnapshot.findMany({
      where: {
        campaignId: { in: campaignIds },
        section: "leadership",
        dimension: { not: null },
      },
      select: { id: true, dimension: true },
    }),
  ]);

  const snapDim = new Map<string, string>();
  for (const s of snapshots) snapDim.set(s.id, s.dimension ?? "");

  const evalCountByCampaignExec = new Map<string, Set<string>>();
  for (const r of responses) {
    const key = `${r.campaignId}::${r.executiveId ?? ""}`;
    const set = evalCountByCampaignExec.get(key) ?? new Set<string>();
    set.add(r.responseGroupId);
    evalCountByCampaignExec.set(key, set);
  }

  const perExecDim = new Map<string, { sum: number; valid: number }>();
  for (const r of responses) {
    const dim = snapDim.get(r.questionSnapshotId);
    if (!dim) continue;
    const key = `${r.campaignId}::${r.executiveId ?? ""}::${dim}`;
    const acc = perExecDim.get(key) ?? { sum: 0, valid: 0 };
    if (r.selectedScore !== null) {
      acc.sum += r.selectedScore;
      acc.valid += 1;
    }
    perExecDim.set(key, acc);
  }

  const campaignDimAcc = new Map<string, { sum: number; count: number }>();
  for (const [key, acc] of perExecDim.entries()) {
    const [campaignId, execId, dim] = key.split("::");
    const threshold = thresholdById.get(campaignId) ?? 5;
    const evalCount =
      evalCountByCampaignExec.get(`${campaignId}::${execId}`)?.size ?? 0;
    if (evalCount < threshold) continue;
    if (acc.valid === 0) continue;
    const avg = acc.sum / acc.valid;
    const k = `${campaignId}::${dim}`;
    const cur = campaignDimAcc.get(k) ?? { sum: 0, count: 0 };
    cur.sum += avg;
    cur.count += 1;
    campaignDimAcc.set(k, cur);
  }

  const rows: TrendRow[] = campaigns.map((c) => {
    const envCount =
      participation.find(
        (p) => p.campaignId === c.id && p.participationType === "environment"
      )?._count._all ?? 0;
    const futureCount =
      participation.find(
        (p) => p.campaignId === c.id && p.participationType === "future"
      )?._count._all ?? 0;
    const execEvalCount =
      participation.find(
        (p) => p.campaignId === c.id && p.participationType === "executive"
      )?._count._all ?? 0;
    const distinctEvaluators =
      distinctEvaluatorsByCampaign.get(c.id) ?? 0;
    const participationRate =
      eligibleCount > 0
        ? Math.round((distinctEvaluators / eligibleCount) * 10000) / 100
        : null;
    const totalResp = totalByCampaign.get(c.id) ?? 0;

    const dimAverages = LEADERSHIP_DIMENSIONS.map((d) => {
      const acc = campaignDimAcc.get(`${c.id}::${d.key}`);
      return acc && acc.count > 0
        ? Math.round((acc.sum / acc.count) * 100) / 100
        : null;
    });

    return {
      titleAr: c.titleAr,
      status: c.status,
      activatedAt: c.activatedAt ? new Date(c.activatedAt).toISOString() : "",
      envCount,
      futureCount,
      execEvalCount,
      distinctEvaluators,
      participationRate,
      totalResp,
      dimAverages,
    };
  });

  return { rows, eligibleCount };
}

/** Build the UTF-8-BOM CSV body (Excel-compatible, CRLF). */
function buildCsv(rows: TrendRow[]): string {
  const lines: string[] = [buildCsvRow(CSV_HEADERS)];
  for (const r of rows) {
    lines.push(
      buildCsvRow([
        r.titleAr,
        r.status,
        r.activatedAt,
        r.envCount,
        r.futureCount,
        r.execEvalCount,
        r.distinctEvaluators,
        r.participationRate,
        r.totalResp,
        ...r.dimAverages,
      ])
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/**
 * Build an XLSX workbook with two sheets:
 *  - "ملخص المقارنة" — the same data as the CSV (one row per campaign).
 *  - "متوسطات الأبعاد" — a transposed view (one row per dimension, columns
 *    per campaign) for easier side-by-side comparison.
 */
async function buildXlsx(rows: TrendRow[]): Promise<Buffer> {
  const XLSX = await import("xlsx");

  // Sheet 1: per-campaign summary (mirrors the CSV).
  const summaryData = rows.map((r) => ({
    "اسم الحملة": r.titleAr,
    "الحالة": r.status,
    "تاريخ التفعيل": r.activatedAt,
    "مشاركات بيئة العمل": r.envCount,
    "مشاركات البيئة المستقبلية": r.futureCount,
    "تقييمات المسؤولين": r.execEvalCount,
    "المُقيِّمون": r.distinctEvaluators,
    "معدل المشاركة (%)": r.participationRate,
    "إجمالي الإجابات": r.totalResp,
    ...Object.fromEntries(
      LEADERSHIP_DIMENSIONS.map((d, i) => [d.labelAr, r.dimAverages[i]])
    ),
  }));
  const wsSummary = XLSX.utils.json_to_sheet(summaryData, {
    header: CSV_HEADERS,
  });
  wsSummary["!cols"] = [
    { wch: 32 }, { wch: 10 }, { wch: 22 },
    { wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 14 },
    ...LEADERSHIP_DIMENSIONS.map(() => ({ wch: 14 })),
  ];

  // Sheet 2: transposed — one row per dimension, columns per campaign.
  const dimData = LEADERSHIP_DIMENSIONS.map((d, dimIdx) => {
    const row: Record<string, string | number | null> = {
      "البُعد": d.labelAr,
    };
    for (const c of rows) {
      row[c.titleAr] = c.dimAverages[dimIdx];
    }
    return row;
  });
  const wsDims = XLSX.utils.json_to_sheet(dimData);
  wsDims["!cols"] = [
    { wch: 22 },
    ...rows.map(() => ({ wch: 18 })),
  ];

  const wb = XLSX.utils.book_new();
  (wb as unknown as { Views?: unknown[] }).Views = [{ RTL: true }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "ملخص المقارنة");
  XLSX.utils.book_append_sheet(wb, wsDims, "متوسطات الأبعاد");

  return XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }) as Buffer;
}

/**
 * GET /api/admin/reports/trend/export?format=csv|xlsx&status=all|active|closed
 *
 * Exports the trend/comparison view.
 *  - `csv`  → UTF-8 BOM, CRLF, Excel-compatible.
 *  - `xlsx` → 2-sheet RTL workbook (summary + transposed dimensions).
 *
 * One row per campaign with participation counts + participation rate +
 * per-dimension averages. Respects each campaign's per-exec threshold.
 * NO employee identifiers — aggregate numbers only.
 *
 * Auth required (both roles). Audited as `report.export`.
 */
export const GET = apiHandler(
  async (request: NextRequest) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const format = (
      request.nextUrl.searchParams.get("format") ?? "csv"
    ).toLowerCase();
    if (format !== "csv" && format !== "xlsx") {
      return fail("صيغة التصدير غير مدعومة. الصيغ المدعومة: csv، xlsx.", 400);
    }

    const statusFilter = request.nextUrl.searchParams.get("status") ?? "all";
    const allowedStatuses =
      statusFilter === "active"
        ? ["active"]
        : statusFilter === "closed"
        ? ["closed"]
        : ["active", "closed"];

    const { rows, eligibleCount } = await computeTrendRows(allowedStatuses);

    await writeAudit({
      adminUserId: admin.adminId,
      action: "report.export",
      entityType: "campaign",
      campaignId: null,
      metadata: {
        format,
        scope: "trend",
        statusFilter,
        rowCount: rows.length,
        eligibleCount,
      },
    });

    if (format === "csv") {
      const csv = buildCsv(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="trend-export.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // format === "xlsx"
    const buf = await buildXlsx(rows);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="trend-export.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
);
