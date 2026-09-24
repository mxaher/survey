import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { LEADERSHIP_DIMENSIONS } from "@/lib/constants";

export const dynamic = "force-dynamic";

const DIM_LABEL_AR: Record<string, string> = Object.fromEntries(
  LEADERSHIP_DIMENSIONS.map((d) => [d.key, d.labelAr])
);

/**
 * GET /api/admin/dashboard
 *
 * Admin dashboard summary. Auth required (both roles can read).
 */
export const GET = apiHandler(async () => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const db = getDB();

  // Group campaigns by status with response counts.
  const campaignsRaw = await db.prepare(
    `SELECT c.id, c.titleAr, c.status, c.createdAt, c.minimumReportingThreshold,
      (SELECT COUNT(*) FROM Response WHERE campaignId = c.id) AS responseCount
     FROM Campaign c ORDER BY c.createdAt DESC`
  ).all();

  const statusCounts = new Map<string, number>();
  for (const c of campaignsRaw.results) {
    const status = c.status as string;
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const campaignsByStatus = Array.from(statusCounts.entries()).map(
    ([status, count]) => ({ status, count })
  );

  const [activeExecutives, activeQuestions, totalResponses] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as cnt FROM Executive WHERE isActive = 1 AND deletedAt IS NULL`).first<{ cnt: number }>(),
    db.prepare(`SELECT COUNT(*) as cnt FROM Question WHERE isActive = 1 AND deletedAt IS NULL`).first<{ cnt: number }>(),
    db.prepare(`SELECT COUNT(*) as cnt FROM Response`).first<{ cnt: number }>(),
  ]);

  // Participation rate
  const eligibleSetting = await db.prepare(
    `SELECT * FROM SystemSetting WHERE key = ?`
  ).bind("eligible_employees_count").first() as Record<string, unknown> | null;
  const eligibleCount = eligibleSetting
    ? parseInt(eligibleSetting.valueAr as string, 10) || 0
    : 0;

  const distinctEvaluators = await db.prepare(
    `SELECT DISTINCT pl.employeeHmac
     FROM ParticipationLedger pl
     JOIN Campaign c ON c.id = pl.campaignId
     WHERE pl.status = 'submitted' AND c.status IN ('active', 'closed')`
  ).all();
  const distinctEvaluatorCount = distinctEvaluators.results.length;
  const participationRate =
    eligibleCount > 0
      ? Math.round((distinctEvaluatorCount / eligibleCount) * 10000) / 100
      : null;

  // Recent activity (last 5 audit entries)
  const recentActivityRaw = await db.prepare(
    `SELECT * FROM AuditLog ORDER BY createdAt DESC LIMIT 5`
  ).all();
  const adminIds = Array.from(
    new Set(
      recentActivityRaw.results
        .map((a) => a.adminUserId as string | null)
        .filter((id): id is string => id !== null)
    )
  );
  let adminUsers: Record<string, unknown>[] = [];
  if (adminIds.length > 0) {
    const placeholders = adminIds.map(() => "?").join(",");
    adminUsers = (await db.prepare(
      `SELECT id, displayName, externalId, role FROM AdminUser WHERE id IN (${placeholders})`
    ).bind(...adminIds).all()).results as Record<string, unknown>[];
  }
  const adminUserById = new Map(adminUsers.map((u) => [u.id, u]));
  const recentActivity = recentActivityRaw.results.map((a) => {
    const u = a.adminUserId ? adminUserById.get(a.adminUserId as string) : null;
    return {
      id: a.id,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      campaignId: a.campaignId,
      createdAt: a.createdAt,
      adminDisplayName: (u?.displayName as string) ?? (u?.externalId as string) ?? "—",
      adminRole: (u?.role as string) ?? null,
    };
  });

  // Latest campaign snapshot
  let latestCampaign: {
    id: string;
    titleAr: string;
    status: string;
    responseCount: number;
  } | null = null;

  if (campaignsRaw.results.length > 0) {
    const latest = campaignsRaw.results[0] as Record<string, unknown>;
    latestCampaign = {
      id: latest.id as string,
      titleAr: latest.titleAr as string,
      status: latest.status as string,
      responseCount: latest.responseCount as number,
    };
  }

  // Org-wide leadership dimension averages
  const reportableCampaigns = campaignsRaw.results.filter(
    (c) => c.status === "active" || c.status === "closed"
  );

  const dimByCampaign = new Map<
    string,
    Map<string, { sum: number; valid: number; total: number }>
  >();

  if (reportableCampaigns.length > 0) {
    const campaignIds = reportableCampaigns.map((c) => c.id as string);
    const thresholdById = new Map(
      reportableCampaigns.map((c) => [c.id as string, c.minimumReportingThreshold as number])
    );

    const placeholders = campaignIds.map(() => "?").join(",");
    const [responses, snapshots] = await Promise.all([
      db.prepare(
        `SELECT campaignId, executiveId, responseGroupId, questionSnapshotId, selectedScore
         FROM Response
         WHERE campaignId IN (${placeholders}) AND responseType = 'executive'`
      ).bind(...campaignIds).all(),
      db.prepare(
        `SELECT id, campaignId, dimension
         FROM CampaignQuestionSnapshot
         WHERE campaignId IN (${placeholders}) AND section = 'leadership' AND dimension IS NOT NULL`
      ).bind(...campaignIds).all(),
    ]);

    const snapDim = new Map<string, string>();
    for (const s of snapshots.results) snapDim.set(s.id as string, (s.dimension as string) ?? "");

    const evalCountByCampaignExec = new Map<string, Set<string>>();
    for (const r of responses.results) {
      const key = `${r.campaignId}::${r.executiveId ?? ""}`;
      const set = evalCountByCampaignExec.get(key) ?? new Set<string>();
      set.add(r.responseGroupId as string);
      evalCountByCampaignExec.set(key, set);
    }

    const perExecDim = new Map<string, { sum: number; valid: number }>();

    for (const r of responses.results) {
      const dim = snapDim.get(r.questionSnapshotId as string);
      if (!dim) continue;
      const key = `${r.campaignId}::${r.executiveId ?? ""}::${dim}`;
      const acc = perExecDim.get(key) ?? { sum: 0, valid: 0 };
      if (r.selectedScore !== null) {
        acc.sum += r.selectedScore as number;
        acc.valid += 1;
      }
      perExecDim.set(key, acc);
    }

    const dimAccumulator = new Map<string, { sum: number; count: number; total: number }>();

    for (const [key, acc] of perExecDim.entries()) {
      const [campaignId, execId, dim] = key.split("::");
      const threshold = thresholdById.get(campaignId) ?? 5;
      const evalCount = evalCountByCampaignExec.get(`${campaignId}::${execId}`)?.size ?? 0;
      if (evalCount < threshold) continue;
      if (acc.valid === 0) continue;

      const avg = acc.sum / acc.valid;
      const cur = dimAccumulator.get(dim) ?? { sum: 0, count: 0, total: 0 };
      cur.sum += avg;
      cur.count += 1;
      cur.total += acc.valid;
      dimAccumulator.set(dim, cur);
    }

    const orgDims = LEADERSHIP_DIMENSIONS.map((d) => {
      const acc = dimAccumulator.get(d.key);
      return {
        dimension: d.key,
        labelAr: DIM_LABEL_AR[d.key] ?? d.labelAr,
        averageScore: acc && acc.count > 0 ? acc.sum / acc.count : null,
        executiveCount: acc?.count ?? 0,
        responseCount: acc?.total ?? 0,
      };
    }).filter((d) => d.averageScore !== null);

    const orgDimensions = [...orgDims].sort(
      (a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0)
    );

    return ok({
      campaignsByStatus,
      totals: {
        activeExecutives: activeExecutives?.cnt ?? 0,
        activeQuestions: activeQuestions?.cnt ?? 0,
        responses: totalResponses?.cnt ?? 0,
        campaigns: campaignsRaw.results.length,
      },
      latestCampaign,
      orgDimensions,
      participation: {
        eligibleCount,
        distinctEvaluators: distinctEvaluatorCount,
        rate: participationRate,
      },
      recentActivity,
    });
  }

  return ok({
    campaignsByStatus,
    totals: {
      activeExecutives: activeExecutives?.cnt ?? 0,
      activeQuestions: activeQuestions?.cnt ?? 0,
      responses: totalResponses?.cnt ?? 0,
      campaigns: campaignsRaw.results.length,
    },
    latestCampaign,
    orgDimensions: [],
    participation: {
      eligibleCount,
      distinctEvaluators: distinctEvaluatorCount,
      rate: participationRate,
    },
    recentActivity,
  });
});
