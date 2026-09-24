import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

function isEditable(status: string): boolean {
  return status === "draft" || status === "scheduled";
}

/**
 * PATCH /api/admin/campaigns/[campaignId]/executives/[executiveId]
 * Update isEnabled / displayOrder for a single executive assignment.
 */
const patchSchema = z.object({
  isEnabled: z.coerce.boolean().optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
});

export const PATCH = apiHandler(
  async (
    request: NextRequest,
    ctx: {
      params: Promise<{ id: string; executiveId: string }>;
    }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id: campaignId, executiveId } = await ctx.params;
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

    if (campaign.status === "closed" || campaign.status === "archived") {
      return fail(
        "لا يمكن تعديل حملة مغلقة أو مؤرشفة حفاظاً على سلامة النتائج.",
        400
      );
    }

    if (campaign.status === "active") {
      const attemptedFields = Object.keys(input);
      const unsafe = attemptedFields.filter((k) => k !== "isEnabled");
      if (unsafe.length > 0) {
        return fail(MESSAGES.cannotEditActiveCampaign, 400, {
          blockedFields: unsafe,
        });
      }
    }

    const existing = await db.prepare(
      `SELECT * FROM CampaignExecutive WHERE campaignId = ? AND executiveId = ?`
    ).bind(campaignId, executiveId).first() as Record<string, unknown> | null;
    if (!existing) {
      return fail("الإسناد غير موجود لهذه الحملة.", 404);
    }

    // Build SET clause
    const setParts: string[] = [];
    const bindValues: unknown[] = [];
    for (const k of ["isEnabled", "displayOrder"]) {
      if (input[k] !== undefined) {
        let val = input[k];
        if (typeof val === "boolean") val = val ? 1 : 0;
        setParts.push(`${k} = ?`);
        bindValues.push(val);
      }
    }

    if (setParts.length > 0) {
      setParts.push("updatedAt = datetime('now')");
      bindValues.push(campaignId, executiveId);
      await db.prepare(
        `UPDATE CampaignExecutive SET ${setParts.join(", ")} WHERE campaignId = ? AND executiveId = ?`
      ).bind(...bindValues).run();
    }

    const updated = await db.prepare(
      `SELECT * FROM CampaignExecutive WHERE campaignId = ? AND executiveId = ?`
    ).bind(campaignId, executiveId).first() as Record<string, unknown>;

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_executive.update",
      entityType: "campaign_executive",
      entityId: executiveId,
      campaignId,
      metadata: {
        fields: Object.keys(input),
        status: campaign.status,
        previous: {
          isEnabled: existing.isEnabled,
          displayOrder: existing.displayOrder,
        },
        new: {
          isEnabled: updated.isEnabled,
          displayOrder: updated.displayOrder,
        },
      },
    });

    return ok({
      campaignId: updated.campaignId,
      executiveId: updated.executiveId,
      displayOrder: updated.displayOrder,
      isEnabled: updated.isEnabled,
      updatedAt: updated.updatedAt,
    });
  }
);

/**
 * DELETE /api/admin/campaigns/[campaignId]/executives/[executiveId]
 */
export const DELETE = apiHandler(
  async (
    _request: NextRequest,
    ctx: {
      params: Promise<{ id: string; executiveId: string }>;
    }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id: campaignId, executiveId } = await ctx.params;

    const campaign = await db.prepare(
      `SELECT id, status, titleAr FROM Campaign WHERE id = ?`
    ).bind(campaignId).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    if (campaign.status === "closed" || campaign.status === "archived") {
      return fail(
        "لا يمكن تعديل حملة مغلقة أو مؤرشفة حفاظاً على سلامة النتائج.",
        400
      );
    }

    const existing = await db.prepare(
      `SELECT * FROM CampaignExecutive WHERE campaignId = ? AND executiveId = ?`
    ).bind(campaignId, executiveId).first() as Record<string, unknown> | null;
    if (!existing) {
      return fail("الإسناد غير موجود لهذه الحملة.", 404);
    }

    // For active campaigns: check responses
    if (campaign.status === "active") {
      const respCount = await db.prepare(
        `SELECT COUNT(*) AS cnt FROM Response WHERE campaignId = ? AND executiveId = ?`
      ).bind(campaignId, executiveId).first() as Record<string, unknown>;

      if ((respCount.cnt as number) > 0) {
        await db.prepare(
          `UPDATE CampaignExecutive SET isEnabled = 0, updatedAt = datetime('now') WHERE campaignId = ? AND executiveId = ?`
        ).bind(campaignId, executiveId).run();

        await writeAudit({
          adminUserId: admin.adminId,
          action: "campaign_executive.disable_active",
          entityType: "campaign_executive",
          entityId: executiveId,
          campaignId,
          metadata: {
            previousIsEnabled: existing.isEnabled,
            newIsEnabled: false,
            responsesCount: respCount.cnt,
            reason: "executive_has_responses_in_active_campaign",
          },
        });

        return ok({
          campaignId,
          executiveId,
          removed: false,
          mode: "soft",
          isEnabled: false,
          responsesCount: respCount.cnt,
          message: MESSAGES.removeExecutiveFromActiveWithHistory,
        });
      }
    }

    // Hard delete
    await db.prepare(
      `DELETE FROM CampaignExecutive WHERE campaignId = ? AND executiveId = ?`
    ).bind(campaignId, executiveId).run();

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_executive.remove",
      entityType: "campaign_executive",
      entityId: executiveId,
      campaignId,
      metadata: {
        previous: {
          isEnabled: existing.isEnabled,
          displayOrder: existing.displayOrder,
        },
        campaignStatus: campaign.status,
        mode: "hard",
      },
    });

    return ok({ campaignId, executiveId, removed: true, mode: "hard" });
  }
);
