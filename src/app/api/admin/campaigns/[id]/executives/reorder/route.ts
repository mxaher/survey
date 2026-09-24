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
 * POST /api/admin/campaigns/[campaignId]/executives/reorder
 * Body: { order: [{ executiveId, displayOrder }] }
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

    const db = getDB();
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

    const campaign = await db.prepare(
      `SELECT id, status, titleAr FROM Campaign WHERE id = ?`
    ).bind(campaignId).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);
    if (!isEditable(campaign.status as string)) {
      return fail(MESSAGES.cannotEditActiveCampaign, 400, {
        status: campaign.status,
      });
    }

    // Verify all referenced assignments exist
    const ids = input.order.map((o) => o.executiveId);
    const placeholders = ids.map(() => "?").join(",");
    const existing = await db.prepare(
      `SELECT executiveId FROM CampaignExecutive WHERE campaignId = ? AND executiveId IN (${placeholders})`
    ).bind(campaignId, ...ids).all();
    const existingIds = new Set(existing.results.map((e: Record<string, unknown>) => e.executiveId));
    const missing = ids.filter((eid) => !existingIds.has(eid));
    if (missing.length > 0) {
      return fail("بعض المسؤولين المحددين غير مُسندين لهذه الحملة.", 400, {
        missingIds: missing,
      });
    }

    // Build batch updates
    const statements: ReturnType<typeof db.prepare>[] = [];
    for (const item of input.order) {
      statements.push(
        db.prepare(
          `UPDATE CampaignExecutive SET displayOrder = ?, updatedAt = datetime('now') WHERE campaignId = ? AND executiveId = ?`
        ).bind(item.displayOrder, campaignId, item.executiveId)
      );
    }
    await db.batch(statements);

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
