import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/dashboard
 *
 * Admin dashboard summary. Auth required (both roles can read).
 *
 * Returns:
 *   - campaignsByStatus: { status, count }[]
 *   - totals: { activeExecutives, activeQuestions, responses, campaigns }
 *   - latestCampaign: { id, titleAr, status, responseCount } | null
 *
 * "responses" is an anonymized aggregate count — we never expose any
 * employee identifier or join back to participation_ledger. The count
 * is the total number of Response rows across all campaigns.
 */
export const GET = apiHandler(async () => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  // Group campaigns by status. SQLite doesn't always behave well with
  // Prisma's `groupBy`; we fetch all campaigns and bucket in JS — cheap
  // because the campaign table is small.
  const campaigns = await db.campaign.findMany({
    select: {
      id: true,
      titleAr: true,
      status: true,
      createdAt: true,
      _count: { select: { responses: true } },
    },
  });

  const statusCounts = new Map<string, number>();
  for (const c of campaigns) {
    statusCounts.set(c.status, (statusCounts.get(c.status) ?? 0) + 1);
  }
  const campaignsByStatus = Array.from(statusCounts.entries()).map(
    ([status, count]) => ({ status, count })
  );

  // Active executives & questions + total responses (anonymized count).
  const [activeExecutives, activeQuestions, totalResponses] =
    await Promise.all([
      db.executive.count({
        where: { isActive: true, deletedAt: null },
      }),
      db.question.count({
        where: { isActive: true, deletedAt: null },
      }),
      db.response.count(),
    ]);

  // Latest campaign snapshot (most recent by createdAt).
  let latestCampaign: {
    id: string;
    titleAr: string;
    status: string;
    responseCount: number;
  } | null = null;

  if (campaigns.length > 0) {
    const latest = [...campaigns].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )[0];
    latestCampaign = {
      id: latest.id,
      titleAr: latest.titleAr,
      status: latest.status,
      responseCount: latest._count.responses,
    };
  }

  return ok({
    campaignsByStatus,
    totals: {
      activeExecutives,
      activeQuestions,
      responses: totalResponses,
      campaigns: campaigns.length,
    },
    latestCampaign,
  });
});
