import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { fail, noStore, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { buildEnvironmentReport, type D1Like } from "@/lib/reporting";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/[campaignId]/environment
 *
 * Aggregated organization work-environment report. Auth required (both roles).
 *
 * Spec contract: responseSummary, overallScore, categories[],
 * questionResults[], strengths[], developmentAreas[],
 * developmentPriorities[] — plus the legacy `suppressed` / `questions` /
 * `distinctSubmitters` / `totalResponses` fields used by the admin view.
 *
 * Privacy (spec §8): below `campaign.minimumReportingThreshold` only the
 * gate is returned. `Cache-Control: no-store`.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ campaignId: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { campaignId } = await ctx.params;
    const db = getDB();

    const report = await buildEnvironmentReport(db as unknown as D1Like, campaignId);
    if (!report) return fail("الحملة غير موجودة.", 404);

    return noStore(report);
  }
);
