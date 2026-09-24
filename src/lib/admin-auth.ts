import { cookies } from "next/headers";
import { getDB } from "@/lib/db";
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
const ADMIN_SESSION_SECRET_DEFAULT = "dev-admin-secret-do-not-use-in-prod";

export type AdminRole = "SUPER_ADMIN" | "SURVEY_ADMIN";

export interface AdminSession {
  adminId: string;
  externalId: string;
  displayName?: string;
  email?: string;
  role: AdminRole;
}

/** Build an opaque session token: `${adminId}.${hmacOfAdminId}`. */
function makeSessionToken(adminId: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(adminId).digest("hex");
  return `${adminId}.${mac}`;
}

function parseSessionToken(token: string, secret: string): string | null {
  const [adminId, mac] = token.split(".");
  if (!adminId || !mac) return null;
  const expected = createHmac("sha256", secret).update(adminId).digest("hex");
  // constant-time-ish compare
  if (mac.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? adminId : null;
}

/** Ensure a default SURVEY_ADMIN row exists in dev (bootstrap). */
async function ensureBootstrapAdmin(db: D1Database): Promise<{ id: string; externalId: string; displayName: string; role: AdminRole }> {
  let admin = await db.prepare(
    `SELECT * FROM AdminUser WHERE externalId = ?`
  ).bind("dev-survey-admin@almrshd.local").first() as Record<string, unknown> | null;

  if (!admin) {
    const id = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO AdminUser (id, externalId, displayName, email, role, isActive, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
    ).bind(id, "dev-survey-admin@almrshd.local", "مدير الاستبيان (تجريبي)", "dev-survey-admin@almrshd.local", "SURVEY_ADMIN").run();
    admin = await db.prepare(`SELECT * FROM AdminUser WHERE id = ?`).bind(id).first() as Record<string, unknown>;
  }
  return {
    id: admin!.id as string,
    externalId: admin!.externalId as string,
    displayName: (admin!.displayName as string) ?? "مدير الاستبيان",
    role: (admin!.role as string) as AdminRole,
  };
}

/** Get the currently authenticated admin (or null). In dev, auto-creates
 * a default SURVEY_ADMIN session so the platform is usable immediately. */
export async function getAdminUser(secret?: string): Promise<AdminSession | null> {
  const db = getDB();
  const sessionSecret = secret || ADMIN_SESSION_SECRET_DEFAULT;
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;

  let adminId: string | null = null;
  if (token) adminId = parseSessionToken(token, sessionSecret);

  if (!adminId) {
    // Dev bootstrap: auto-create and sign in a default admin so the
    // platform is usable end-to-end without an IdP. The UI must label
    // this clearly as dev mode.
    const a = await ensureBootstrapAdmin(db);
    const newToken = makeSessionToken(a.id, sessionSecret);
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

  const row = await db.prepare(
    `SELECT * FROM AdminUser WHERE id = ?`
  ).bind(adminId).first() as Record<string, unknown> | null;
  if (!row || !row.isActive) return null;
  return {
    adminId: row.id as string,
    externalId: row.externalId as string,
    displayName: (row.displayName as string) ?? undefined,
    email: (row.email as string) ?? undefined,
    role: row.role as AdminRole,
  };
}

/** Sign in as an existing admin by externalId (used by the dev login screen). */
export async function signInAdmin(externalId: string, secret?: string): Promise<AdminSession | null> {
  const db = getDB();
  const sessionSecret = secret || ADMIN_SESSION_SECRET_DEFAULT;
  const row = await db.prepare(
    `SELECT * FROM AdminUser WHERE externalId = ? AND isActive = 1`
  ).bind(externalId).first() as Record<string, unknown> | null;
  if (!row) return null;
  const token = makeSessionToken(row.id as string, sessionSecret);
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return {
    adminId: row.id as string,
    externalId: row.externalId as string,
    displayName: (row.displayName as string) ?? undefined,
    email: (row.email as string) ?? undefined,
    role: row.role as AdminRole,
  };
}

export async function signOutAdmin(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_SESSION_COOKIE);
}

/** Promote a SURVEY_ADMIN to SUPER_ADMIN (dev convenience). */
export async function promoteToSuperAdmin(externalId: string): Promise<void> {
  const db = getDB();
  await db.prepare(
    `UPDATE AdminUser SET role = 'SUPER_ADMIN', updatedAt = datetime('now') WHERE externalId = ?`
  ).bind(externalId).run();
}
