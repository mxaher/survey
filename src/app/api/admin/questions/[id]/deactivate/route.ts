import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/questions/[id]/deactivate
 * Set isActive=false. Audit `question.deactivate`.
 */
export const POST = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id } = await ctx.params;

    const existing = await db
      .prepare("SELECT id, code, isActive FROM Question WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return fail("السؤال غير موجود.", 404);

    await db
      .prepare(
        "UPDATE Question SET isActive = 0, updatedAt = datetime('now') WHERE id = ?"
      )
      .bind(id)
      .run();

    const updated = await db
      .prepare("SELECT * FROM Question WHERE id = ?")
      .bind(id)
      .first();

    await writeAudit({
      adminUserId: admin.adminId,
      action: "question.deactivate",
      entityType: "question",
      entityId: id,
      metadata: {
        code: existing.code,
        previousIsActive: existing.isActive,
      },
    });

    return ok({
      id: updated!.id,
      isActive: updated!.isActive,
    });
  }
);
