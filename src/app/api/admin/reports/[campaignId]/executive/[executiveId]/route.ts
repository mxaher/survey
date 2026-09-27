import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { fail, noStore, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { buildExecutiveReport, type D1Like } from "@/lib/reporting";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/[campaignId]/executive/[executiveId]
 *
 * Per-executive aggregated report. Auth required (both roles).
 *
 * Spec contract:
 *   campaign, executive, responseSummary {respondentCount, threshold,
 *   reportAvailable, reason?, messageAr?}, overallScore, categories[],
 *   questionResults[], strengths[], developmentAreas[],
 *   developmentPriorities[] — plus the legacy fields (`suppressed`,
 *   `questions`, `dimensions`, `strength`, `improvement`,
 *   `orgWideComparison`) still consumed by the admin report view.
 *
 * Privacy (spec §8): below `campaign.minimumReportingThreshold` the payload
 * carries the gate only — no scores, distributions or category labels, and
 * never an employee identifier, HMAC or response group id.
 * `Cache-Control: no-store`.
 */
export const GET = apiHandler(
  async (
    _request: NextRequest,
    ctx: {
      params: Promise<{ campaignId: string; executiveId: string }>;
    }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { campaignId, executiveId } = await ctx.params;
    const db = getDB();

    const report = await buildExecutiveReport(db as unknown as D1Like, campaignId, executiveId);
    if (!report) return fail("الحملة غير موجودة.", 404);
    if ("notFound" in report) return fail("المسؤول غير موجود.", 404);

    return noStore(report);
  }
);
