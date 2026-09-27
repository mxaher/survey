import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { hashPassword } from "@/lib/auth";
import { destroySessionsFor } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const admin = await getAdminUser();
  if (!admin) return { admin: null, deny: fail(MESSAGES.unauthorized, 401) };
  if (admin.role !== "SUPER_ADMIN") {
    return {
      admin: null,
      deny: fail("لا تملك صلاحية تنفيذ هذه العملية", 403),
    };
  }
  return { admin, deny: null };
}

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  department: z.string().trim().max(120).optional().nullable(),
  isActive: z.coerce.boolean().optional(),
  banned: z.coerce.boolean().optional(),
  password: z
    .string()
    .min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل.")
    .optional(),
});

/**
 * PATCH /api/admin/employees/[id]
 * Update an employee account / reset its password (SUPER_ADMIN only).
 * Password resets, deactivations and bans revoke live sessions.
 */
export const PATCH = apiHandler(
  async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { admin, deny } = await requireSuperAdmin();
    if (deny || !admin) return deny;

    const db = getDB();
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    if (!json || typeof json !== "object") {
      return fail("صيغة الطلب غير صالحة.", 400);
    }

    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues?.[0]?.message ?? "صيغة الطلب غير صالحة.", 422);
    }
    const input = parsed.data;

    const existing = await db
      .prepare("SELECT * FROM EmployeeUser WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return fail("الموظف غير موجود.", 404);

    let newHash: string | null = null;
    let newSalt: string | null = null;
    if (input.password !== undefined) {
      const hashed = await hashPassword(input.password);
      newHash = hashed.hash;
      newSalt = hashed.salt;
      delete input.password;
    }

    const updates: string[] = [];
    const bindValues: unknown[] = [];
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) {
        updates.push(`${k} = ?`);
        bindValues.push(v);
      }
    }
    if (newHash) {
      updates.push("passwordHash = ?", "salt = ?");
      bindValues.push(newHash, newSalt);
    }
    if (updates.length === 0) return fail("صيغة الطلب غير صالحة.", 400);

    updates.push("updatedAt = datetime('now')");
    bindValues.push(id);

    await db
      .prepare(`UPDATE EmployeeUser SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...bindValues)
      .run();

    const updated = await db
      .prepare("SELECT * FROM EmployeeUser WHERE id = ?")
      .bind(id)
      .first();

    if (newHash || !updated?.isActive || updated?.banned) {
      await destroySessionsFor("employee", id);
    }

    await writeAudit({
      adminUserId: admin.adminId,
      action: "employee.update",
      entityType: "employee_user",
      entityId: id,
      metadata: {
        fields: Object.keys(input),
        passwordChanged: Boolean(newHash),
        previousIsActive: existing.isActive,
        newIsActive: updated?.isActive,
        previousBanned: existing.banned,
        newBanned: updated?.banned,
      },
    });

    return ok({
      id,
      email: updated?.email,
      displayName: updated?.displayName,
      department: updated?.department,
      isActive: updated?.isActive,
      banned: updated?.banned,
      updatedAt: updated?.updatedAt,
    });
  }
);

/**
 * DELETE /api/admin/employees/[id]
 * Deactivate an employee account (never hard-deletes — the participation
 * ledger and audit trail must stay intact).
 */
export const DELETE = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { admin, deny } = await requireSuperAdmin();
    if (deny || !admin) return deny;

    const db = getDB();
    const { id } = await ctx.params;
    const existing = await db
      .prepare("SELECT * FROM EmployeeUser WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return fail("الموظف غير موجود.", 404);

    if (!existing.isActive) {
      return ok({ id, email: existing.email, isActive: 0, deactivated: false });
    }

    await db
      .prepare(
        "UPDATE EmployeeUser SET isActive = 0, updatedAt = datetime('now') WHERE id = ?"
      )
      .bind(id)
      .run();

    await destroySessionsFor("employee", id);

    await writeAudit({
      adminUserId: admin.adminId,
      action: "employee.deactivate",
      entityType: "employee_user",
      entityId: id,
      metadata: { email: existing.email, previousIsActive: existing.isActive },
    });

    return ok({ id, email: existing.email, isActive: 0, deactivated: true });
  }
);
