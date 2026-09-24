import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/campaigns/[id]/archive
 * Archives a closed campaign. Set status='archived'.
 */
export const POST = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id } = await ctx.params;

    const campaign = await db.prepare(
      `SELECT id, status, titleAr FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    if (campaign.status !== "closed") {
      return fail(
        "لا يمكن أرشفة حملة ليست في الحالة المغلقة.",
        400
      );
    }

    await db.prepare(
      `UPDATE Campaign SET status = 'archived', updatedAt = datetime('now') WHERE id = ?`
    ).bind(id).run();

    const updated = await db.prepare(
      `SELECT id, status FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown>;

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign.archive",
      entityType: "campaign",
      entityId: id,
      campaignId: id,
      metadata: {
        previousStatus: campaign.status,
        newStatus: updated.status,
      },
    });

    return ok({
      id: updated.id,
      status: updated.status,
    });
  }
);
