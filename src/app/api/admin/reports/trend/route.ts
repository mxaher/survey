import { NextRequest } from "next/server";
import { db } from "@/lib/db";
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
 *
 * Query param `status` filters which reportable campaigns are included:
 *   - `active`: only active campaigns
 *   - `closed`: only closed campaigns
 *   - `all` (default): both active + closed
 *
 * Returns, for every matching campaign:
 *   - campaign: { id, titleAr, status, startsAt, endsAt, activatedAt, threshold }
 *   - totalResponses
 *   - environmentSubmittedCount (distinct employees who submitted env)
 *   - futureSubmittedCount (distinct employees who submitted future)
 *   - executiveEvaluationCount (distinct (employee, exec) pairs)
 *   - distinctEvaluatorCount (distinct employees who evaluated ≥1 exec)
 *   - dimensionAverages: [{ dimension, labelAr, averageScore, executiveCount }]
 *
 * NEVER exposes raw Response rows or any employee identifier.
 */
export const GET = apiHandler(
  async (request: NextRequest) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const statusFilter = request.nextUrl.searchParams.get("status") ?? "all";
    const allowedStatuses =
      statusFilter === "active"
        ? ["active"]
        : statusFilter === "closed"
        ? ["closed"]
        : ["active", "closed"];

    // Only active/closed campaigns have meaningful data.
    const campaigns = await db.campaign.findMany({
      where: { status: { in: allowedStatuses } },
      select: {
        id: true,
        titleAr: true,
        status: true,
        startsAt: true,
        endsAt: true,
        activatedAt: true,
        minimumReportingThreshold: true,
        timezone: true,
      },
      orderBy: { activatedAt: "asc" },
    });

    if (campaigns.length === 0) {
      return ok({ campaigns: [], statusFilter });
    }

  const campaignIds = campaigns.map((c) => c.id);
  const thresholdById = new Map(
    campaigns.map((c) => [c.id, c.minimumReportingThreshold])
  );

  // Pull all leadership responses + snapshots (with dimension) for these campaigns.
  const [responses, snapshots] = await Promise.all([
    db.response.findMany({
      where: {
        campaignId: { in: campaignIds },
        responseType: "executive",
      },
      select: {
        campaignId: true,
        executiveId: true,
        responseGroupId: true,
        questionSnapshotId: true,
        selectedScore: true,
      },
    }),
    db.campaignQuestionSnapshot.findMany({
      where: {
        campaignId: { in: campaignIds },
        section: "leadership",
        dimension: { not: null },
      },
      select: { id: true, campaignId: true, dimension: true },
    }),
  ]);

  // snapshotId → dimension
  const snapDim = new Map<string, string>();
  for (const s of snapshots) snapDim.set(s.id, s.dimension ?? "");

  // Per-(campaign × exec) distinct responseGroupId count → eval count.
  const evalCountByCampaignExec = new Map<string, Set<string>>();
  for (const r of responses) {
    const key = `${r.campaignId}::${r.executiveId ?? ""}`;
    const set = evalCountByCampaignExec.get(key) ?? new Set<string>();
    set.add(r.responseGroupId);
    evalCountByCampaignExec.set(key, set);
  }

  // Per-(campaign × exec × dimension) score accumulator.
  const perExecDim = new Map<
    string, // `${campaignId}::${execId}::${dim}`
    { sum: number; valid: number }
  >();
  for (const r of responses) {
    const dim = snapDim.get(r.questionSnapshotId);
    if (!dim) continue;
    const key = `${r.campaignId}::${r.executiveId ?? ""}::${dim}`;
    const acc = perExecDim.get(key) ?? { sum: 0, valid: 0 };
    if (r.selectedScore !== null) {
      acc.sum += r.selectedScore;
      acc.valid += 1;
    }
    perExecDim.set(key, acc);
  }

  // Per-(campaign × dimension) accumulator: average of per-exec dimension averages
  // (each exec contributes equally). Only execs meeting the per-campaign threshold
  // are included.
  const campaignDimAcc = new Map<
    string, // `${campaignId}::${dim}`
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

  // Participation counts per campaign (env + future submitted + exec evals +
  // distinct evaluators). These come from ParticipationLedger — but we
  // ONLY surface aggregate counts, never the HMAC.
  const participation = await db.participationLedger.groupBy({
    by: ["campaignId", "participationType"],
    where: { campaignId: { in: campaignIds }, status: "submitted" },
    _count: { _all: true },
  });

  // Distinct evaluators per campaign = distinct employeeHmac values with
  // at least one executive participation row for that campaign. Computed
  // via a raw-ish groupBy on (campaignId, employeeHmac) then counting rows
  // per campaign. We DO NOT return the HMAC values themselves — only the
  // count per campaign.
  const distinctEvaluatorsRaw = await db.participationLedger.groupBy({
    by: ["campaignId", "employeeHmac"],
    where: {
      campaignId: { in: campaignIds },
      participationType: "executive",
      status: "submitted",
    },
    _count: { _all: true },
  });
  const distinctEvaluatorsByCampaign = new Map<string, number>();
  for (const row of distinctEvaluatorsRaw) {
    distinctEvaluatorsByCampaign.set(
      row.campaignId,
      (distinctEvaluatorsByCampaign.get(row.campaignId) ?? 0) + 1
    );
  }

  // Eligible employees count (admin-configurable SystemSetting) — used to
  // compute per-campaign participation rate. If unset, rates are null.
  const eligibleSetting = await db.systemSetting.findUnique({
    where: { key: "eligible_employees_count" },
  });
  const eligibleCount = eligibleSetting
    ? parseInt(eligibleSetting.valueAr, 10) || 0
    : 0;

  // Build per-campaign result.
  const result = campaigns.map((c) => {
    // dimensionAverages for this campaign
    const dims = LEADERSHIP_DIMENSIONS.map((d) => {
      const acc = campaignDimAcc.get(`${c.id}::${d.key}`);
      return {
        dimension: d.key,
        labelAr: DIM_LABEL_AR[d.key] ?? d.labelAr,
        averageScore:
          acc && acc.count > 0 ? acc.sum / acc.count : null,
        executiveCount: acc?.count ?? 0,
        responseCount: acc?.total ?? 0,
      };
    }).filter((d) => d.averageScore !== null);

    // participation counts
    const envCount =
      participation.find(
        (p) => p.campaignId === c.id && p.participationType === "environment"
      )?._count._all ?? 0;
    const futureCount =
      participation.find(
        (p) => p.campaignId === c.id && p.participationType === "future"
      )?._count._all ?? 0;
    const execEvalCount =
      participation.find(
        (p) => p.campaignId === c.id && p.participationType === "executive"
      )?._count._all ?? 0;

    // distinct evaluators from the dedicated groupBy above.
    const distinctEvaluators =
      distinctEvaluatorsByCampaign.get(c.id) ?? 0;

    return {
      campaign: {
        id: c.id,
        titleAr: c.titleAr,
        status: c.status,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        activatedAt: c.activatedAt,
        timezone: c.timezone,
        threshold: c.minimumReportingThreshold,
      },
      totalResponses: responses.filter((r) => r.campaignId === c.id).length,
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
