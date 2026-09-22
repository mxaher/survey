import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/campaigns/[id]/schedule
 * Schedules a draft campaign for future activation. Requires startsAt in
 * the future. Set status='scheduled'. Audit `campaign.schedule`.
 */
export const POST = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;
    const campaign = await db.campaign.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        titleAr: true,
        startsAt: true,
        endsAt: true,
      },
    });
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
    if (campaign.startsAt.getTime() <= now.getTime()) {
      return fail(
        "يجب أن يكون تاريخ بدء الحملة في المستقبل لجدولتها.",
        400
      );
    }

    const updated = await db.campaign.update({
      where: { id },
      data: { status: "scheduled" },
    });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign.schedule",
      entityType: "campaign",
      entityId: id,
      campaignId: id,
      metadata: {
        previousStatus: campaign.status,
        newStatus: updated.status,
        startsAt: campaign.startsAt.toISOString(),
        endsAt: campaign.endsAt?.toISOString() ?? null,
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
