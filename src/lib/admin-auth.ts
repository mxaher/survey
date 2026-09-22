import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { randomUUID, createHmac } from "crypto";

/**
 * Admin authentication (spec §6, §14).
 *
 * Two roles:
 *   - SUPER_ADMIN   — full access including admin user management.
 *   - SURVEY_ADMIN  — configure campaigns, manage executives/questions,
 *                     publish/close/archive, view aggregated results,
 *                     export reports. Cannot identify respondents.
 *
 * Implementation note (adapted from the Cloudflare spec): in dev we use a
 * signed HTTP-only cookie that stores the admin's row id in
 * `admin_users`. The cookie value is an opaque session token, NOT the
 * admin's external_id, so it can be rotated. For now the dev-mode
 * bootstrap creates a default SURVEY_ADMIN row at first run.
 *
 * In production this should be replaced with Cloudflare Access / Entra ID
 * / SSO via the same `getAdminUser()` interface so the rest of the app
 * does not need to change.
 */
const ADMIN_SESSION_COOKIE = "almrshd_admin_session";
const ADMIN_SESSION_SECRET =
  process.env.ADMIN_AUTH_SECRET ?? "dev-admin-secret-do-not-use-in-prod";

export type AdminRole = "SUPER_ADMIN" | "SURVEY_ADMIN";

export interface AdminSession {
  adminId: string;
  externalId: string;
  displayName?: string;
  email?: string;
  role: AdminRole;
}

/** Build an opaque session token: `${adminId}.${hmacOfAdminId}`. */
function makeSessionToken(adminId: string): string {
  const mac = createHmac("sha256", ADMIN_SESSION_SECRET).update(adminId).digest("hex");
  return `${adminId}.${mac}`;
}

function parseSessionToken(token: string): string | null {
  const [adminId, mac] = token.split(".");
  if (!adminId || !mac) return null;
  const expected = createHmac("sha256", ADMIN_SESSION_SECRET).update(adminId).digest("hex");
  // constant-time-ish compare
  if (mac.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? adminId : null;
}

/** Ensure a default SURVEY_ADMIN row exists in dev (bootstrap). */
async function ensureBootstrapAdmin(): Promise<{ id: string; externalId: string; displayName: string; role: AdminRole }> {
  let admin = await db.adminUser.findFirst({
    where: { externalId: "dev-survey-admin@almrshad.local" },
  });
  if (!admin) {
    admin = await db.adminUser.create({
      data: {
        externalId: "dev-survey-admin@almrshad.local",
        displayName: "مدير الاستبيان (تجريبي)",
        email: "dev-survey-admin@almrshad.local",
        role: "SURVEY_ADMIN",
        isActive: true,
      },
    });
  }
  return {
    id: admin.id,
    externalId: admin.externalId,
    displayName: admin.displayName ?? "مدير الاستبيان",
    role: admin.role as AdminRole,
  };
}

/** Get the currently authenticated admin (or null). In dev, auto-creates
 * a default SURVEY_ADMIN session so the platform is usable immediately. */
export async function getAdminUser(): Promise<AdminSession | null> {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;

  let adminId: string | null = null;
  if (token) adminId = parseSessionToken(token);

  if (!adminId) {
    if (process.env.NODE_ENV === "production") return null;
    // Dev bootstrap: auto-create and sign in a default admin so the
    // platform is usable end-to-end without an IdP. The UI must label
    // this clearly as dev mode.
    const a = await ensureBootstrapAdmin();
    const newToken = makeSessionToken(a.id);
    store.set(ADMIN_SESSION_COOKIE, newToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return {
      adminId: a.id,
      externalId: a.externalId,
      displayName: a.displayName,
      role: a.role,
    };
  }

  const row = await db.adminUser.findUnique({ where: { id: adminId } });
  if (!row || !row.isActive) return null;
  return {
    adminId: row.id,
    externalId: row.externalId,
    displayName: row.displayName ?? undefined,
    email: row.email ?? undefined,
    role: row.role as AdminRole,
  };
}

/** Sign in as an existing admin by externalId (used by the dev login screen). */
export async function signInAdmin(externalId: string): Promise<AdminSession | null> {
  const row = await db.adminUser.findFirst({ where: { externalId, isActive: true } });
  if (!row) return null;
  const token = makeSessionToken(row.id);
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return {
    adminId: row.id,
    externalId: row.externalId,
    displayName: row.displayName ?? undefined,
    email: row.email ?? undefined,
    role: row.role as AdminRole,
  };
}

export async function signOutAdmin(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_SESSION_COOKIE);
}

/** Promote a SURVEY_ADMIN to SUPER_ADMIN (dev convenience). */
export async function promoteToSuperAdmin(externalId: string): Promise<void> {
  await db.adminUser.updateMany({
    where: { externalId },
    data: { role: "SUPER_ADMIN" },
  });
}
