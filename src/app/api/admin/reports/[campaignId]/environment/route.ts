import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { FAVORABLE_VALUES } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/[campaignId]/environment
 *
 * Aggregated environment report. Auth required (both roles).
 *
 * For each environment question snapshot:
 *   - count, validCount, averageScore, distribution, favorableRate, notApplicableCount
 *
 * Threshold suppression: if distinct submitters < minimumReportingThreshold,
 * the whole report is suppressed.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ campaignId: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { campaignId } = await ctx.params;
    const db = getDB();

    const campaign = await db.prepare(
      `SELECT id, titleAr, status, minimumReportingThreshold, enableEnvironmentSurvey
       FROM Campaign WHERE id = ?`
    ).bind(campaignId).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const threshold = campaign.minimumReportingThreshold as number;

    const [snapshotsResult, responsesResult, optionsResult] = await Promise.all([
      db.prepare(
        `SELECT id, questionCode, questionAr, questionType, section, dimension, isRequired, displayOrder, maxSelections
         FROM CampaignQuestionSnapshot
         WHERE campaignId = ? AND section = 'environment'
         ORDER BY displayOrder ASC`
      ).bind(campaignId).all(),
      db.prepare(
        `SELECT questionSnapshotId, responseGroupId, selectedValue, selectedScore
         FROM Response
         WHERE campaignId = ? AND responseType = 'environment'`
      ).bind(campaignId).all(),
      db.prepare(
        `SELECT cos.id AS snapshotId, cos.value, cos.labelAr, cos.score, cos.displayOrder
         FROM CampaignQuestionOptionSnapshot cos
         JOIN CampaignQuestionSnapshot cs ON cs.id = cos.campaignQuestionSnapshotId
         WHERE cs.campaignId = ? AND cs.section = 'environment'
         ORDER BY cos.displayOrder ASC`
      ).bind(campaignId).all(),
    ]);

    const snapshots = snapshotsResult.results as Record<string, unknown>[];
    const responses = responsesResult.results as Record<string, unknown>[];
    const allOptions = optionsResult.results as Record<string, unknown>[];

    const optionsBySnapshot = new Map<string, Record<string, unknown>[]>();
    for (const opt of allOptions) {
      const snapId = opt.snapshotId as string;
      if (!optionsBySnapshot.has(snapId)) optionsBySnapshot.set(snapId, []);
      optionsBySnapshot.get(snapId)!.push(opt);
    }

    // Whole-section suppression based on DISTINCT responseGroupId
    const distinctSubmitters = new Set(
      responses.map((r) => r.responseGroupId as string)
    ).size;

    if (distinctSubmitters < threshold) {
      return ok({
        suppressed: true,
        message: MESSAGES.belowThreshold,
        threshold,
        totalResponses: responses.length,
        distinctSubmitters,
        questions: [],
      });
    }

    // Group responses by questionSnapshotId
    const bySnapshot = new Map<string, Record<string, unknown>[]>();
    for (const r of responses) {
      const snapId = r.questionSnapshotId as string;
      const arr = bySnapshot.get(snapId) ?? [];
      arr.push(r);
      bySnapshot.set(snapId, arr);
    }

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
        count: optionBuckets.get(opt.value as string) ?? 0,
      }));

      const knownValues = new Set(snapOpts.map((o) => o.value as string));
      for (const [value, c] of optionBuckets) {
        if (!knownValues.has(value)) {
          distribution.push({ value, labelAr: value, count: c });
        }
      }

      const perQuestionSuppressed = count < threshold;

      return {
        snapshotId: snapId,
        questionCode: snap.questionCode,
        questionAr: snap.questionAr,
        dimension: snap.dimension,
        count,
        validCount,
        averageScore: perQuestionSuppressed ? null : averageScore,
        distribution: perQuestionSuppressed
          ? distribution.map((d) => ({ ...d, count: 0 }))
          : distribution,
        favorableRate: perQuestionSuppressed ? null : favorableRate,
        notApplicableCount: perQuestionSuppressed ? 0 : notApplicableCount,
        perQuestionSuppressed,
      };
    });

    return ok({
      suppressed: false,
      campaign: {
        id: campaign.id,
        titleAr: campaign.titleAr,
        status: campaign.status,
        minimumReportingThreshold: threshold,
        enableEnvironmentSurvey: campaign.enableEnvironmentSurvey,
      },
      totalResponses: responses.length,
      distinctSubmitters,
      questions,
    });
  }
);
