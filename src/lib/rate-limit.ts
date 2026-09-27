import { getDB } from "@/lib/db";

/**
 * D1-backed fixed-window rate limiter (ported from fifa2026-vercel
 * `src/lib/rate-limit.ts`, using SQL instead of drizzle).
 *
 * Fails OPEN on storage errors: without a reachable database the protected
 * action (login) cannot succeed anyway, so blocking on limiter failure would
 * only turn a DB outage into a total lockout.
 */
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

export async function checkRateLimit(
  key: string
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const db = getDB();
    const now = new Date();
    const resetAt = new Date(now.getTime() + WINDOW_MS).toISOString();

    const existing = await db
      .prepare("SELECT count, resetAt FROM RateLimit WHERE key = ?")
      .bind(key)
      .first<{ count: number; resetAt: string }>();

    if (!existing || new Date(existing.resetAt).getTime() <= now.getTime()) {
      await db
        .prepare(
          "INSERT INTO RateLimit (key, count, resetAt) VALUES (?, 1, ?) " +
            "ON CONFLICT(key) DO UPDATE SET count = 1, resetAt = excluded.resetAt"
        )
        .bind(key, resetAt)
        .run();
      return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
    }

    if (existing.count >= MAX_ATTEMPTS) {
      return { allowed: false, remaining: 0 };
    }

    await db
      .prepare("UPDATE RateLimit SET count = count + 1 WHERE key = ?")
      .bind(key)
      .run();

    return { allowed: true, remaining: MAX_ATTEMPTS - existing.count - 1 };
  } catch (err) {
    console.error("[rate-limit] unavailable", err);
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }
}
