import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/** SUPER_ADMIN-only guard. */
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

/**
 * GET /api/admin/users/[id]
 * Returns one admin user (SUPER_ADMIN only).
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { admin, deny } = await requireSuperAdmin();
    if (deny || !admin) return deny;

    const db = getDB();
    const { id } = await ctx.params;
    const user = await db
      .prepare("SELECT * FROM AdminUser WHERE id = ?")
      .bind(id)
      .first();
    if (!user) return fail("المستخدم غير موجود.", 404);

    return ok({
      id: user.id,
      externalId: user.externalId,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }
);

const patchSchema = z.object({
  displayName: z.string().trim().optional().nullable(),
  email: z
    .string()
    .trim()
    .email("البريد الإلكتروني غير صالح.")
    .optional()
    .nullable(),
  role: z.enum(["SUPER_ADMIN", "SURVEY_ADMIN"]).optional(),
  isActive: z.coerce.boolean().optional(),
});

/**
 * PATCH /api/admin/users/[id]
 * Update role / displayName / email / isActive (SUPER_ADMIN only).
 * Audits `admin_user.update`.
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
      .prepare("SELECT * FROM AdminUser WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return fail("المستخدم غير موجود.", 404);

    // Build the update payload, skipping undefined fields.
    const updates: string[] = [];
    const bindValues: unknown[] = [];
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) {
        updates.push(`${k} = ?`);
        bindValues.push(v);
      }
    }

    if (updates.length === 0) return fail("صيغة الطلب غير صالحة.", 400);

    updates.push("updatedAt = datetime('now')");
    bindValues.push(id);

    await db
      .prepare(`UPDATE AdminUser SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...bindValues)
      .run();

    // Re-read for audit comparison and response
    const updated = await db
      .prepare("SELECT * FROM AdminUser WHERE id = ?")
      .bind(id)
      .first();

    await writeAudit({
      adminUserId: admin.adminId,
      action: "admin_user.update",
      entityType: "admin_user",
      entityId: id,
      metadata: {
        fields: Object.keys(input),
        previousRole: existing.role,
        newRole: updated.role,
        previousIsActive: existing.isActive,
        newIsActive: updated.isActive,
      },
    });

    return ok({
      id: updated.id,
      externalId: updated.externalId,
      displayName: updated.displayName,
      email: updated.email,
      role: updated.role,
      isActive: updated.isActive,
      updatedAt: updated.updatedAt,
    });
  }
);

/**
 * DELETE /api/admin/users/[id]
 * Deactivate (soft-delete) an admin user — preserves the audit trail.
 * Never hard-deletes. Audits `admin_user.deactivate`. Idempotent if
 * the user is already inactive.
 */
export const DELETE = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { admin, deny } = await requireSuperAdmin();
    if (deny || !admin) return deny;

    const db = getDB();
    const { id } = await ctx.params;
    const existing = await db
      .prepare("SELECT * FROM AdminUser WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return fail("المستخدم غير موجود.", 404);

    // Prevent a SUPER_ADMIN from deactivating themselves (lockout guard).
    if (existing.id === admin.adminId) {
      return fail("لا يمكنك تعطيل حسابك أثناء استخدامه.", 400);
    }

    if (!existing.isActive) {
      // Idempotent — already inactive. Return current state, no audit
      // since nothing changed.
      return ok({
        id: existing.id,
        externalId: existing.externalId,
        isActive: false,
        deactivated: false,
      });
    }

    await db
      .prepare(
        "UPDATE AdminUser SET isActive = 0, updatedAt = datetime('now') WHERE id = ?"
      )
      .bind(id)
      .run();

    await writeAudit({
      adminUserId: admin.adminId,
      action: "admin_user.deactivate",
      entityType: "admin_user",
      entityId: id,
      metadata: {
        externalId: existing.externalId,
        previousRole: existing.role,
      },
    });

    return ok({
      id,
      externalId: existing.externalId,
      isActive: false,
      deactivated: true,
    });
  }
);
