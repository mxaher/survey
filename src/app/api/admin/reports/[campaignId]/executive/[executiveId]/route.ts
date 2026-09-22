import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { FAVORABLE_VALUES, LEADERSHIP_DIMENSIONS } from "@/lib/constants";

export const dynamic = "force-dynamic";

interface ExecResponseRow {
  questionSnapshotId: string;
  selectedValue: string;
  selectedScore: number | null;
}

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
 *   - questions: per-snapshot { snapshotId, questionCode, questionAr,
 *       dimension, count, validCount, averageScore, distribution,
 *       favorableRate, notApplicableCount }
 *   - dimensions: [{ dimension, dimensionLabelAr, averageScore,
 *       questionCount }]
 *   - strength: { dimension, dimensionLabelAr, averageScore } | null
 *   - improvement: { dimension, dimensionLabelAr, averageScore } | null
 *   - orgWideComparison: {
 *       totalResponses, suppressed,
 *       dimensions: [{ dimension, dimensionLabelAr, averageScore }]
 *     }
 *
 * Threshold suppression (spec §13.6): if evaluationCount <
 * `minimumReportingThreshold`, return `{ suppressed: true, message }`
 * and nothing else.
 *
 * NEVER exposes raw Response rows or any employee identifier.
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

    const [campaign, executive] = await Promise.all([
      db.campaign.findUnique({
        where: { id: campaignId },
        select: {
          id: true,
          titleAr: true,
          status: true,
          minimumReportingThreshold: true,
        },
      }),
      db.executive.findUnique({
        where: { id: executiveId },
        select: {
          id: true,
          nameAr: true,
          titleAr: true,
          category: true,
          departmentAr: true,
        },
      }),
    ]);

    if (!campaign) return fail("الحملة غير موجودة.", 404);
    if (!executive) return fail("المسؤول غير موجود.", 404);

    const threshold = campaign.minimumReportingThreshold;

    // Pull the leadership snapshots (with options) + this exec's
    // responses + the org-wide exec responses (for comparison).
    const [snapshots, execResponses, orgResponses] = await Promise.all([
      db.campaignQuestionSnapshot.findMany({
        where: { campaignId, section: "leadership" },
        include: { options: true },
        orderBy: { displayOrder: "asc" },
      }),
      db.response.findMany({
        where: {
          campaignId,
          executiveId,
          responseType: "executive",
        },
        select: {
          questionSnapshotId: true,
          responseGroupId: true,
          selectedValue: true,
          selectedScore: true,
        },
      }),
      db.response.findMany({
        where: { campaignId, responseType: "executive" },
        select: {
          questionSnapshotId: true,
          selectedValue: true,
          selectedScore: true,
        },
      }),
    ]);

    // Number of distinct evaluations (responseGroupId).
    const evalGroupIds = new Set(execResponses.map((r) => r.responseGroupId));
    const evaluationCount = evalGroupIds.size;

    // Threshold suppression — return BEFORE exposing any per-question
    // aggregates so we can't leak a small number of responses.
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

    // Per-question aggregates for this exec.
    const bySnapshot = new Map<string, ExecResponseRow[]>();
    for (const r of execResponses) {
      const arr = bySnapshot.get(r.questionSnapshotId) ?? [];
      arr.push(r);
      bySnapshot.set(r.questionSnapshotId, arr);
    }

    const questionAverages = new Map<
      string,
      { snapshotId: string; dimension: string | null; averageScore: number | null }
    >();

    const questions = snapshots.map((snap) => {
      const rows = bySnapshot.get(snap.id) ?? [];
      const count = rows.length;
      const validRows = rows.filter((r) => r.selectedScore !== null);
      const validCount = validRows.length;
      const sumScore = validRows.reduce(
        (acc, r) => acc + (r.selectedScore ?? 0),
        0
      );
      const averageScore = validCount > 0 ? sumScore / validCount : null;
      const favorableCount = rows.filter((r) =>
        FAVORABLE_VALUES.has(r.selectedValue)
      ).length;
      const favorableRate =
        validCount > 0 ? favorableCount / validCount : null;
      const notApplicableCount = rows.filter(
        (r) => r.selectedValue === "not_applicable"
      ).length;

      const optionBuckets = new Map<string, number>();
      for (const r of rows) {
        optionBuckets.set(
          r.selectedValue,
          (optionBuckets.get(r.selectedValue) ?? 0) + 1
        );
      }
      const distribution = snap.options
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((opt) => ({
          value: opt.value,
          labelAr: opt.labelAr,
          count: optionBuckets.get(opt.value) ?? 0,
        }));
      const knownValues = new Set(snap.options.map((o) => o.value));
      for (const [value, c] of optionBuckets) {
        if (!knownValues.has(value)) {
          distribution.push({ value, labelAr: value, count: c });
        }
      }

      questionAverages.set(snap.id, {
        snapshotId: snap.id,
        dimension: snap.dimension,
        averageScore,
      });

      return {
        snapshotId: snap.id,
        questionCode: snap.questionCode,
        questionAr: snap.questionAr,
        dimension: snap.dimension,
        count,
        validCount,
        averageScore,
        distribution,
        favorableRate,
        notApplicableCount,
      };
    });

    // Per-dimension rollups: average of the per-question averages for
    // questions in that dimension. Questions with `averageScore === null`
    // (e.g., no valid responses, or a multi-choice question with no
    // score) are excluded from the rollup denominator.
    const dimBucket = new Map<
      string,
      { sum: number; count: number }
    >();
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

    // Strength (highest) & improvement (lowest) by dimension score.
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

    // Organization-wide comparison: aggregate across ALL execs for this
    // campaign, compute per-dimension averages the same way.
    const orgBySnapshot = new Map<string, ExecResponseRow[]>();
    for (const r of orgResponses) {
      const arr = orgBySnapshot.get(r.questionSnapshotId) ?? [];
      arr.push(r);
      orgBySnapshot.set(r.questionSnapshotId, arr);
    }

    const orgDimBucket = new Map<
      string,
      { sum: number; count: number }
    >();
    for (const snap of snapshots) {
      const rows = orgBySnapshot.get(snap.id) ?? [];
      const validRows = rows.filter((r) => r.selectedScore !== null);
      const validCount = validRows.length;
      const sumScore = validRows.reduce(
        (acc, r) => acc + (r.selectedScore ?? 0),
        0
      );
      const qAvg = validCount > 0 ? sumScore / validCount : null;
      if (!snap.dimension || qAvg === null) continue;
      const cur = orgDimBucket.get(snap.dimension) ?? { sum: 0, count: 0 };
      cur.sum += qAvg;
      cur.count += 1;
      orgDimBucket.set(snap.dimension, cur);
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
