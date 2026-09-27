import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { fail, noStore, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { buildCampaignSummary, type D1Like } from "@/lib/reporting";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/[campaignId]/summary
 *
 * Campaign reporting summary (spec §11). Auth required (both roles).
 *
 * Returns campaign metadata, participation figures and — per report family
 * (executive / environment / future) — the minimum-reporting-threshold gate
 * (`respondentCount`, `threshold`, `reportAvailable`, `reason`, `messageAr`)
 * plus the assigned question counts. No answer-level data and no employee
 * identity. `Cache-Control: no-store`.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ campaignId: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { campaignId } = await ctx.params;
    const db = getDB();

    const summary = await buildCampaignSummary(db as unknown as D1Like, campaignId);
    if (!summary) return fail("الحملة غير موجودة.", 404);

    return noStore(summary);
  }
);
