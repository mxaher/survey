import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/campaigns/[id]
 * Full campaign detail: campaign fields + counts + (limited) assignment info.
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
        _count: {
          select: {
            responses: true,
            participationLedger: true,
            questionSnapshots: true,
          },
        },
      },
    });

    if (!campaign) return fail("الحملة غير موجودة.", 404);

    return ok({
      id: campaign.id,
      titleAr: campaign.titleAr,
      descriptionAr: campaign.descriptionAr,
      instructionsAr: campaign.instructionsAr,
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
      privacyNoticeAr: campaign.privacyNoticeAr,
      activatedAt: campaign.activatedAt,
      closedAt: campaign.closedAt,
      createdBy: campaign.createdBy,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      executives: campaign.executives.map((ce) => ({
        executiveId: ce.executiveId,
        displayOrder: ce.displayOrder,
        isEnabled: ce.isEnabled,
        executive: ce.executive
          ? {
              id: ce.executive.id,
              nameAr: ce.executive.nameAr,
              titleAr: ce.executive.titleAr,
              category: ce.executive.category,
              departmentAr: ce.executive.departmentAr,
              isActive: ce.executive.isActive,
            }
          : null,
      })),
      questions: campaign.questionConfig.map((qc) => ({
        questionId: qc.questionId,
        scope: qc.scope,
        isRequired: qc.isRequired,
        displayOrder: qc.displayOrder,
        question: qc.question
          ? {
              id: qc.question.id,
              code: qc.question.code,
              questionAr: qc.question.questionAr,
              questionType: qc.question.questionType,
              section: qc.question.section,
              dimension: qc.question.dimension,
              isRequired: qc.question.isRequired,
              isActive: qc.question.isActive,
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
            }
          : null,
      })),
      counts: {
        responses: campaign._count.responses,
        participationLedger: campaign._count.participationLedger,
        questionSnapshots: campaign._count.questionSnapshots,
        executives: campaign.executives.length,
        questions: campaign.questionConfig.length,
      },
    });
  }
);

/**
 * PATCH /api/admin/campaigns/[id]
 * Update fields. Unsafe edits are rejected when status='active' (spec §7):
 *   - When status='active', only descriptionAr / endsAt (extension only) /
 *     minimumReportingThreshold are allowed.
 *   - When status='closed' or 'archived', PATCH is rejected entirely.
 *   - When status='draft' or 'scheduled', all fields are editable.
 */
const patchSchema = z
  .object({
    titleAr: z.string().trim().min(1).optional(),
    descriptionAr: z.string().trim().optional().nullable(),
    instructionsAr: z.string().trim().optional().nullable(),
    startsAt: z.coerce.date().optional().nullable(),
    endsAt: z.coerce.date().optional().nullable(),
    timezone: z.string().trim().optional(),
    minimumReportingThreshold: z.coerce.number().int().min(1).optional(),
    enableEnvironmentSurvey: z.coerce.boolean().optional(),
    enableFutureSurvey: z.coerce.boolean().optional(),
    allowMultipleExecutiveEvaluations: z.coerce.boolean().optional(),
    minExecutives: z.coerce.number().int().min(1).optional().nullable(),
    maxExecutives: z.coerce.number().int().min(1).optional().nullable(),
    allowResume: z.coerce.boolean().optional(),
    privacyNoticeAr: z.string().trim().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.startsAt && data.endsAt) {
        return data.endsAt > data.startsAt;
      }
      return true;
    },
    {
      message: "يجب أن يكون تاريخ انتهاء الحملة بعد تاريخ بدئها.",
      path: ["endsAt"],
    }
  )
  .refine(
    (data) => {
      if (
        data.minExecutives !== null &&
        data.minExecutives !== undefined &&
        data.maxExecutives !== null &&
        data.maxExecutives !== undefined
      ) {
        return data.minExecutives <= data.maxExecutives;
      }
      return true;
    },
    {
      message: "الحد الأدنى لعدد المسؤولين أكبر من الحد الأقصى.",
      path: ["maxExecutives"],
    }
  );

/** Whitelist of fields allowed to be changed when status='active'. */
const SAFE_ACTIVE_FIELDS = new Set([
  "descriptionAr",
  "endsAt",
  "minimumReportingThreshold",
]);

/** Returns the list of fields the patch is trying to change. */
function changedFields(input: Record<string, unknown>): string[] {
  return Object.keys(input);
}

export const PATCH = apiHandler(
  async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    if (!json || typeof json !== "object") {
      return fail("صيغة الطلب غير صالحة.", 400);
    }

    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return fail(
        parsed.error.issues?.[0]?.message ?? MESSAGES.configIncomplete,
        422
      );
    }
    const input = parsed.data as Record<string, unknown>;

    const campaign = await db.campaign.findUnique({ where: { id } });
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    // Lock down closed / archived campaigns entirely.
    if (campaign.status === "closed" || campaign.status === "archived") {
      return fail(
        "لا يمكن تعديل حملة مغلقة أو مؤرشفة حفاظاً على سلامة النتائج.",
        400
      );
    }

    // For active campaigns, only allow safe edits.
    if (campaign.status === "active") {
      const changed = changedFields(input);
      const unsafe = changed.filter((k) => !SAFE_ACTIVE_FIELDS.has(k));
      if (unsafe.length > 0) {
        return fail(MESSAGES.cannotEditActiveCampaign, 400, {
          blockedFields: unsafe,
        });
      }
      // endsAt extension: new endsAt must be >= old endsAt (if both set).
      if (
        input.endsAt !== undefined &&
        campaign.endsAt &&
        input.endsAt &&
        new Date(input.endsAt as Date).getTime() <
          campaign.endsAt.getTime()
      ) {
        return fail(
          "لا يمكن تقصير تاريخ انتهاء حملة نشطة، فقط تمديده.",
          400
        );
      }
    }

    // Build the update payload, skipping undefined fields.
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) data[k] = v;
    }

    const updated = await db.campaign.update({
      where: { id },
      data: data as Parameters<typeof db.campaign.update>[0]["data"],
    });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign.update",
      entityType: "campaign",
      entityId: updated.id,
      campaignId: updated.id,
      metadata: {
        fields: Object.keys(data),
        status: campaign.status,
      },
    });

    return ok({
      id: updated.id,
      titleAr: updated.titleAr,
      status: updated.status,
      updatedAt: updated.updatedAt,
    });
  }
);

/**
 * DELETE /api/admin/campaigns/[id]
 * Only allowed when status='draft' AND no participation ledger rows AND
 * no responses. Otherwise return 400 with Arabic message.
 */
export const DELETE = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;
    const campaign = await db.campaign.findUnique({
      where: { id },
      include: {
        _count: {
          select: { responses: true, participationLedger: true },
        },
      },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    if (campaign.status !== "draft") {
      return fail(
        "لا يمكن حذف حملة بدأت المشاركة فيها. يمكنك أرشفتها بدلاً من ذلك.",
        400
      );
    }
    if (campaign._count.responses > 0 || campaign._count.participationLedger > 0) {
      return fail(
        "لا يمكن حذف حملة لديها مشاركات مسجلة. يمكنك أرشفتها بدلاً من ذلك.",
        400
      );
    }

    // Cascade deletes will clean up executives, questionConfig, snapshots.
    await db.campaign.delete({ where: { id } });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign.delete",
      entityType: "campaign",
      entityId: id,
      campaignId: id,
      metadata: {
        titleAr: campaign.titleAr,
        previousStatus: campaign.status,
      },
    });

    return ok({ id, deleted: true });
  }
);
