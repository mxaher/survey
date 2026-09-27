import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { fail, noStore, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { buildFutureReport, type D1Like } from "@/lib/reporting";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/[campaignId]/future
 *
 * Aggregated future-priority report. Auth required (both roles).
 *
 * Spec contract: per question `{questionCode, questionAr, categoryCode,
 * categoryAr, questionType, uniqueRespondents, totalSelections, options[]
 * {value, labelAr, selectionCount, selectionRate, rank}, noteAr}` where
 * `selection_rate = selection_count / unique respondent groups * 100`.
 * No scale averages or favourable rates are reported for choice questions.
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

    const report = await buildFutureReport(db as unknown as D1Like, campaignId);
    if (!report) return fail("الحملة غير موجودة.", 404);

    return noStore(report);
  }
);
