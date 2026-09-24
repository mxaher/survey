import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/[campaignId]/future
 *
 * Aggregated future-survey report. Auth required (both roles).
 *
 * For each future question snapshot, returns the distribution of
 * selected values as `{ value, labelAr, count, percentage }[]`.
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
      `SELECT id, titleAr, status, minimumReportingThreshold, enableFutureSurvey
       FROM Campaign WHERE id = ?`
    ).bind(campaignId).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const threshold = campaign.minimumReportingThreshold as number;

    const [snapshotsResult, responsesResult, optionsResult] = await Promise.all([
      db.prepare(
        `SELECT id, questionCode, questionAr, questionType, section, dimension, isRequired, displayOrder, maxSelections
         FROM CampaignQuestionSnapshot
         WHERE campaignId = ? AND section = 'future'
         ORDER BY displayOrder ASC`
      ).bind(campaignId).all(),
      db.prepare(
        `SELECT questionSnapshotId, responseGroupId, selectedValue
         FROM Response
         WHERE campaignId = ? AND responseType = 'future'`
      ).bind(campaignId).all(),
      db.prepare(
        `SELECT cos.id AS snapshotId, cos.value, cos.labelAr, cos.score, cos.displayOrder
         FROM CampaignQuestionOptionSnapshot cos
         JOIN CampaignQuestionSnapshot cs ON cs.id = cos.campaignQuestionSnapshotId
         WHERE cs.campaignId = ? AND cs.section = 'future'
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
    const bySnapshot = new Map<string, string[]>();
    for (const r of responses) {
      const snapId = r.questionSnapshotId as string;
      const arr = bySnapshot.get(snapId) ?? [];
      arr.push(r.selectedValue as string);
      bySnapshot.set(snapId, arr);
    }

    const questions = snapshots.map((snap) => {
      const snapId = snap.id as string;
      const values = bySnapshot.get(snapId) ?? [];
      const total = values.length;

      const buckets = new Map<string, number>();
      for (const v of values) {
        buckets.set(v, (buckets.get(v) ?? 0) + 1);
      }

      const perQuestionSuppressed = total < threshold;

      const snapOpts = (optionsBySnapshot.get(snapId) ?? [])
        .slice()
        .sort((a, b) => (a.displayOrder as number) - (b.displayOrder as number));

      const distribution = snapOpts.map((opt) => {
        const c = perQuestionSuppressed ? 0 : (buckets.get(opt.value as string) ?? 0);
        return {
          value: opt.value as string,
          labelAr: opt.labelAr as string,
          count: c,
          percentage:
            perQuestionSuppressed || total === 0
              ? 0
              : Math.round((c / total) * 10000) / 100,
        };
      });

      // Catch-all for unknown values
      const knownValues = new Set(snapOpts.map((o) => o.value as string));
      for (const [value, c] of buckets) {
        if (!knownValues.has(value)) {
          distribution.push({
            value,
            labelAr: value,
            count: perQuestionSuppressed ? 0 : c,
            percentage:
              perQuestionSuppressed || total === 0
                ? 0
                : Math.round((c / total) * 10000) / 100,
          });
        }
      }

      return {
        snapshotId: snapId,
        questionCode: snap.questionCode,
        questionAr: snap.questionAr,
        questionType: snap.questionType,
        dimension: snap.dimension,
        total,
        distribution,
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
        enableFutureSurvey: campaign.enableFutureSurvey,
      },
      totalResponses: responses.length,
      distinctSubmitters,
      questions,
    });
  }
);
