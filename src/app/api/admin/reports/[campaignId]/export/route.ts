import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";
import { type D1Like } from "@/lib/reporting";
import {
  EXPORT_TYPE_LABEL_AR,
  EXPORT_TYPES,
  buildExportTable,
  parseExportType,
  tableToCsv,
  tableToXlsx,
} from "@/lib/report-export";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/[campaignId]/export?format=csv|xlsx&type=<export type>
 *
 * Six export types (spec §10):
 *   executive_questions | executive_summary | environment_summary |
 *   environment_questions | future_priorities | campaign_summary
 *
 * All of them:
 *   • aggregate only — no employee identity, `employeeHmac`, response group
 *     ids or participation-ledger rows;
 *   • respect `campaign.minimumReportingThreshold` (below it the file
 *     contains the privacy notice and nothing else);
 *   • Arabic headers, `Cache-Control: no-store`;
 *   • audited as `report.export`.
 */
export const GET = apiHandler(
  async (
    request: NextRequest,
    ctx: { params: Promise<{ campaignId: string }> }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { campaignId } = await ctx.params;
    const db = getDB();

    const format = (request.nextUrl.searchParams.get("format") ?? "csv").toLowerCase();
    if (format !== "csv" && format !== "xlsx") {
      return fail("صيغة التصدير غير مدعومة. الصيغ المدعومة: csv، xlsx.", 400);
    }

    const type = parseExportType(request.nextUrl.searchParams.get("type"));
    if (!type) {
      return fail(
        `نوع التصدير غير مدعوم. الأنواع المدعومة: ${EXPORT_TYPES.join("، ")}.`,
        400
      );
    }

    const campaign = await db
      .prepare(`SELECT id FROM Campaign WHERE id = ?`)
      .bind(campaignId)
      .first<{ id: string }>();
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const table = await buildExportTable(
      db as unknown as D1Like,
      campaignId,
      type
    );
    if (!table) return fail("الحملة غير موجودة.", 404);

    await writeAudit({
      adminUserId: admin.adminId,
      action: "report.export",
      entityType: "campaign",
      entityId: campaignId,
      campaignId,
      metadata: {
        format,
        type,
        rowCount: table.rows.length,
        blocked: table.blocked,
        labelAr: EXPORT_TYPE_LABEL_AR[type],
      },
    });

    const filename = `report_${type}.${format}`;

    if (format === "csv") {
      return new NextResponse(tableToCsv(table), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const buf = await tableToXlsx(table);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }
);
