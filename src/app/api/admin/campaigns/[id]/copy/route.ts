import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

const COPY_SUFFIX = " (نسخة)";

/**
 * POST /api/admin/campaigns/[id]/copy
 *
 * Create a new DRAFT campaign copying:
 *   - titleAr (with " (نسخة)" suffix)
 *   - descriptionAr, instructionsAr
 *   - all toggles + privacy notice
 *   - min/max executives, allowResume, threshold
 * NOT copied:
 *   - status (forced to 'draft')
 *   - startsAt/endsAt (cleared — admin re-schedules)
 *   - activatedAt/closedAt (null)
 *   - questionSnapshots (only generated at activation)
 *
 * Also copies CampaignExecutive + CampaignQuestionConfig assignments.
 * Wrapped in `db.$transaction` so a partial copy doesn't leave orphans.
 */
export const POST = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;
    const source = await db.campaign.findUnique({
      where: { id },
      include: {
        executives: true,
        questionConfig: true,
      },
    });
    if (!source) return fail("الحملة غير موجودة.", 404);

    const newTitle = `${source.titleAr}${COPY_SUFFIX}`;

    const result = await db.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          titleAr: newTitle,
          descriptionAr: source.descriptionAr,
          instructionsAr: source.instructionsAr,
          status: "draft",
          startsAt: null,
          endsAt: null,
          timezone: source.timezone,
          minimumReportingThreshold: source.minimumReportingThreshold,
          enableEnvironmentSurvey: source.enableEnvironmentSurvey,
          enableFutureSurvey: source.enableFutureSurvey,
          allowMultipleExecutiveEvaluations:
            source.allowMultipleExecutiveEvaluations,
          minExecutives: source.minExecutives,
          maxExecutives: source.maxExecutives,
          allowResume: source.allowResume,
          privacyNoticeAr: source.privacyNoticeAr,
          activatedAt: null,
          closedAt: null,
          createdBy: admin.adminId,
        },
      });

      // Copy executive assignments.
      for (const ce of source.executives) {
        await tx.campaignExecutive.create({
          data: {
            campaignId: created.id,
            executiveId: ce.executiveId,
            displayOrder: ce.displayOrder,
            isEnabled: ce.isEnabled,
          },
        });
      }

      // Copy question configs.
      for (const qc of source.questionConfig) {
        await tx.campaignQuestionConfig.create({
          data: {
            campaignId: created.id,
            questionId: qc.questionId,
            scope: qc.scope,
            isRequired: qc.isRequired,
            displayOrder: qc.displayOrder,
          },
        });
      }

      return {
        id: created.id,
        titleAr: created.titleAr,
        status: created.status,
        createdAt: created.createdAt,
        copiedExecutives: source.executives.length,
        copiedQuestions: source.questionConfig.length,
      };
    });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign.copy",
      entityType: "campaign",
      entityId: result.id,
      campaignId: result.id,
      metadata: {
        sourceCampaignId: id,
        newTitle: result.titleAr,
        copiedExecutives: result.copiedExecutives,
        copiedQuestions: result.copiedQuestions,
      },
    });

    return ok(result, { status: 201 });
  }
);
