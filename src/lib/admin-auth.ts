import { getDB } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import {
  createSession,
  destroySession,
  destroySessionsFor,
  getSession,
} from "@/lib/session";

/**
 * Admin authentication (spec §6, §14).
 *
 * Two roles:
 *   - SUPER_ADMIN   — full access including admin user management.
 *   - SURVEY_ADMIN  — configure campaigns, manage executives/questions,
 *                     publish/close/archive, view aggregated results,
 *                     export reports. Cannot identify respondents.
 *
 * Ported from the fifa2026-vercel auth model: email + password (PBKDF2)
 * checked against `AdminUser.passwordHash`/`salt`, then an opaque random
 * token row in `Session` handed to the browser as an httpOnly cookie.
 *
 * NOTE: the pre-auth dev bootstrap that auto-created a session for every
 * visitor has been removed — an anonymous request now gets `null` and every
 * admin API answers 401.
 */
export type AdminRole = "SUPER_ADMIN" | "SURVEY_ADMIN";

export interface AdminSession {
  adminId: string;
  externalId: string;
  displayName?: string;
  email?: string;
  role: AdminRole;
}

export interface AdminCredentials {
  id: string;
  externalId: string;
  displayName: string | null;
  email: string | null;
  role: AdminRole;
  isActive: number | boolean;
  passwordHash: string | null;
  salt: string | null;
}

/** Get the currently authenticated admin, or null. */
export async function getAdminUser(): Promise<AdminSession | null> {
  const session = await getSession();
  if (!session?.adminUserId) return null;

  const db = getDB();
  const row = await db
    .prepare("SELECT * FROM AdminUser WHERE id = ?")
    .bind(session.adminUserId)
    .first<AdminCredentials>();

  if (!row || !row.isActive) return null;

  return {
    adminId: row.id,
    externalId: row.externalId,
    displayName: row.displayName ?? undefined,
    email: row.email ?? undefined,
    role: row.role,
  };
}

/**
 * Verify email + password against the admin table and start a session.
 * Returns null on any failure — callers must answer with a generic
 * "invalid credentials" message so the endpoint cannot be used to probe
 * which addresses exist.
 */
export async function signInAdminWithPassword(
  login: string,
  password: string
): Promise<AdminSession | null> {
  const db = getDB();
  const row = await db
    .prepare(
      "SELECT * FROM AdminUser WHERE lower(externalId) = lower(?) OR (email IS NOT NULL AND lower(email) = lower(?)) LIMIT 1"
    )
    .bind(login, login)
    .first<AdminCredentials>();

  if (!row || !row.isActive) return null;
  if (!row.passwordHash || !row.salt) return null;

  const valid = await verifyPassword(password, row.passwordHash, row.salt);
  if (!valid) return null;

  await createSession("admin", row.id);

  return {
    adminId: row.id,
    externalId: row.externalId,
    displayName: row.displayName ?? undefined,
    email: row.email ?? undefined,
    role: row.role,
  };
}

export async function signOutAdmin(): Promise<void> {
  await destroySession();
}

/** Drop every session of an admin (used after password change / deactivate). */
export async function revokeAdminSessions(adminId: string): Promise<void> {
  await destroySessionsFor("admin", adminId);
}

/** Promote a SURVEY_ADMIN to SUPER_ADMIN. */
export async function promoteToSuperAdmin(externalId: string): Promise<void> {
  const db = getDB();
  await db
    .prepare(
      "UPDATE AdminUser SET role = 'SUPER_ADMIN', updatedAt = datetime('now') WHERE externalId = ?"
    )
    .bind(externalId)
    .run();
}
