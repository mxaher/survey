import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/campaigns/[id]/close
 * Closes an active campaign. Set status='closed', closedAt=now.
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

    if (campaign.status !== "active") {
      return fail(
        "لا يمكن إغلاق حملة ليست في الحالة النشطة.",
        400
      );
    }

    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE Campaign SET status = 'closed', closedAt = ?, updatedAt = datetime('now') WHERE id = ?`
    ).bind(now, id).run();

    const updated = await db.prepare(
      `SELECT id, status, closedAt FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown>;

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign.close",
      entityType: "campaign",
      entityId: id,
      campaignId: id,
      metadata: {
        previousStatus: campaign.status,
        newStatus: updated.status,
        closedAt: updated.closedAt,
      },
    });

    return ok({
      id: updated.id,
      status: updated.status,
      closedAt: updated.closedAt,
    });
  }
);
