import { createHmac, randomUUID } from "crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Compute an HMAC-SHA256 of the normalized employee identifier.
 *
 * Architecture (per spec §5.3):
 *   - `EMPLOYEE_HMAC_SECRET` lives only in server-side env, never reaches the browser.
 *   - The HMAC is used ONLY inside `participation_ledger` to enforce
 *     one-participation-per-employee + one-evaluation-per-executive-per-employee.
 *   - It is NEVER joined to, or stored alongside, `responses`.
 *   - It is NEVER returned in any API response.
 *
 * In dev, when EMPLOYEE_HMAC_SECRET is unset, a fixed fallback secret is used
 * so the duplicate-prevention mechanism still works end-to-end for QA. The
 * deployed worker always has the real secret configured.
 */
const DEV_FALLBACK_SECRET = "dev-almrshd-secret-do-not-use-in-prod";

/**
 * Resolve the HMAC secret: the real secret is the worker secret
 * `EMPLOYEE_HMAC_SECRET` (set with `wrangler secret put EMPLOYEE_HMAC_SECRET`).
 *
 * Read from the Cloudflare env binding first — the same source the app uses
 * for the D1 binding — because `process.env` is only populated on Workers
 * with a compatibility date of 2025-04-01 or later. `process.env` stays as a
 * secondary source. The dev fallback only applies when neither is set.
 */
export function getHmacSecret(): string {
  return readSecretFromEnv() ?? DEV_FALLBACK_SECRET;
}

/** Whether a real secret is configured (surfaced in admin system stats). */
export function isHmacSecretConfigured(): boolean {
  return readSecretFromEnv() !== null;
}

function readSecretFromEnv(): string | null {
  try {
    const { env } = getCloudflareContext() as unknown as {
      env: Record<string, unknown>;
    };
    const value = env.EMPLOYEE_HMAC_SECRET;
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  } catch {
    // Outside a request context (scripts/tests) — fall through.
  }

  const fromProcess = process.env.EMPLOYEE_HMAC_SECRET?.trim();
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  return null;
}

/**
 * Normalize the employee identifier: trim + lowercase email-style input so
 * the HMAC is stable regardless of minor formatting differences.
 */
export function normalizeEmployeeId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function computeEmployeeHmac(rawEmployeeId: string, secret?: string): string {
  const normalized = normalizeEmployeeId(rawEmployeeId);
  const hmacSecret = secret || getHmacSecret();
  return createHmac("sha256", hmacSecret).update(normalized).digest("hex");
}

/** Generate a fresh random response_group_id at submission time. Not derived from identity. */
export function newResponseGroupId(): string {
  return randomUUID();
}
