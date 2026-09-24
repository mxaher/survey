import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
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
 * Update scope, isRequired, displayOrder for a single assignment.
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

    const db = getDB();
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

    const campaign = await db.prepare(
      `SELECT id, status, titleAr FROM Campaign WHERE id = ?`
    ).bind(campaignId).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);
    if (!isEditable(campaign.status as string)) {
      return fail(MESSAGES.cannotEditActiveCampaign, 400, {
        status: campaign.status,
      });
    }

    const existing = await db.prepare(
      `SELECT * FROM CampaignQuestionConfig WHERE campaignId = ? AND questionId = ?`
    ).bind(campaignId, questionId).first() as Record<string, unknown> | null;
    if (!existing) {
      return fail("الإسناد غير موجود لهذه الحملة.", 404);
    }

    // Build SET clause
    const setParts: string[] = [];
    const bindValues: unknown[] = [];
    for (const k of ["scope", "isRequired", "displayOrder"]) {
      if (input[k] !== undefined) {
        let val = input[k];
        if (typeof val === "boolean") val = val ? 1 : 0;
        setParts.push(`${k} = ?`);
        bindValues.push(val);
      }
    }

    if (setParts.length > 0) {
      setParts.push("updatedAt = datetime('now')");
      bindValues.push(campaignId, questionId);
      await db.prepare(
        `UPDATE CampaignQuestionConfig SET ${setParts.join(", ")} WHERE campaignId = ? AND questionId = ?`
      ).bind(...bindValues).run();
    }

    const updated = await db.prepare(
      `SELECT * FROM CampaignQuestionConfig WHERE campaignId = ? AND questionId = ?`
    ).bind(campaignId, questionId).first() as Record<string, unknown>;

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_question.update",
      entityType: "campaign_question",
      entityId: questionId,
      campaignId,
      metadata: {
        fields: Object.keys(input),
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
 * Removes a question assignment from a DRAFT or SCHEDULED campaign.
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

    const db = getDB();
    const { id: campaignId, questionId } = await ctx.params;

    const campaign = await db.prepare(
      `SELECT id, status, titleAr FROM Campaign WHERE id = ?`
    ).bind(campaignId).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);
    if (!isEditable(campaign.status as string)) {
      return fail(MESSAGES.cannotEditActiveCampaign, 400, {
        status: campaign.status,
      });
    }

    const existing = await db.prepare(
      `SELECT * FROM CampaignQuestionConfig WHERE campaignId = ? AND questionId = ?`
    ).bind(campaignId, questionId).first() as Record<string, unknown> | null;
    if (!existing) {
      return fail("الإسناد غير موجود لهذه الحملة.", 404);
    }

    await db.prepare(
      `DELETE FROM CampaignQuestionConfig WHERE campaignId = ? AND questionId = ?`
    ).bind(campaignId, questionId).run();

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
