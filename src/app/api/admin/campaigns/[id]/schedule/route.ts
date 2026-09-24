import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/campaigns/[id]/schedule
 * Schedules a draft campaign for future activation.
 */
export const POST = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id } = await ctx.params;

    const campaign = await db.prepare(
      `SELECT id, status, titleAr, startsAt, endsAt FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    if (campaign.status !== "draft") {
      return fail(
        "لا يمكن جدولة حملة ليست في حالة المسودة.",
        400
      );
    }

    if (!campaign.startsAt) {
      return fail(
        "يجب تحديد تاريخ بدء الحملة قبل جدولتها.",
        400
      );
    }

    const now = new Date();
    const startsAtDate = new Date(campaign.startsAt as string);
    if (startsAtDate.getTime() <= now.getTime()) {
      return fail(
        "يجب أن يكون تاريخ بدء الحملة في المستقبل لجدولتها.",
        400
      );
    }

    await db.prepare(
      `UPDATE Campaign SET status = 'scheduled', updatedAt = datetime('now') WHERE id = ?`
    ).bind(id).run();

    const updated = await db.prepare(
      `SELECT id, status, startsAt, endsAt FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown>;

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign.schedule",
      entityType: "campaign",
      entityId: id,
      campaignId: id,
      metadata: {
        previousStatus: campaign.status,
        newStatus: updated.status,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt ?? null,
      },
    });

    return ok({
      id: updated.id,
      status: updated.status,
      startsAt: updated.startsAt,
      endsAt: updated.endsAt,
    });
  }
);
