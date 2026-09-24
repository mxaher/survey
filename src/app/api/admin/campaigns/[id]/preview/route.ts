import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { noStore, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { PRIVACY_NOTICE } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/campaigns/[id]/preview
 * Returns the exact data shape the employee UI will consume.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id } = await ctx.params;

    // 1. Campaign row
    const campaign = await db.prepare(
      `SELECT * FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    // 2. Executives with joined executive data
    const executives = await db.prepare(
      `SELECT ce.campaignId, ce.executiveId, ce.displayOrder, ce.isEnabled,
              e.nameAr, e.titleAr, e.category, e.departmentAr, e.isActive, e.deletedAt
       FROM CampaignExecutive ce
       JOIN Executive e ON e.id = ce.executiveId
       WHERE ce.campaignId = ?
       ORDER BY ce.displayOrder ASC`
    ).bind(id).all();

    // 3. Question configs with joined question
    const questionConfigs = await db.prepare(
      `SELECT cqc.campaignId, cqc.questionId, cqc.scope, cqc.isRequired,
              cqc.displayOrder AS qcDisplayOrder,
              q.id AS qId, q.code AS qCode, q.questionAr AS qQuestionAr,
              q.questionType AS qQuestionType, q.section AS qSection,
              q.dimension AS qDimension, q.isRequired AS qIsRequired,
              q.isActive AS qIsActive, q.deletedAt AS qDeletedAt,
              q.maxSelections AS qMaxSelections
       FROM CampaignQuestionConfig cqc
       JOIN Question q ON q.id = cqc.questionId
       WHERE cqc.campaignId = ?
       ORDER BY cqc.displayOrder ASC`
    ).bind(id).all();

    // 4. Fetch options for all questions
    const qIds = questionConfigs.results.map(
      (qc: Record<string, unknown>) => qc.qId as string
    );
    let allOptions: Record<string, unknown>[] = [];
    if (qIds.length > 0) {
      const ph = qIds.map(() => "?").join(",");
      allOptions = (await db.prepare(
        `SELECT * FROM QuestionOption WHERE questionId IN (${ph})`
      ).bind(...qIds).all()).results as Record<string, unknown>[];
    }

    // 5. Question snapshots + option snapshots (for frozen campaigns)
    const snapshots = await db.prepare(
      `SELECT * FROM CampaignQuestionSnapshot WHERE campaignId = ? ORDER BY displayOrder ASC`
    ).bind(id).all();

    const snapshotIds = snapshots.results.map(
      (s: Record<string, unknown>) => s.id as string
    );
    let allSnapshotOptions: Record<string, unknown>[] = [];
    if (snapshotIds.length > 0) {
      const ph = snapshotIds.map(() => "?").join(",");
      allSnapshotOptions = (await db.prepare(
        `SELECT * FROM CampaignQuestionOptionSnapshot WHERE campaignQuestionSnapshotId IN (${ph})`
      ).bind(...snapshotIds).all()).results as Record<string, unknown>[];
    }

    // 6. Resolve privacy notice
    let privacyNoticeAr = campaign.privacyNoticeAr as string | null;
    if (!privacyNoticeAr || privacyNoticeAr.trim() === "") {
      const setting = await db.prepare(
        `SELECT valueAr FROM SystemSetting WHERE key = 'privacy_notice'`
      ).first() as Record<string, unknown> | null;
      privacyNoticeAr = (setting?.valueAr as string) ?? PRIVACY_NOTICE;
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

    // Active executives only
    const execList = executives.results
      .filter(
        (ce: Record<string, unknown>) =>
          ce.isEnabled && ce.isActive && !ce.deletedAt
      )
      .map((ce: Record<string, unknown>) => ({
        executiveId: ce.executiveId,
        displayOrder: ce.displayOrder,
        nameAr: ce.nameAr,
        titleAr: ce.titleAr,
        category: ce.category,
        departmentAr: ce.departmentAr,
      }));

    const isFrozen =
      campaign.status === "active" ||
      campaign.status === "closed" ||
      campaign.status === "archived";

    if (isFrozen && snapshots.results.length > 0) {
      // Serve frozen snapshots
      const bySection = (section: string) =>
        snapshots.results
          .filter((s: Record<string, unknown>) => s.section === section)
          .map((s: Record<string, unknown>) => ({
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
            options: allSnapshotOptions
              .filter((o) => o.campaignQuestionSnapshotId === s.id)
              .sort((a, b) => (a.displayOrder as number) - (b.displayOrder as number))
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
        executives: execList,
        future: {
          enabled: campaign.enableFutureSurvey,
          questions: bySection("future"),
        },
      });
    }

    // Draft / scheduled: serve live question library + CampaignQuestionConfig
    const activeConfigs = questionConfigs.results
      .filter(
        (qc: Record<string, unknown>) => qc.qIsActive && qc.qDeletedAt === null
      );

    const bySection = (section: string) =>
      activeConfigs
        .filter((qc: Record<string, unknown>) => qc.qSection === section)
        .map((qc: Record<string, unknown>) => ({
          questionId: qc.questionId,
          code: qc.qCode,
          questionAr: qc.qQuestionAr,
          questionType: qc.qQuestionType,
          section: qc.qSection,
          dimension: qc.qDimension,
          isRequired: qc.isRequired,
          scope: qc.scope,
          displayOrder: qc.qcDisplayOrder,
          maxSelections: qc.qMaxSelections,
          options: allOptions
            .filter((o) => o.questionId === qc.qId && o.isActive)
            .sort((a, b) => (a.displayOrder as number) - (b.displayOrder as number))
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
      executives: execList,
      future: {
        enabled: campaign.enableFutureSurvey,
        questions: bySection("future"),
      },
    });
  }
);
