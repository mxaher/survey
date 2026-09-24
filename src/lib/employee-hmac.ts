import { createHmac, randomUUID } from "crypto";

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
 * In dev, when EMPLOYEE_HMAC_SECRET is unset, we use a stable random secret
 * per-process so the duplicate-prevention mechanism still works end-to-end
 * for QA. In production a real secret MUST be configured.
 */
const DEV_FALLBACK_SECRET = "dev-almrshd-secret-do-not-use-in-prod";

/**
 * Normalize the employee identifier: trim + lowercase email-style input so
 * the HMAC is stable regardless of minor formatting differences.
 */
export function normalizeEmployeeId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function computeEmployeeHmac(rawEmployeeId: string, secret?: string): string {
  const normalized = normalizeEmployeeId(rawEmployeeId);
  const hmacSecret = secret || DEV_FALLBACK_SECRET;
  return createHmac("sha256", hmacSecret).update(normalized).digest("hex");
}

/** Generate a fresh random response_group_id at submission time. Not derived from identity. */
export function newResponseGroupId(): string {
  return randomUUID();
}
