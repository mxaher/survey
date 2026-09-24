import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
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

const SCALE_VALUE_ORDER = [
  "always",
  "often",
  "sometimes",
  "rarely",
  "never",
  "not_applicable",
] as const;

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

async function computeExportRows(campaignId: string): Promise<{
  rows: RowAggregate[];
  threshold: number;
  campaignTitle: string;
}> {
  const db = getDB();

  const campaign = await db.prepare(
    `SELECT id, titleAr, minimumReportingThreshold FROM Campaign WHERE id = ?`
  ).bind(campaignId).first() as Record<string, unknown> | null;
  if (!campaign) {
    return { rows: [], threshold: 0, campaignTitle: "" };
  }
  const threshold = campaign.minimumReportingThreshold as number;

  const [snapshotsResult, campaignExecsResult, optionsResult] = await Promise.all([
    db.prepare(
      `SELECT id, questionAr, dimension, displayOrder
       FROM CampaignQuestionSnapshot
       WHERE campaignId = ? AND section = 'leadership'
       ORDER BY displayOrder ASC`
    ).bind(campaignId).all(),
    db.prepare(
      `SELECT ce.campaignId, ce.executiveId, ce.displayOrder, ce.isEnabled,
              e.id AS eId, e.nameAr, e.titleAr, e.category, e.departmentAr, e.isActive, e.deletedAt
       FROM CampaignExecutive ce
       JOIN Executive e ON e.id = ce.executiveId
       WHERE ce.campaignId = ? AND ce.isEnabled = 1
       ORDER BY ce.displayOrder ASC`
    ).bind(campaignId).all(),
    db.prepare(
      `SELECT cos.id AS snapshotId, cos.value, cos.labelAr, cos.displayOrder
       FROM CampaignQuestionOptionSnapshot cos
       JOIN CampaignQuestionSnapshot cs ON cs.id = cos.campaignQuestionSnapshotId
       WHERE cs.campaignId = ? AND cs.section = 'leadership'
       ORDER BY cos.displayOrder ASC`
    ).bind(campaignId).all(),
  ]);

  const snapshots = snapshotsResult.results as Record<string, unknown>[];
  const campaignExecs = campaignExecsResult.results as Record<string, unknown>[];
  const allOptions = optionsResult.results as Record<string, unknown>[];

  const optionsBySnapshot = new Map<string, Record<string, unknown>[]>();
  for (const opt of allOptions) {
    const snapId = opt.snapshotId as string;
    if (!optionsBySnapshot.has(snapId)) optionsBySnapshot.set(snapId, []);
    optionsBySnapshot.get(snapId)!.push(opt);
  }

  const activeExecs = campaignExecs.filter(
    (ce) => ce.isActive && ce.deletedAt === null
  );

  const execResponsesResult = await db.prepare(
    `SELECT executiveId, responseGroupId, questionSnapshotId, selectedValue, selectedScore
     FROM Response
     WHERE campaignId = ? AND responseType = 'executive'`
  ).bind(campaignId).all();
  const allExecResponses = execResponsesResult.results as Record<string, unknown>[];

  const evalGroupIdsByExec = new Map<string, Set<string>>();
  const responsesByPair = new Map<
    string,
    Array<{ selectedValue: string; selectedScore: number | null }>
  >();

  for (const r of allExecResponses) {
    const execId = (r.executiveId as string) ?? "";
    if (!evalGroupIdsByExec.has(execId)) {
      evalGroupIdsByExec.set(execId, new Set());
    }
    evalGroupIdsByExec.get(execId)!.add(r.responseGroupId as string);

    const key = `${execId}::${r.questionSnapshotId}`;
    const arr = responsesByPair.get(key) ?? [];
    arr.push({
      selectedValue: r.selectedValue as string,
      selectedScore: r.selectedScore as number | null,
    });
    responsesByPair.set(key, arr);
  }

  const rows: RowAggregate[] = [];

  for (const ce of activeExecs) {
    const execId = ce.executiveId as string;
    const evalCount = evalGroupIdsByExec.get(execId)?.size ?? 0;
    if (evalCount < threshold) continue;

    for (const snap of snapshots) {
      const snapId = snap.id as string;
      const key = `${execId}::${snapId}`;
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
        ? DIM_LABEL_AR[snap.dimension as string] ?? (snap.dimension as string)
        : "";

      const scaleCounts = SCALE_VALUE_ORDER.map(
        (v) => valueCounts.get(v) ?? 0
      );

      rows.push({
        campaignTitle: campaign.titleAr as string,
        execName: ce.nameAr as string,
        execDepartment: (ce.departmentAr as string) ?? "",
        dimensionLabel,
        questionText: snap.questionAr as string,
        count,
        averageScore,
        favorableRate,
        scaleCounts,
      });
    }
  }

  return { rows, threshold, campaignTitle: campaign.titleAr as string };
}

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

async function buildXlsx(
  rows: RowAggregate[],
  meta: { campaignTitle: string; threshold: number }
): Promise<Buffer> {
  const XLSX = await import("xlsx");

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
  wsDetail["!cols"] = [
    { wch: 32 },
    { wch: 22 },
    { wch: 18 },
    { wch: 18 },
    { wch: 50 },
    { wch: 12 },
    { wch: 10 },
    { wch: 18 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
  ];
  wsDetail["!margins"] = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };

  const dimRollup = new Map<
    string,
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
  (wb as unknown as { Views?: unknown[] }).Views = [{ RTL: true }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "ملخص الأبعاد");
  XLSX.utils.book_append_sheet(wb, wsDetail, "تفصيل الأسئلة");

  const buf = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }) as Buffer;

  void meta;

  return buf;
}

/**
 * GET /api/admin/reports/[campaignId]/export?format=csv|xlsx
 *
 * Exports the per-executive leadership question aggregates.
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
