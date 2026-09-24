import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { FAVORABLE_VALUES, LEADERSHIP_DIMENSIONS } from "@/lib/constants";

export const dynamic = "force-dynamic";

const DIM_LABEL_AR: Record<string, string> = Object.fromEntries(
  LEADERSHIP_DIMENSIONS.map((d) => [d.key, d.labelAr])
);

/**
 * GET /api/admin/reports/[campaignId]/executive/[executiveId]
 *
 * Per-executive aggregated report. Auth required (both roles).
 *
 * Returns:
 *   - evaluationCount: distinct responseGroupId (campaign + exec)
 *   - questions: per-snapshot aggregates
 *   - dimensions: per-dimension rollup
 *   - strength / improvement
 *   - orgWideComparison
 *
 * Threshold suppression: if evaluationCount < minimumReportingThreshold,
 * return { suppressed: true } and nothing else.
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

    const [campaign, executive] = await Promise.all([
      db.prepare(
        `SELECT id, titleAr, status, minimumReportingThreshold
         FROM Campaign WHERE id = ?`
      ).bind(campaignId).first() as Promise<Record<string, unknown> | null>,
      db.prepare(
        `SELECT id, nameAr, titleAr, category, departmentAr
         FROM Executive WHERE id = ?`
      ).bind(executiveId).first() as Promise<Record<string, unknown> | null>,
    ]);

    if (!campaign) return fail("الحملة غير موجودة.", 404);
    if (!executive) return fail("المسؤول غير موجود.", 404);

    const threshold = campaign.minimumReportingThreshold as number;

    // Pull snapshots + options + this exec's responses + org-wide responses
    const [snapshotsResult, execResponsesResult, orgResponsesResult, optionsResult] = await Promise.all([
      db.prepare(
        `SELECT id, questionCode, questionAr, section, dimension, displayOrder
         FROM CampaignQuestionSnapshot
         WHERE campaignId = ? AND section = 'leadership'
         ORDER BY displayOrder ASC`
      ).bind(campaignId).all(),
      db.prepare(
        `SELECT questionSnapshotId, responseGroupId, selectedValue, selectedScore
         FROM Response
         WHERE campaignId = ? AND executiveId = ? AND responseType = 'executive'`
      ).bind(campaignId, executiveId).all(),
      db.prepare(
        `SELECT questionSnapshotId, selectedValue, selectedScore
         FROM Response
         WHERE campaignId = ? AND responseType = 'executive'`
      ).bind(campaignId).all(),
      db.prepare(
        `SELECT cos.id AS snapshotId, cos.value, cos.labelAr, cos.displayOrder
         FROM CampaignQuestionOptionSnapshot cos
         JOIN CampaignQuestionSnapshot cs ON cs.id = cos.campaignQuestionSnapshotId
         WHERE cs.campaignId = ? AND cs.section = 'leadership'
         ORDER BY cos.displayOrder ASC`
      ).bind(campaignId).all(),
    ]);

    const snapshots = snapshotsResult.results as Record<string, unknown>[];
    const execResponses = execResponsesResult.results as Record<string, unknown>[];
    const orgResponses = orgResponsesResult.results as Record<string, unknown>[];
    const allOptions = optionsResult.results as Record<string, unknown>[];

    const optionsBySnapshot = new Map<string, Record<string, unknown>[]>();
    for (const opt of allOptions) {
      const snapId = opt.snapshotId as string;
      if (!optionsBySnapshot.has(snapId)) optionsBySnapshot.set(snapId, []);
      optionsBySnapshot.get(snapId)!.push(opt);
    }

    // Number of distinct evaluations (responseGroupId)
    const evalGroupIds = new Set(execResponses.map((r) => r.responseGroupId as string));
    const evaluationCount = evalGroupIds.size;

    // Threshold suppression
    if (evaluationCount < threshold) {
      return ok({
        suppressed: true,
        message: MESSAGES.belowThreshold,
        threshold,
        evaluationCount,
        campaign: {
          id: campaign.id,
          titleAr: campaign.titleAr,
          status: campaign.status,
        },
        executive: {
          id: executive.id,
          nameAr: executive.nameAr,
          titleAr: executive.titleAr,
        },
        questions: [],
        dimensions: [],
        strength: null,
        improvement: null,
        orgWideComparison: null,
      });
    }

    // Per-question aggregates for this exec
    const bySnapshot = new Map<string, Record<string, unknown>[]>();
    for (const r of execResponses) {
      const snapId = r.questionSnapshotId as string;
      const arr = bySnapshot.get(snapId) ?? [];
      arr.push(r);
      bySnapshot.set(snapId, arr);
    }

    const questionAverages = new Map<
      string,
      { snapshotId: string; dimension: string | null; averageScore: number | null }
    >();

    const questions = snapshots.map((snap) => {
      const snapId = snap.id as string;
      const rows = bySnapshot.get(snapId) ?? [];
      const count = rows.length;
      const validRows = rows.filter((r) => r.selectedScore !== null);
      const validCount = validRows.length;
      const sumScore = validRows.reduce(
        (acc, r) => acc + ((r.selectedScore as number) ?? 0),
        0
      );
      const averageScore = validCount > 0 ? sumScore / validCount : null;
      const favorableCount = rows.filter((r) =>
        FAVORABLE_VALUES.has(r.selectedValue as string)
      ).length;
      const favorableRate =
        validCount > 0 ? favorableCount / validCount : null;
      const notApplicableCount = rows.filter(
        (r) => r.selectedValue === "not_applicable"
      ).length;

      const perQuestionSuppressed = count < threshold;

      const optionBuckets = new Map<string, number>();
      for (const r of rows) {
        const val = r.selectedValue as string;
        optionBuckets.set(val, (optionBuckets.get(val) ?? 0) + 1);
      }

      const snapOpts = (optionsBySnapshot.get(snapId) ?? [])
        .slice()
        .sort((a, b) => (a.displayOrder as number) - (b.displayOrder as number));

      const distribution = snapOpts.map((opt) => ({
        value: opt.value as string,
        labelAr: opt.labelAr as string,
        count: perQuestionSuppressed ? 0 : (optionBuckets.get(opt.value as string) ?? 0),
      }));
      const knownValues = new Set(snapOpts.map((o) => o.value as string));
      for (const [value, c] of optionBuckets) {
        if (!knownValues.has(value)) {
          distribution.push({
            value,
            labelAr: value,
            count: perQuestionSuppressed ? 0 : c,
          });
        }
      }

      questionAverages.set(snapId, {
        snapshotId: snapId,
        dimension: snap.dimension as string | null,
        averageScore: perQuestionSuppressed ? null : averageScore,
      });

      return {
        snapshotId: snapId,
        questionCode: snap.questionCode,
        questionAr: snap.questionAr,
        dimension: snap.dimension,
        count,
        validCount,
        averageScore: perQuestionSuppressed ? null : averageScore,
        distribution,
        favorableRate: perQuestionSuppressed ? null : favorableRate,
        notApplicableCount: perQuestionSuppressed ? 0 : notApplicableCount,
        perQuestionSuppressed,
      };
    });

    // Per-dimension rollups
    const dimBucket = new Map<string, { sum: number; count: number }>();
    for (const q of questionAverages.values()) {
      if (!q.dimension || q.averageScore === null) continue;
      const cur = dimBucket.get(q.dimension) ?? { sum: 0, count: 0 };
      cur.sum += q.averageScore;
      cur.count += 1;
      dimBucket.set(q.dimension, cur);
    }
    const dimensions = Array.from(dimBucket.entries())
      .map(([dimension, v]) => ({
        dimension,
        dimensionLabelAr: DIM_LABEL_AR[dimension] ?? dimension,
        averageScore: v.count > 0 ? v.sum / v.count : null,
        questionCount: v.count,
      }))
      .filter((d) => d.averageScore !== null) as Array<{
      dimension: string;
      dimensionLabelAr: string;
      averageScore: number;
      questionCount: number;
    }>;

    // Strength & improvement
    let strength: {
      dimension: string;
      dimensionLabelAr: string;
      averageScore: number;
    } | null = null;
    let improvement: {
      dimension: string;
      dimensionLabelAr: string;
      averageScore: number;
    } | null = null;
    if (dimensions.length > 0) {
      const sorted = [...dimensions].sort(
        (a, b) => b.averageScore - a.averageScore
      );
      strength = sorted[0];
      improvement = sorted[sorted.length - 1];
    }

    // Organization-wide comparison
    const orgBySnapshot = new Map<string, Record<string, unknown>[]>();
    for (const r of orgResponses) {
      const snapId = r.questionSnapshotId as string;
      const arr = orgBySnapshot.get(snapId) ?? [];
      arr.push(r);
      orgBySnapshot.set(snapId, arr);
    }

    const orgDimBucket = new Map<string, { sum: number; count: number }>();
    for (const snap of snapshots) {
      const snapId = snap.id as string;
      const rows = orgBySnapshot.get(snapId) ?? [];
      const validRows = rows.filter((r) => r.selectedScore !== null);
      const validCount = validRows.length;
      const sumScore = validRows.reduce(
        (acc, r) => acc + ((r.selectedScore as number) ?? 0),
        0
      );
      const qAvg = validCount > 0 ? sumScore / validCount : null;
      if (!snap.dimension || qAvg === null) continue;
      const cur = orgDimBucket.get(snap.dimension as string) ?? { sum: 0, count: 0 };
      cur.sum += qAvg;
      cur.count += 1;
      orgDimBucket.set(snap.dimension as string, cur);
    }
    const orgDimensions = Array.from(orgDimBucket.entries())
      .map(([dimension, v]) => ({
        dimension,
        dimensionLabelAr: DIM_LABEL_AR[dimension] ?? dimension,
        averageScore: v.count > 0 ? v.sum / v.count : null,
      }))
      .filter((d) => d.averageScore !== null) as Array<{
      dimension: string;
      dimensionLabelAr: string;
      averageScore: number;
    }>;

    const orgWideComparison = {
      totalResponses: orgResponses.length,
      suppressed: orgResponses.length < threshold,
      dimensions: orgDimensions,
    };

    return ok({
      suppressed: false,
      threshold,
      evaluationCount,
      campaign: {
        id: campaign.id,
        titleAr: campaign.titleAr,
        status: campaign.status,
      },
      executive: {
        id: executive.id,
        nameAr: executive.nameAr,
        titleAr: executive.titleAr,
        category: executive.category,
        departmentAr: executive.departmentAr,
      },
      questions,
      dimensions,
      strength,
      improvement,
      orgWideComparison,
    });
  }
);
