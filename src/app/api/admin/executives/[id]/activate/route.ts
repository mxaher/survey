import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/executives/[id]/activate
 * Set isActive=true. Audit `executive.activate`.
 */
export const POST = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id } = await ctx.params;

    const existing = await db
      .prepare("SELECT id, nameAr, isActive, deletedAt FROM Executive WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return fail("المسؤول غير موجود.", 404);

    await db
      .prepare("UPDATE Executive SET isActive = 1, deletedAt = NULL WHERE id = ?")
      .bind(id)
      .run();

    const updated = await db
      .prepare("SELECT id, isActive, deletedAt FROM Executive WHERE id = ?")
      .bind(id)
      .first();

    await writeAudit({
      adminUserId: admin.adminId,
      action: "executive.activate",
      entityType: "executive",
      entityId: id,
      metadata: {
        nameAr: existing.nameAr,
        previousIsActive: existing.isActive,
        previousDeletedAt: existing.deletedAt,
      },
    });

    return ok({
      id: updated!.id,
      isActive: updated!.isActive,
      deletedAt: updated!.deletedAt,
    });
  }
);
