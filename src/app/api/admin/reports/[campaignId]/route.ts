import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
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
    const db = getDB();

    const campaign = await db.prepare(
      `SELECT * FROM Campaign WHERE id = ?`
    ).bind(campaignId).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const threshold = campaign.minimumReportingThreshold as number;

    const executives = await db.prepare(
      `SELECT ce.campaignId, ce.executiveId, ce.displayOrder, ce.isEnabled,
              e.id AS eId, e.nameAr, e.titleAr, e.category, e.departmentAr, e.isActive, e.deletedAt
       FROM CampaignExecutive ce
       JOIN Executive e ON e.id = ce.executiveId
       WHERE ce.campaignId = ?
       ORDER BY ce.displayOrder ASC`
    ).bind(campaignId).all();

    // Section totals
    const envCountRow = await db.prepare(
      `SELECT COUNT(*) as cnt FROM Response WHERE campaignId = ? AND responseType = ?`
    ).bind(campaignId, "environment").first() as Record<string, unknown>;
    const futCountRow = await db.prepare(
      `SELECT COUNT(*) as cnt FROM Response WHERE campaignId = ? AND responseType = ?`
    ).bind(campaignId, "future").first() as Record<string, unknown>;
    const execCountRow = await db.prepare(
      `SELECT COUNT(*) as cnt FROM Response WHERE campaignId = ? AND responseType = ?`
    ).bind(campaignId, "executive").first() as Record<string, unknown>;

    const envCount = (envCountRow?.cnt as number) ?? 0;
    const futCount = (futCountRow?.cnt as number) ?? 0;
    const execCount = (execCountRow?.cnt as number) ?? 0;

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

    // Per-executive evaluation counts
    const activeExecs = (executives.results as Record<string, unknown>[])
      .filter((ce) => ce.isEnabled && ce.isActive && ce.deletedAt === null)
      .sort((a, b) => (a.displayOrder as number) - (b.displayOrder as number));

    const execIds = activeExecs.map((ce) => ce.executiveId as string);

    let execPairs: Record<string, unknown>[] = [];
    if (execIds.length > 0) {
      const placeholders = execIds.map(() => "?").join(",");
      const pairsResult = await db.prepare(
        `SELECT executiveId, responseGroupId FROM Response
         WHERE campaignId = ? AND responseType = 'executive'
         AND executiveId IN (${placeholders})`
      ).bind(campaignId, ...execIds).all();
      execPairs = pairsResult.results as Record<string, unknown>[];
    }

    const evalCountByExec = new Map<string, Set<string>>();
    for (const p of execPairs) {
      const execId = (p.executiveId as string) ?? "";
      let set = evalCountByExec.get(execId);
      if (!set) {
        set = new Set<string>();
        evalCountByExec.set(execId, set);
      }
      set.add(p.responseGroupId as string);
    }

    const execResult = activeExecs.map((ce) => {
      const evalCount = (evalCountByExec.get(ce.executiveId as string)?.size ?? 0);
      return {
        executiveId: ce.executiveId,
        nameAr: ce.nameAr,
        titleAr: ce.titleAr,
        category: ce.category,
        departmentAr: ce.departmentAr,
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
      executives: execResult,
    });
  }
);
