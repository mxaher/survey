import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";
import { QUESTION_SCOPES } from "@/lib/constants";

export const dynamic = "force-dynamic";

const QUESTION_SCOPE_KEYS = QUESTION_SCOPES.map((s) => s.key);

function isEditable(status: string): boolean {
  return status === "draft" || status === "scheduled";
}

/**
 * PATCH /api/admin/campaigns/[campaignId]/questions/[questionId]
 *
 * Update `scope`, `isRequired`, `displayOrder` for a single assignment in
 * a DRAFT or SCHEDULED campaign only. Re-validates campaign status from the
 * DB before mutating. Audits `campaign_question.update`.
 */
const patchSchema = z.object({
  scope: z
    .string()
    .refine((v) => QUESTION_SCOPE_KEYS.includes(v as never), {
      message: "نطاق السؤال غير معروف.",
    })
    .optional(),
  isRequired: z.coerce.boolean().optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
});

export const PATCH = apiHandler(
  async (
    request: NextRequest,
    ctx: {
      params: Promise<{ id: string; questionId: string }>;
    }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id: campaignId, questionId } = await ctx.params;
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

    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, titleAr: true },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);
    if (!isEditable(campaign.status)) {
      return fail(MESSAGES.cannotEditActiveCampaign, 400, {
        status: campaign.status,
      });
    }

    const existing = await db.campaignQuestionConfig.findUnique({
      where: { campaignId_questionId: { campaignId, questionId } },
    });
    if (!existing) {
      return fail("الإسناد غير موجود لهذه الحملة.", 404);
    }

    const data: Record<string, unknown> = {};
    for (const k of ["scope", "isRequired", "displayOrder"]) {
      if (input[k] !== undefined) data[k] = input[k];
    }

    const updated =
      Object.keys(data).length > 0
        ? await db.campaignQuestionConfig.update({
            where: { campaignId_questionId: { campaignId, questionId } },
            data: data as Parameters<typeof db.campaignQuestionConfig.update>[0]["data"],
          })
        : existing;

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_question.update",
      entityType: "campaign_question",
      entityId: questionId,
      campaignId,
      metadata: {
        fields: Object.keys(data),
        previous: {
          scope: existing.scope,
          isRequired: existing.isRequired,
          displayOrder: existing.displayOrder,
        },
        new: {
          scope: updated.scope,
          isRequired: updated.isRequired,
          displayOrder: updated.displayOrder,
        },
      },
    });

    return ok({
      campaignId: updated.campaignId,
      questionId: updated.questionId,
      scope: updated.scope,
      isRequired: updated.isRequired,
      displayOrder: updated.displayOrder,
      updatedAt: updated.updatedAt,
    });
  }
);

/**
 * DELETE /api/admin/campaigns/[campaignId]/questions/[questionId]
 * Removes a question assignment from a DRAFT or SCHEDULED campaign only.
 * Re-validates campaign status from the DB. Audits `campaign_question.remove`.
 */
export const DELETE = apiHandler(
  async (
    _request: NextRequest,
    ctx: {
      params: Promise<{ id: string; questionId: string }>;
    }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id: campaignId, questionId } = await ctx.params;

    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, titleAr: true },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);
    if (!isEditable(campaign.status)) {
      return fail(MESSAGES.cannotEditActiveCampaign, 400, {
        status: campaign.status,
      });
    }

    const existing = await db.campaignQuestionConfig.findUnique({
      where: { campaignId_questionId: { campaignId, questionId } },
    });
    if (!existing) {
      return fail("الإسناد غير موجود لهذه الحملة.", 404);
    }

    await db.campaignQuestionConfig.delete({
      where: { campaignId_questionId: { campaignId, questionId } },
    });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_question.remove",
      entityType: "campaign_question",
      entityId: questionId,
      campaignId,
      metadata: {
        previous: {
          scope: existing.scope,
          isRequired: existing.isRequired,
          displayOrder: existing.displayOrder,
        },
        campaignStatus: campaign.status,
      },
    });

    return ok({ campaignId, questionId, removed: true });
  }
);
