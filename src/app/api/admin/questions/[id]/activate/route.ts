import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/questions/[id]/activate
 * Set isActive=true, clear deletedAt. Audit `question.activate`.
 */
export const POST = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id } = await ctx.params;

    const existing = await db
      .prepare(
        "SELECT id, code, isActive, deletedAt FROM Question WHERE id = ?"
      )
      .bind(id)
      .first();
    if (!existing) return fail("السؤال غير موجود.", 404);

    await db
      .prepare(
        "UPDATE Question SET isActive = 1, deletedAt = NULL, updatedAt = datetime('now') WHERE id = ?"
      )
      .bind(id)
      .run();

    const updated = await db
      .prepare("SELECT * FROM Question WHERE id = ?")
      .bind(id)
      .first();

    await writeAudit({
      adminUserId: admin.adminId,
      action: "question.activate",
      entityType: "question",
      entityId: id,
      metadata: {
        code: existing.code,
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
