import { NextRequest } from "next/server";
import { db } from "@/lib/db";
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
 * `percentage` is `count / questionTotal * 100` rounded to 2 dp.
 *
 * Threshold suppression (spec §13.6): if the total future responses
 * for this campaign are below `minimumReportingThreshold`, the whole
 * report is suppressed — return `{ suppressed: true, message }` and
 * nothing else.
 *
 * NEVER exposes raw Response rows or any employee identifier.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ campaignId: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { campaignId } = await ctx.params;

    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        titleAr: true,
        status: true,
        minimumReportingThreshold: true,
        enableFutureSurvey: true,
      },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const [snapshots, responses] = await Promise.all([
      db.campaignQuestionSnapshot.findMany({
        where: { campaignId, section: "future" },
        include: { options: true },
        orderBy: { displayOrder: "asc" },
      }),
      db.response.findMany({
        where: { campaignId, responseType: "future" },
        select: {
          questionSnapshotId: true,
          selectedValue: true,
        },
      }),
    ]);

    const threshold = campaign.minimumReportingThreshold;

    if (responses.length < threshold) {
      return ok({
        suppressed: true,
        message: MESSAGES.belowThreshold,
        threshold,
        totalResponses: responses.length,
        questions: [],
      });
    }

    // Group responses by questionSnapshotId.
    const bySnapshot = new Map<string, string[]>();
    for (const r of responses) {
      const arr = bySnapshot.get(r.questionSnapshotId) ?? [];
      arr.push(r.selectedValue);
      bySnapshot.set(r.questionSnapshotId, arr);
    }

    const questions = snapshots.map((snap) => {
      const values = bySnapshot.get(snap.id) ?? [];
      const total = values.length;

      const buckets = new Map<string, number>();
      for (const v of values) {
        buckets.set(v, (buckets.get(v) ?? 0) + 1);
      }

      // Per-question threshold suppression: if this individual question has
      // fewer responses than the campaign threshold, mask the distribution
      // counts (but still return the question text + raw total so the UI
      // can show "أقل من حد الإخفاء"). Protects against re-identification
      // via low-N questions inside an otherwise qualifying section.
      const perQuestionSuppressed = total < threshold;

      const distribution = snap.options
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((opt) => {
          const c = perQuestionSuppressed ? 0 : (buckets.get(opt.value) ?? 0);
          return {
            value: opt.value,
            labelAr: opt.labelAr,
            count: c,
            percentage:
              perQuestionSuppressed || total === 0
                ? 0
                : Math.round((c / total) * 10000) / 100,
          };
        });

      // Catch-all for unknown values.
      const knownValues = new Set(snap.options.map((o) => o.value));
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
        snapshotId: snap.id,
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
      questions,
    });
  }
);
