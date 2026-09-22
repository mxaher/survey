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
 * GET /api/admin/dashboard
 *
 * Admin dashboard summary. Auth required (both roles can read).
 *
 * Returns:
 *   - campaignsByStatus: { status, count }[]
 *   - totals: { activeExecutives, activeQuestions, responses, campaigns }
 *   - latestCampaign: { id, titleAr, status, responseCount } | null
 *   - orgDimensions: { dimension, labelAr, averageScore, responseCount }[]
 *       — org-wide leadership dimension averages across ALL active/closed
 *         campaigns' executive evaluations (respecting each campaign's
 *         threshold so low-N campaigns don't skew the average). Used by
 *         the dashboard "ملخص الأبعاد على مستوى المؤسسة" widget.
 *
 * "responses" is an anonymized aggregate count — we never expose any
 * employee identifier or join back to participation_ledger.
 */
export const GET = apiHandler(async () => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  // Group campaigns by status.
  const campaigns = await db.campaign.findMany({
    select: {
      id: true,
      titleAr: true,
      status: true,
      createdAt: true,
      minimumReportingThreshold: true,
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

  // ─── Participation rate ────────────────────────────────────────────
  // eligible_employees_count is a SystemSetting (admin-configurable).
  // distinct evaluators = distinct employeeHmac values with at least one
  // submitted participation_ledger row across active/closed campaigns.
  // participation rate = distinct evaluators / eligible × 100.
  // Both numbers are aggregates — no HMAC values are returned.
  const eligibleSetting = await db.systemSetting.findUnique({
    where: { key: "eligible_employees_count" },
  });
  const eligibleCount = eligibleSetting
    ? parseInt(eligibleSetting.valueAr, 10) || 0
    : 0;

  const distinctEvaluators = await db.participationLedger.groupBy({
    by: ["employeeHmac"],
    where: {
      status: "submitted",
      campaign: { status: { in: ["active", "closed"] } },
    },
    _count: { _all: true },
  });
  const distinctEvaluatorCount = distinctEvaluators.length;
  const participationRate =
    eligibleCount > 0
      ? Math.round((distinctEvaluatorCount / eligibleCount) * 10000) / 100
      : null;

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

  // ─── Org-wide leadership dimension averages ────────────────────────
  // Only include campaigns that are active or closed (draft/scheduled/
  // archived are excluded — they don't have meaningful response data).
  // For each campaign we additionally enforce the per-campaign threshold
  // per executive (so a 1-eval exec doesn't leak into the org average).
  const reportableCampaigns = campaigns.filter(
    (c) => c.status === "active" || c.status === "closed"
  );

  // Fetch per-(campaign × executive) distinct evaluation counts so we
  // can skip suppressed executives per-campaign.
  const dimByCampaign = new Map<
    string, // campaignId
    Map<string, { sum: number; valid: number; total: number }>
  >();

  if (reportableCampaigns.length > 0) {
    const campaignIds = reportableCampaigns.map((c) => c.id);
    const thresholdById = new Map(
      reportableCampaigns.map((c) => [c.id, c.minimumReportingThreshold])
    );

    // All leadership responses in those campaigns, joined with the
    // snapshot to get the dimension.
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

    // Per-(campaign × executive) distinct responseGroupId count → eval count.
    const evalCountByCampaignExec = new Map<string, Set<string>>();
    for (const r of responses) {
      const key = `${r.campaignId}::${r.executiveId ?? ""}`;
      const set = evalCountByCampaignExec.get(key) ?? new Set<string>();
      set.add(r.responseGroupId);
      evalCountByCampaignExec.set(key, set);
    }

    // Per-(campaign × executive × dimension) accumulator.
    const perExecDim = new Map<
      string, // `${campaignId}::${execId}::${dimension}`
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

    // For each campaign × exec × dimension, average the per-exec dimension
    // score (so each exec contributes equally regardless of how many
    // questions they answered in that dimension), then bucket by dimension
    // across the whole org — but only for executives that meet the
    // per-campaign threshold.
    const dimAccumulator = new Map<
      string,
      { sum: number; count: number; total: number }
    >();

    for (const [key, acc] of perExecDim.entries()) {
      const [campaignId, execId, dim] = key.split("::");
      const threshold = thresholdById.get(campaignId) ?? 5;
      const evalCount =
        evalCountByCampaignExec.get(`${campaignId}::${execId}`)?.size ?? 0;
      if (evalCount < threshold) continue; // skip suppressed execs
      if (acc.valid === 0) continue;

      const avg = acc.sum / acc.valid;
      const cur =
        dimAccumulator.get(dim) ?? { sum: 0, count: 0, total: 0 };
      cur.sum += avg;
      cur.count += 1;
      cur.total += acc.valid;
      dimAccumulator.set(dim, cur);
    }

    // Build the org-wide dimension array in LEADERSHIP_DIMENSIONS order.
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

    // Sort descending by averageScore for the strengths widget.
    const orgDimensions = [...orgDims].sort(
      (a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0)
    );

    return ok({
      campaignsByStatus,
      totals: {
        activeExecutives,
        activeQuestions,
        responses: totalResponses,
        campaigns: campaigns.length,
      },
      latestCampaign,
      orgDimensions,
      participation: {
        eligibleCount,
        distinctEvaluators: distinctEvaluatorCount,
        rate: participationRate,
      },
    });
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
    orgDimensions: [],
    participation: {
      eligibleCount,
      distinctEvaluators: distinctEvaluatorCount,
      rate: participationRate,
    },
  });
});
