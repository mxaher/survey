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
 * POST /api/admin/campaigns/[campaignId]/executives/reorder
 *
 * Body: { order: [{ executiveId, displayOrder }] }
 *
 * Rejects for non-draft/scheduled campaigns. Updates each row's
 * displayOrder in a single transaction. Audits `campaign_executive.reorder`.
 */
const reorderSchema = z.object({
  order: z
    .array(
      z.object({
        executiveId: z.string().min(1, "معرّف المسؤول مطلوب."),
        displayOrder: z.coerce.number().int().min(0),
      })
    )
    .min(1, "يجب تحديد ترتيب مسؤول واحد على الأقل."),
});

export const POST = apiHandler(
  async (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id: campaignId } = await ctx.params;
    const json = await request.json().catch(() => null);
    if (!json) return fail("صيغة الطلب غير صالحة.", 400);

    const parsed = reorderSchema.safeParse(json);
    if (!parsed.success) {
      return fail(
        parsed.error.issues?.[0]?.message ?? MESSAGES.configIncomplete,
        422
      );
    }
    const input = parsed.data;

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

    // Verify all referenced assignments exist for this campaign.
    const ids = input.order.map((o) => o.executiveId);
    const existing = await db.campaignExecutive.findMany({
      where: { campaignId, executiveId: { in: ids } },
      select: { executiveId: true },
    });
    const existingIds = new Set(existing.map((e) => e.executiveId));
    const missing = ids.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      return fail("بعض المسؤولين المحددين غير مُسندين لهذه الحملة.", 400, {
        missingIds: missing,
      });
    }

    await db.$transaction(async (tx) => {
      const c = await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });
      if (!c) throw new Error("campaign_not_found");
      if (!isEditable(c.status)) throw new Error("invalid_status");

      for (const item of input.order) {
        await tx.campaignExecutive.update({
          where: {
            campaignId_executiveId: {
              campaignId,
              executiveId: item.executiveId,
            },
          },
          data: { displayOrder: item.displayOrder },
        });
      }
    });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_executive.reorder",
      entityType: "campaign_executive",
      campaignId,
      metadata: {
        count: input.order.length,
        order: input.order,
      },
    });

    return ok({ campaignId, reordered: input.order.length });
  }
);
