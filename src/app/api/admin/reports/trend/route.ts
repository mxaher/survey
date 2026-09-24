import { NextRequest } from "next/server";
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
 * GET /api/admin/reports/trend?status=active|closed|all
 *
 * Cross-campaign trend / comparison view. Auth required (both roles).
 */
export const GET = apiHandler(
  async (request: NextRequest) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const statusFilter = request.nextUrl.searchParams.get("status") ?? "all";
    const allowedStatuses =
      statusFilter === "active"
        ? ["active"]
        : statusFilter === "closed"
        ? ["closed"]
        : ["active", "closed"];

    const placeholders = allowedStatuses.map(() => "?").join(",");
    const campaignsResult = await db.prepare(
      `SELECT id, titleAr, status, startsAt, endsAt, activatedAt,
              minimumReportingThreshold, timezone
       FROM Campaign
       WHERE status IN (${placeholders})
       ORDER BY activatedAt ASC`
    ).bind(...allowedStatuses).all();

    const campaigns = campaignsResult.results as Record<string, unknown>[];
    if (campaigns.length === 0) {
      return ok({ campaigns: [], statusFilter });
    }

    const campaignIds = campaigns.map((c) => c.id as string);
    const thresholdById = new Map(
      campaigns.map((c) => [c.id as string, c.minimumReportingThreshold as number])
    );

    const idPlaceholders = campaignIds.map(() => "?").join(",");

    // Pull leadership responses + snapshots
    const [responsesResult, snapshotsResult] = await Promise.all([
      db.prepare(
        `SELECT campaignId, executiveId, responseGroupId, questionSnapshotId, selectedScore
         FROM Response
         WHERE campaignId IN (${idPlaceholders}) AND responseType = 'executive'`
      ).bind(...campaignIds).all(),
      db.prepare(
        `SELECT id, campaignId, dimension
         FROM CampaignQuestionSnapshot
         WHERE campaignId IN (${idPlaceholders}) AND section = 'leadership' AND dimension IS NOT NULL`
      ).bind(...campaignIds).all(),
    ]);

    const responses = responsesResult.results as Record<string, unknown>[];
    const snapshots = snapshotsResult.results as Record<string, unknown>[];

    // snapshotId → dimension
    const snapDim = new Map<string, string>();
    for (const s of snapshots) snapDim.set(s.id as string, (s.dimension as string) ?? "");

    // Per-(campaign × exec) distinct responseGroupId count
    const evalCountByCampaignExec = new Map<string, Set<string>>();
    for (const r of responses) {
      const key = `${r.campaignId}::${r.executiveId ?? ""}`;
      const set = evalCountByCampaignExec.get(key) ?? new Set<string>();
      set.add(r.responseGroupId as string);
      evalCountByCampaignExec.set(key, set);
    }

    // Per-(campaign × exec × dimension) score accumulator
    const perExecDim = new Map<
      string,
      { sum: number; valid: number }
    >();
    for (const r of responses) {
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

    // Per-(campaign × dimension) accumulator
    const campaignDimAcc = new Map<
      string,
      { sum: number; count: number; total: number }
    >();

    for (const [key, acc] of perExecDim.entries()) {
      const [campaignId, execId, dim] = key.split("::");
      const threshold = thresholdById.get(campaignId) ?? 5;
      const evalCount =
        evalCountByCampaignExec.get(`${campaignId}::${execId}`)?.size ?? 0;
      if (evalCount < threshold) continue;
      if (acc.valid === 0) continue;

      const avg = acc.sum / acc.valid;
      const k = `${campaignId}::${dim}`;
      const cur =
        campaignDimAcc.get(k) ?? { sum: 0, count: 0, total: 0 };
      cur.sum += avg;
      cur.count += 1;
      cur.total += acc.valid;
      campaignDimAcc.set(k, cur);
    }

    // Participation counts
    const participationResult = await db.prepare(
      `SELECT campaignId, participationType, COUNT(*) as cnt
       FROM ParticipationLedger
       WHERE campaignId IN (${idPlaceholders}) AND status = 'submitted'
       GROUP BY campaignId, participationType`
    ).bind(...campaignIds).all();
    const participation = participationResult.results as Record<string, unknown>[];

    const participationByCampaignType = new Map<string, number>();
    for (const p of participation) {
      participationByCampaignType.set(
        `${p.campaignId}::${p.participationType}`,
        p.cnt as number
      );
    }

    // Distinct evaluators per campaign
    const distinctEvaluatorsResult = await db.prepare(
      `SELECT campaignId, COUNT(DISTINCT employeeHmac) as cnt
       FROM ParticipationLedger
       WHERE campaignId IN (${idPlaceholders})
         AND participationType = 'executive' AND status = 'submitted'
       GROUP BY campaignId`
    ).bind(...campaignIds).all();
    const distinctEvaluatorsByCampaign = new Map<string, number>();
    for (const row of distinctEvaluatorsResult.results as Record<string, unknown>[]) {
      distinctEvaluatorsByCampaign.set(
        row.campaignId as string,
        row.cnt as number
      );
    }

    // Eligible employees count
    const eligibleSetting = await db.prepare(
      `SELECT valueAr FROM SystemSetting WHERE key = ?`
    ).bind("eligible_employees_count").first() as Record<string, unknown> | null;
    const eligibleCount = eligibleSetting
      ? parseInt(eligibleSetting.valueAr as string, 10) || 0
      : 0;

    // Total responses per campaign
    const totalRespResult = await db.prepare(
      `SELECT campaignId, COUNT(*) as cnt
       FROM Response
       WHERE campaignId IN (${idPlaceholders})
       GROUP BY campaignId`
    ).bind(...campaignIds).all();
    const totalByCampaign = new Map<string, number>();
    for (const row of totalRespResult.results as Record<string, unknown>[]) {
      totalByCampaign.set(row.campaignId as string, row.cnt as number);
    }

    // Build per-campaign result
    const result = campaigns.map((c) => {
      const cId = c.id as string;

      const dims = LEADERSHIP_DIMENSIONS.map((d) => {
        const acc = campaignDimAcc.get(`${cId}::${d.key}`);
        return {
          dimension: d.key,
          labelAr: DIM_LABEL_AR[d.key] ?? d.labelAr,
          averageScore:
            acc && acc.count > 0 ? acc.sum / acc.count : null,
          executiveCount: acc?.count ?? 0,
          responseCount: acc?.total ?? 0,
        };
      }).filter((d) => d.averageScore !== null);

      const envCount = participationByCampaignType.get(`${cId}::environment`) ?? 0;
      const futureCount = participationByCampaignType.get(`${cId}::future`) ?? 0;
      const execEvalCount = participationByCampaignType.get(`${cId}::executive`) ?? 0;
      const distinctEvaluators = distinctEvaluatorsByCampaign.get(cId) ?? 0;

      return {
        campaign: {
          id: cId,
          titleAr: c.titleAr,
          status: c.status,
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          activatedAt: c.activatedAt,
          timezone: c.timezone,
          threshold: c.minimumReportingThreshold,
        },
        totalResponses: totalByCampaign.get(cId) ?? 0,
        environmentSubmittedCount: envCount,
        futureSubmittedCount: futureCount,
        executiveEvaluationCount: execEvalCount,
        distinctEvaluators,
        participationRate: eligibleCount > 0
          ? Math.round((distinctEvaluators / eligibleCount) * 10000) / 100
          : null,
        dimensionAverages: dims,
      };
    });

    return ok({ campaigns: result, statusFilter, eligibleCount });
  }
);
