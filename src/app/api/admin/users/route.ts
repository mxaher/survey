import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { hashPassword } from "@/lib/auth";
import { revokeAdminSessions } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/** SUPER_ADMIN-only guard. Returns a `fail()` response if the admin
 * is not SUPER_ADMIN, otherwise returns null and the caller proceeds. */
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
 * GET /api/admin/users
 * Lists all admin users (SUPER_ADMIN only). Includes `lastLoginAt`
 * computed from the audit log — the most recent audit entry for each
 * admin (any action by that admin counts as "activity"). This avoids
 * adding a dedicated login-tracking table while still surfacing
 * "when did this admin last do anything".
 */
export const GET = apiHandler(async () => {
  const { admin, deny } = await requireSuperAdmin();
  if (deny || !admin) return deny;

  const db = getDB();

  const users = await db
    .prepare("SELECT * FROM AdminUser ORDER BY createdAt DESC")
    .all();

  // Fetch the most recent audit entry per admin user — this is our
  // "last activity" proxy for "last login". A single query with
  // groupBy gives us the latest createdAt per adminUserId.
  const lastActivity = await db
    .prepare(
      "SELECT adminUserId, MAX(createdAt) as lastCreatedAt FROM AuditLog GROUP BY adminUserId"
    )
    .all();
  const lastActivityById = new Map(
    (lastActivity.results ?? [])
      .filter((a) => a.adminUserId !== null)
      .map((a) => [a.adminUserId as string, a.lastCreatedAt])
  );

  return ok({
    users: (users.results ?? []).map((u) => ({
      id: u.id,
      externalId: u.externalId,
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      lastLoginAt: lastActivityById.get(u.id as string) ?? null,
    })),
  });
});

const createSchema = z.object({
  externalId: z
    .string()
    .trim()
    .min(1, "المعرّ الخارجي مطلوب."),
  displayName: z.string().trim().optional().nullable(),
  email: z.string().trim().email("البريد الإلكتروني غير صالح.").optional().nullable(),
  role: z.enum(["SUPER_ADMIN", "SURVEY_ADMIN"]).default("SURVEY_ADMIN"),
  isActive: z.coerce.boolean().default(true),
  password: z
    .string()
    .min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل."),
});

/**
 * POST /api/admin/users
 * Create a new admin user (SUPER_ADMIN only). Audits `admin_user.create`.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const { admin, deny } = await requireSuperAdmin();
  if (deny || !admin) return deny;

  const db = getDB();

  const json = await request.json().catch(() => null);
  if (!json || typeof json !== "object") {
    return fail("صيغة الطلب غير صالحة.", 400);
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return fail(parsed.error.issues?.[0]?.message ?? "صيغة الطلب غير صالحة.", 422);
  }
  const input = parsed.data;

  const existing = await db
    .prepare("SELECT id FROM AdminUser WHERE externalId = ?")
    .bind(input.externalId)
    .first();
  if (existing) {
    return fail("المعرّ الخارجي مستخدم بالفعل.", 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { hash, salt } = await hashPassword(input.password);
  await db
    .prepare(
      "INSERT INTO AdminUser (id, externalId, displayName, email, role, isActive, passwordHash, salt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      id,
      input.externalId,
      input.displayName ?? null,
      input.email ?? null,
      input.role,
      input.isActive,
      hash,
      salt,
      now,
      now
    )
    .run();

  await writeAudit({
    adminUserId: admin.adminId,
    action: "admin_user.create",
    entityType: "admin_user",
    entityId: id,
    metadata: {
      externalId: input.externalId,
      role: input.role,
    },
  });

  return ok(
    {
      id,
      externalId: input.externalId,
      displayName: input.displayName ?? null,
      email: input.email ?? null,
      role: input.role,
      isActive: input.isActive,
      createdAt: now,
    },
    { status: 201 }
  );
});
