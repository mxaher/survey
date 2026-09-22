import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/[campaignId]
 *
 * Campaign overview report. Auth required (both roles).
 *
 * Returns:
 *   - campaign: { id, titleAr, status, minimumReportingThreshold, ... }
 *   - sectionTotals: {
 *       environment: { count, suppressed },
 *       future:       { count, suppressed },
 *       executive:    { count, suppressed },
 *     }
 *   - executives: [
 *       { executiveId, nameAr, titleAr, category, departmentAr,
 *         evaluationCount, suppressed }
 *     ]
 *
 * `evaluationCount` is the number of distinct `responseGroupId`s for the
 * (campaign, executive) pair — i.e., the number of unique employee
 * evaluations this exec received. A `suppressed` flag is set when the
 * count is below the campaign's `minimumReportingThreshold`; the raw
 * count is still returned for admin situational awareness, but the
 * frontend should mask the displayed value when `suppressed=true`.
 *
 * NEVER exposes raw Response rows or any employee identifier.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ campaignId: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { campaignId } = await ctx.params;

    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      include: {
        executives: {
          include: { executive: true },
          orderBy: { displayOrder: "asc" },
        },
      },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const threshold = campaign.minimumReportingThreshold;

    // Section totals. We treat the section as a whole — the question of
    // whether to display deeper per-question aggregates is delegated to
    // the /environment, /future, /executive/[id] routes which apply
    // their own threshold suppression.
    const [envCount, futCount, execCount] = await Promise.all([
      db.response.count({
        where: { campaignId, responseType: "environment" },
      }),
      db.response.count({
        where: { campaignId, responseType: "future" },
      }),
      db.response.count({
        where: { campaignId, responseType: "executive" },
      }),
    ]);

    const sectionTotals = {
      environment: {
        count: envCount,
        suppressed: envCount < threshold,
      },
      future: {
        count: futCount,
        suppressed: futCount < threshold,
      },
      executive: {
        count: execCount,
        suppressed: execCount < threshold,
      },
    };

    // Per-executive evaluation counts. For each assigned executive we
    // count DISTINCT responseGroupId so multi-question evaluations from
    // the same employee count as 1 (not N).
    const executiveRows = campaign.executives
      .filter((ce) => ce.isEnabled && ce.executive?.isActive && ce.executive?.deletedAt === null)
      .sort((a, b) => a.displayOrder - b.displayOrder);

    // Single query: pull all (executiveId, responseGroupId) pairs for
    // this campaign with responseType='executive', then de-dup in JS.
    // This avoids N+1 distinct-count queries.
    const execPairs = await db.response.findMany({
      where: {
        campaignId,
        responseType: "executive",
        executiveId: { in: executiveRows.map((r) => r.executiveId) },
      },
      select: { executiveId: true, responseGroupId: true },
    });

    const evalCountByExec = new Map<string, Set<string>>();
    for (const p of execPairs) {
      let set = evalCountByExec.get(p.executiveId ?? "");
      if (!set) {
        set = new Set<string>();
        evalCountByExec.set(p.executiveId ?? "", set);
      }
      set.add(p.responseGroupId);
    }

    const executives = executiveRows.map((ce) => {
      const exec = ce.executive;
      const evalCount = (evalCountByExec.get(exec.id)?.size ?? 0);
      return {
        executiveId: exec.id,
        nameAr: exec.nameAr,
        titleAr: exec.titleAr,
        category: exec.category,
        departmentAr: exec.departmentAr,
        evaluationCount: evalCount,
        suppressed: evalCount < threshold,
      };
    });

    return ok({
      campaign: {
        id: campaign.id,
        titleAr: campaign.titleAr,
        descriptionAr: campaign.descriptionAr,
        status: campaign.status,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        timezone: campaign.timezone,
        minimumReportingThreshold: threshold,
        enableEnvironmentSurvey: campaign.enableEnvironmentSurvey,
        enableFutureSurvey: campaign.enableFutureSurvey,
        allowMultipleExecutiveEvaluations:
          campaign.allowMultipleExecutiveEvaluations,
        activatedAt: campaign.activatedAt,
        closedAt: campaign.closedAt,
      },
      sectionTotals,
      executives,
    });
  }
);
