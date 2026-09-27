import { cookies } from "next/headers";
import { getDB } from "@/lib/db";

/**
 * Server-side session storage (ported from fifa2026-vercel).
 *
 * A session is an opaque random token stored in the `Session` table — never
 * signed client data, never a JWT, so there is no signing secret to manage.
 * The browser only ever sees the token inside an httpOnly cookie.
 *
 * One session row serves both kinds of principal: `adminUserId` XOR
 * `employeeUserId`.
 */
export const SESSION_COOKIE = "session_token";
const LEGACY_ADMIN_COOKIE = "almrshd_admin_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionRow {
  id: string;
  token: string;
  adminUserId: string | null;
  employeeUserId: string | null;
  expiresAt: string;
  createdAt: string;
}

export type SessionKind = "admin" | "employee";

/** Create a session for the given principal and set the session cookie. */
export async function createSession(kind: SessionKind, userId: string): Promise<void> {
  const db = getDB();
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();

  await db
    .prepare(
      "INSERT INTO Session (id, token, adminUserId, employeeUserId, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(
      crypto.randomUUID(),
      token,
      kind === "admin" ? userId : null,
      kind === "employee" ? userId : null,
      expiresAt,
      now.toISOString()
    )
    .run();

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  // Drop the pre-auth dev cookie so a stale admin session cannot linger.
  store.delete(LEGACY_ADMIN_COOKIE);
}

/** Read the current session row, or null when absent/expired. */
export async function getSession(): Promise<SessionRow | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = getDB();
  const row = await db
    .prepare("SELECT * FROM Session WHERE token = ?")
    .bind(token)
    .first<SessionRow>();

  if (!row) return null;

  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    await db.prepare("DELETE FROM Session WHERE id = ?").bind(row.id).run();
    store.delete(SESSION_COOKIE);
    return null;
  }
  return row;
}

/** Delete the current session row and clear the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const db = getDB();
      await db.prepare("DELETE FROM Session WHERE token = ?").bind(token).run();
    } catch (err) {
      console.error("[session] delete failed", err);
    }
  }
  store.delete(SESSION_COOKIE);
}

/** Delete every session belonging to a user (password change / deactivation). */
export async function destroySessionsFor(kind: SessionKind, userId: string): Promise<void> {
  const db = getDB();
  await db
    .prepare(
      kind === "admin"
        ? "DELETE FROM Session WHERE adminUserId = ?"
        : "DELETE FROM Session WHERE employeeUserId = ?"
    )
    .bind(userId)
    .run();
}
