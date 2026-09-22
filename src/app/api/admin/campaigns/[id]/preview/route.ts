import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { noStore, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { PRIVACY_NOTICE } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/campaigns/[id]/preview
 *
 * Returns the exact data shape the employee UI will consume, for the admin
 * preview screen. Read-only — never writes participation or response rows.
 *
 * Shape:
 *   {
 *     campaign: { ... stripped fields, with privacyNoticeAr resolved },
 *     environment:  { enabled, questions: [...] },
 *     leadership:   { questions: [...] },          // executive-scoped
 *     executives:   [ { executiveId, nameAr, titleAr, ... } ],
 *     future:       { enabled, questions: [...] }
 *   }
 *
 * For active/closed/archived campaigns we serve the FROZEN snapshots
 * (what the employee actually sees). For draft/scheduled we serve the live
 * question library + CampaignQuestionConfig (what the employee would see if
 * activated right now).
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;

    const campaign = await db.campaign.findUnique({
      where: { id },
      include: {
        executives: {
          include: { executive: true },
          orderBy: { displayOrder: "asc" },
        },
        questionConfig: {
          include: { question: { include: { options: true } } },
          orderBy: { displayOrder: "asc" },
        },
        questionSnapshots: {
          include: { options: true },
          orderBy: { displayOrder: "asc" },
        },
      },
    });

    if (!campaign) return fail("الحملة غير موجودة.", 404);

    // Resolve privacy notice: campaign-level override > system setting > bundled constant.
    let privacyNoticeAr = campaign.privacyNoticeAr;
    if (!privacyNoticeAr || privacyNoticeAr.trim() === "") {
      const setting = await db.systemSetting.findUnique({
        where: { key: "privacy_notice" },
      });
      privacyNoticeAr = setting?.valueAr ?? PRIVACY_NOTICE;
    }

    const baseCampaign = {
      id: campaign.id,
      titleAr: campaign.titleAr,
      descriptionAr: campaign.descriptionAr,
      instructionsAr: campaign.instructionsAr,
      privacyNoticeAr,
      status: campaign.status,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      timezone: campaign.timezone,
      minimumReportingThreshold: campaign.minimumReportingThreshold,
      enableEnvironmentSurvey: campaign.enableEnvironmentSurvey,
      enableFutureSurvey: campaign.enableFutureSurvey,
      allowMultipleExecutiveEvaluations:
        campaign.allowMultipleExecutiveEvaluations,
      minExecutives: campaign.minExecutives,
      maxExecutives: campaign.maxExecutives,
      allowResume: campaign.allowResume,
      activatedAt: campaign.activatedAt,
      closedAt: campaign.closedAt,
    };

    // Active executives only (isEnabled on CE + isActive + not soft-deleted).
    const executives = campaign.executives
      .filter(
        (ce) =>
          ce.isEnabled &&
          ce.executive?.isActive &&
          ce.executive?.deletedAt === null
      )
      .map((ce) => ({
        executiveId: ce.executiveId,
        displayOrder: ce.displayOrder,
        nameAr: ce.executive.nameAr,
        titleAr: ce.executive.titleAr,
        category: ce.executive.category,
        departmentAr: ce.executive.departmentAr,
      }));

    const isFrozen =
      campaign.status === "active" ||
      campaign.status === "closed" ||
      campaign.status === "archived";

    if (isFrozen && campaign.questionSnapshots.length > 0) {
      // Serve frozen snapshots.
      const bySection = (section: string) =>
        campaign.questionSnapshots
          .filter((s) => s.section === section)
          .map((s) => ({
            snapshotId: s.id,
            originalQuestionId: s.originalQuestionId,
            questionCode: s.questionCode,
            questionAr: s.questionAr,
            questionType: s.questionType,
            section: s.section,
            dimension: s.dimension,
            isRequired: s.isRequired,
            displayOrder: s.displayOrder,
            maxSelections: s.maxSelections,
            options: s.options
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((o) => ({
                id: o.id,
                value: o.value,
                labelAr: o.labelAr,
                score: o.score,
                displayOrder: o.displayOrder,
              })),
          }));

      return noStore({
        campaign: baseCampaign,
        source: "snapshots",
        environment: {
          enabled: campaign.enableEnvironmentSurvey,
          questions: bySection("environment"),
        },
        leadership: {
          questions: bySection("leadership"),
        },
        executives,
        future: {
          enabled: campaign.enableFutureSurvey,
          questions: bySection("future"),
        },
      });
    }

    // Draft / scheduled: serve live question library + CampaignQuestionConfig.
    const activeConfigs = campaign.questionConfig.filter(
      (qc) => qc.question?.isActive && qc.question?.deletedAt === null
    );

    const bySection = (section: string) =>
      activeConfigs
        .filter((qc) => qc.question.section === section)
        .map((qc) => ({
          questionId: qc.questionId,
          code: qc.question.code,
          questionAr: qc.question.questionAr,
          questionType: qc.question.questionType,
          section: qc.question.section,
          dimension: qc.question.dimension,
          isRequired: qc.isRequired,
          scope: qc.scope,
          displayOrder: qc.displayOrder,
          maxSelections: qc.question.maxSelections,
          options: qc.question.options
            .filter((o) => o.isActive)
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((o) => ({
              id: o.id,
              value: o.value,
              labelAr: o.labelAr,
              score: o.score,
              displayOrder: o.displayOrder,
            })),
        }));

    return noStore({
      campaign: baseCampaign,
      source: "library",
      environment: {
        enabled: campaign.enableEnvironmentSurvey,
        questions: bySection("environment"),
      },
      leadership: {
        questions: bySection("leadership"),
      },
      executives,
      future: {
        enabled: campaign.enableFutureSurvey,
        questions: bySection("future"),
      },
    });
  }
);
