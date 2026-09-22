import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { FAVORABLE_VALUES } from "@/lib/constants";

export const dynamic = "force-dynamic";

interface EnvResponseRow {
  questionSnapshotId: string;
  selectedValue: string;
  selectedScore: number | null;
}

/**
 * GET /api/admin/reports/[campaignId]/environment
 *
 * Aggregated environment report. Auth required (both roles).
 *
 * For each environment question snapshot:
 *   - count              (total responses for this question)
 *   - validCount         (responses where selectedScore !== null)
 *   - averageScore       (sum(selectedScore) / validCount | null)
 *   - distribution       ({ value, labelAr, count }[] — one per snapshot option)
 *   - favorableRate      (FAVORABLE_VALUES count / validCount | null)
 *   - notApplicableCount (selectedValue === 'not_applicable' count)
 *
 * Threshold suppression (spec §13.6): if the total environment responses
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
        enableEnvironmentSurvey: true,
      },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    // Pull all environment snapshots (with options) + all environment
    // responses in two queries. Aggregate in JS to avoid N+1.
    const [snapshots, responses] = await Promise.all([
      db.campaignQuestionSnapshot.findMany({
        where: { campaignId, section: "environment" },
        include: { options: true },
        orderBy: { displayOrder: "asc" },
      }),
      db.response.findMany({
        where: { campaignId, responseType: "environment" },
        select: {
          questionSnapshotId: true,
          selectedValue: true,
          selectedScore: true,
        },
      }),
    ]);

    const threshold = campaign.minimumReportingThreshold;

    // Whole-section suppression.
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
    const bySnapshot = new Map<string, EnvResponseRow[]>();
    for (const r of responses) {
      const arr = bySnapshot.get(r.questionSnapshotId) ?? [];
      arr.push(r);
      bySnapshot.set(r.questionSnapshotId, arr);
    }

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

      // Distribution: one entry per snapshot option (sorted by displayOrder),
      // plus a catch-all "other" bucket for any responses whose value
      // doesn't match an option (defensive — shouldn't happen in practice).
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

      // Catch-all: any response whose value isn't in the snapshot's
      // option set is bucketed individually with its raw value as the
      // labelAr (defensive — shouldn't happen in practice).
      const knownValues = new Set(snap.options.map((o) => o.value));
      for (const [value, count] of optionBuckets) {
        if (!knownValues.has(value)) {
          distribution.push({ value, labelAr: value, count });
        }
      }

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
      questions,
    });
  }
);
