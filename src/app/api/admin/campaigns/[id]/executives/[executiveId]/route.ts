import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
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
 *
 * Update `isEnabled` / `displayOrder` for a single executive assignment.
 *
 * For draft/scheduled campaigns: full update allowed.
 * For active campaigns: allowed ONLY for `isEnabled` (toggle visibility
 *   for participants) — `displayOrder` changes are refused as structural
 *   because they would alter the participant's view mid-flight.
 * For closed/archived: refused entirely.
 *
 * Re-validates campaign status from the DB before mutating.
 * Audits `campaign_executive.update`.
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

    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, titleAr: true },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    if (campaign.status === "closed" || campaign.status === "archived") {
      return fail(
        "لا يمكن تعديل حملة مغلقة أو مؤرشفة حفاظاً على سلامة النتائج.",
        400
      );
    }

    if (campaign.status === "active") {
      // Only `isEnabled` may be changed on an active campaign.
      const attemptedFields = Object.keys(input);
      const unsafe = attemptedFields.filter((k) => k !== "isEnabled");
      if (unsafe.length > 0) {
        return fail(MESSAGES.cannotEditActiveCampaign, 400, {
          blockedFields: unsafe,
        });
      }
    }
    // status=draft|scheduled → all editable

    const existing = await db.campaignExecutive.findUnique({
      where: { campaignId_executiveId: { campaignId, executiveId } },
    });
    if (!existing) {
      return fail("الإسناد غير موجود لهذه الحملة.", 404);
    }

    const data: Record<string, unknown> = {};
    for (const k of ["isEnabled", "displayOrder"]) {
      if (input[k] !== undefined) data[k] = input[k];
    }

    const updated =
      Object.keys(data).length > 0
        ? await db.campaignExecutive.update({
            where: { campaignId_executiveId: { campaignId, executiveId } },
            data: data as Parameters<typeof db.campaignExecutive.update>[0]["data"],
          })
        : existing;

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_executive.update",
      entityType: "campaign_executive",
      entityId: executiveId,
      campaignId,
      metadata: {
        fields: Object.keys(data),
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
 *
 * - For DRAFT / SCHEDULED campaigns: hard-delete the assignment row.
 * - For ACTIVE campaigns: if the executive has any Response rows for this
 *   campaign, refuse to hard-delete and instead set `isEnabled=false`
 *   (preserving history); return MESSAGES.removeExecutiveFromActiveWithHistory.
 *   If no responses exist for this exec in this campaign, hard-delete the
 *   assignment (no history to preserve).
 * - For CLOSED / ARCHIVED: refused entirely.
 *
 * Audits `campaign_executive.remove` (or `campaign_executive.disable_active`
 * for the soft-disable path) for traceability.
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

    const { id: campaignId, executiveId } = await ctx.params;

    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, titleAr: true },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    if (campaign.status === "closed" || campaign.status === "archived") {
      return fail(
        "لا يمكن تعديل حملة مغلقة أو مؤرشفة حفاظاً على سلامة النتائج.",
        400
      );
    }

    const existing = await db.campaignExecutive.findUnique({
      where: { campaignId_executiveId: { campaignId, executiveId } },
    });
    if (!existing) {
      return fail("الإسناد غير موجود لهذه الحملة.", 404);
    }

    // For active campaigns: check if the executive has responses for this
    // campaign. If so, soft-disable instead of hard-deleting.
    if (campaign.status === "active") {
      const responsesCount = await db.response.count({
        where: { campaignId, executiveId },
      });

      if (responsesCount > 0) {
        const updated = await db.campaignExecutive.update({
          where: { campaignId_executiveId: { campaignId, executiveId } },
          data: { isEnabled: false },
        });

        await writeAudit({
          adminUserId: admin.adminId,
          action: "campaign_executive.disable_active",
          entityType: "campaign_executive",
          entityId: executiveId,
          campaignId,
          metadata: {
            previousIsEnabled: existing.isEnabled,
            newIsEnabled: false,
            responsesCount,
            reason: "executive_has_responses_in_active_campaign",
          },
        });

        // The Arabic message instructs the admin what happened. We return
        // ok:true with the message because the soft-disable actually
        // succeeded; the UI surfaces the message as a friendly notice.
        return ok({
          campaignId,
          executiveId,
          removed: false,
          mode: "soft",
          isEnabled: updated.isEnabled,
          responsesCount,
          message: MESSAGES.removeExecutiveFromActiveWithHistory,
        });
      }
    }

    // Draft/scheduled campaigns OR active campaign with no responses:
    // hard-delete the assignment row. (Responses, if any, still reference
    // `executiveId` directly — but we just confirmed there are none in the
    // active-with-responses case.)
    await db.campaignExecutive.delete({
      where: { campaignId_executiveId: { campaignId, executiveId } },
    });

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
