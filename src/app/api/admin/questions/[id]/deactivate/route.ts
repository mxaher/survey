import { NextRequest } from "next/server";
import { db } from "@/lib/db";
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

    const { id } = await ctx.params;
    const existing = await db.question.findUnique({
      where: { id },
      select: { id: true, code: true, isActive: true },
    });
    if (!existing) return fail("السؤال غير موجود.", 404);

    const updated = await db.question.update({
      where: { id },
      data: { isActive: false },
    });

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
      id: updated.id,
      isActive: updated.isActive,
    });
  }
);
