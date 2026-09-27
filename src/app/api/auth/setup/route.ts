import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * First-run setup: creates the first SUPER_ADMIN password.
 *
 * The platform ships with no credentials, and the pre-auth dev bootstrap has
 * been removed, so somebody must claim the admin account once. This endpoint
 * only works while **no admin has a password yet** — the moment one exists it
 * answers 409 forever. Complete it immediately after deploying.
 */
async function setupNeeded(): Promise<{ needed: boolean; pendingAdminId: string | null }> {
  const db = getDB();
  const withPassword = await db
    .prepare("SELECT COUNT(*) AS c FROM AdminUser WHERE passwordHash IS NOT NULL")
    .first<{ c: number }>();
  if (Number(withPassword?.c ?? 0) > 0) return { needed: false, pendingAdminId: null };

  const pending = await db
    .prepare("SELECT id FROM AdminUser ORDER BY createdAt ASC LIMIT 1")
    .first<{ id: string }>();
  return { needed: true, pendingAdminId: pending?.id ?? null };
}

/** GET /api/auth/setup — is first-run setup still open? */
export const GET = apiHandler(async () => {
  const { needed } = await setupNeeded();
  return ok({ needed });
});

const setupSchema = z.object({
  email: z.string().trim().email("البريد الإلكتروني غير صالح."),
  displayName: z.string().trim().min(1, "الاسم مطلوب.").max(120),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل."),
});

/** POST /api/auth/setup — claim the admin account. */
export const POST = apiHandler(async (request: NextRequest) => {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    (forwarded ? forwarded.split(",")[0]?.trim() : null) ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const rl = await checkRateLimit(`setup:${ip}`);
  if (!rl.allowed) {
    return fail("محاولات كثيرة جدًا. يرجى المحاولة بعد دقيقة.", 429);
  }

  const state = await setupNeeded();
  if (!state.needed) {
    return fail("تم إنشاء حساب المدير بالفعل.", 409);
  }

  const body = await request.json().catch(() => null);
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues?.[0]?.message ?? "صيغة الطلب غير صالحة.", 422);
  }
  const { email, displayName, password } = parsed.data;

  const db = getDB();
  const clash = await db
    .prepare(
      "SELECT id FROM AdminUser WHERE lower(externalId) = lower(?) OR lower(email) = lower(?)"
    )
    .bind(email, email)
    .first();
  if (clash && clash.id !== state.pendingAdminId) {
    return fail("البريد الإلكتروني مستخدم بالفعل.", 409);
  }

  const { hash, salt } = await hashPassword(password);
  const adminId = state.pendingAdminId ?? crypto.randomUUID();

  if (state.pendingAdminId) {
    await db
      .prepare(
        "UPDATE AdminUser SET externalId = ?, email = ?, displayName = ?, role = 'SUPER_ADMIN', isActive = 1, passwordHash = ?, salt = ?, updatedAt = datetime('now') WHERE id = ?"
      )
      .bind(email, email, displayName, hash, salt, adminId)
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO AdminUser (id, externalId, displayName, email, role, isActive, passwordHash, salt, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'SUPER_ADMIN', 1, ?, ?, datetime('now'), datetime('now'))"
      )
      .bind(adminId, email, displayName, email, hash, salt)
      .run();
  }

  await writeAudit({
    adminUserId: adminId,
    action: "admin.setup",
    entityType: "admin_user",
    entityId: adminId,
    metadata: { email },
  });

  await createSession("admin", adminId);

  return ok({
    user: {
      kind: "admin" as const,
      name: displayName,
      email,
      isAdmin: true,
      role: "SUPER_ADMIN" as const,
    },
  });
});
