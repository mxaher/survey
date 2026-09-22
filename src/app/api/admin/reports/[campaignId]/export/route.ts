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

/**
 * GET /api/admin/reports/[campaignId]/export?format=csv
 *
 * Exports a CSV (UTF-8 with BOM — Excel-compatible) of the per-executive
 * leadership question aggregates.
 *
 * One row per (executive × leadership question). Executives whose
 * evaluation count is below `minimumReportingThreshold` are skipped
 * entirely (their rows are not emitted). Aggregate numbers only — no
 * employee identity, no `employeeHmac`, no participation-ledger data.
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
    const format = request.nextUrl.searchParams.get("format") ?? "csv";
    if (format !== "csv") {
      return fail("صيغة التصدير غير مدعومة. الصيغ المدعومة: csv.", 400);
    }

    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        titleAr: true,
        minimumReportingThreshold: true,
      },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const threshold = campaign.minimumReportingThreshold;

    // Leadership snapshots + assigned executives.
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

    // Pull all executive responses for this campaign at once and bucket
    // by (executiveId, questionSnapshotId) so we avoid N×M queries.
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

    // evaluationCount per exec = distinct responseGroupId.
    const evalGroupIdsByExec = new Map<string, Set<string>>();
    // responses by (execId, snapshotId).
    const responsesByPair = new Map<
      string, // `${execId}::${snapshotId}`
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

    const rows: string[] = [];
    rows.push(buildCsvRow(CSV_HEADERS));

    for (const ce of activeExecs) {
      const exec = ce.executive;
      const evalCount =
        evalGroupIdsByExec.get(exec.id)?.size ?? 0;

      // Skip suppressed executives — they're below the threshold.
      if (evalCount < threshold) continue;

      for (const snap of snapshots) {
        const key = `${exec.id}::${snap.id}`;
        const rowsForPair = responsesByPair.get(key) ?? [];
        const count = rowsForPair.length;
        const validRows = rowsForPair.filter(
          (r) => r.selectedScore !== null
        );
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

        rows.push(
          buildCsvRow([
            campaign.titleAr,
            exec.nameAr,
            exec.departmentAr ?? "",
            dimensionLabel,
            snap.questionAr,
            count,
            averageScore,
            favorableRate,
            ...scaleCounts,
          ])
        );
      }
    }

    // UTF-8 BOM prefix for Excel compatibility, then CRLF line endings
    // (Excel prefers CRLF in CSV files).
    const csv = `\uFEFF${rows.join("\r\n")}\r\n`;

    // Audit (best-effort, outside the response pipeline).
    await writeAudit({
      adminUserId: admin.adminId,
      action: "report.export",
      entityType: "campaign",
      entityId: campaignId,
      campaignId,
      metadata: {
        format: "csv",
        rowCount: rows.length - 1, // exclude header
        threshold,
      },
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="report.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
);
