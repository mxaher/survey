import { z } from "zod";
import { getDB } from "@/lib/db";

/**
 * `SystemSetting` key registry.
 *
 * The table is a flat `key -> valueAr` store, so anything the app treats as a
 * well-known setting gets its constant (and its validation) here instead of
 * being spelled out at every call site.
 *
 * Two things make this file more than a list:
 *   1. **Secret redaction** — `resend_api_key` holds a live provider
 *      credential. It is written by the admin settings screen but must never
 *      be echoed back by a GET, and never recorded in an audit payload.
 *   2. **Value validation** — the generic settings endpoints accept any
 *      key/value pair, so reserved keys get their own shape check to stop a
 *      typo (or the wrong provider's key) from silently disabling email.
 */

/** Verified sender mailbox — the gate `loadConfig()` needs before it sends. */
export const EMAIL_FROM_KEY = "email_from";

/** Resend provider key. Secret: redacted everywhere it is read back. */
export const RESEND_API_KEY_KEY = "resend_api_key";

const SECRET_KEYS: ReadonlySet<string> = new Set([RESEND_API_KEY_KEY]);

export function isSecretSettingKey(key: string): boolean {
  return SECRET_KEYS.has(key);
}

/** Shape returned by the settings endpoints. */
export interface PublicSetting {
  id: string;
  key: string;
  valueAr: string;
  updatedAt: string;
  /** Present only for secret keys — the value was withheld. */
  secret?: boolean;
  /** For secret keys: whether a non-empty value is currently stored. */
  configured?: boolean;
}

interface SettingRow {
  id: string;
  key: string;
  valueAr: string;
  updatedAt: string;
}

/**
 * Project a stored row for an API response. Secret values come back empty
 * with `configured` telling the caller whether something is stored, so the UI
 * can render "محفوظ" without ever seeing the credential.
 */
export function toPublicSetting(row: SettingRow): PublicSetting {
  const base = {
    id: row.id,
    key: row.key,
    valueAr: row.valueAr ?? "",
    updatedAt: row.updatedAt,
  };
  if (!isSecretSettingKey(row.key)) return base;
  return {
    ...base,
    valueAr: "",
    secret: true,
    configured: base.valueAr.trim().length > 0,
  };
}

/** Value that goes into `AuditLog.metadata` for a given key. */
export function auditValueFor(key: string, value: unknown): unknown {
  return isSecretSettingKey(key) ? "[redacted]" : value;
}

/**
 * Shape check for reserved keys. Returns an Arabic error message, or null
 * when the value is acceptable. Generic keys stay unrestricted.
 */
export function validateSettingValue(key: string, value: string): string | null {
  if (key === EMAIL_FROM_KEY) {
    const parsed = z.string().trim().email();
    if (!parsed.safeParse(value).success) {
      return "القيمة يجب أن تكون بريدًا إلكترونيًا صالحًا (عنوان المرسِل).";
    }
    return null;
  }

  if (key === RESEND_API_KEY_KEY) {
    // Resend keys are `re_` + [A-Za-z0-9_-]. Rejecting the wrong shape here
    // beats a 401 from the provider on the first registration.
    if (!/^re_[A-Za-z0-9_-]{5,}$/.test(value)) {
      return "مفتاح Resend غير صالح — الصيغة المتوقعة re_ متبوعة بحروف وأرقام.";
    }
    return null;
  }

  return null;
}

/** Batch read of known settings. Missing keys are simply absent from the map. */
export async function readSystemSettings(
  keys: readonly string[]
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (keys.length === 0) return found;

  try {
    const db = getDB();
    const placeholders = keys.map(() => "?").join(", ");
    const rows = await db
      .prepare(
        `SELECT key, valueAr FROM SystemSetting WHERE key IN (${placeholders})`
      )
      .bind(...keys)
      .all<{ key: string; valueAr: string }>();
    for (const row of rows.results ?? []) {
      const value = row.valueAr?.trim();
      if (value) found.set(row.key, value);
    }
  } catch {
    // Outside a Workers request context (or the DB is unreachable): behave as
    // if no settings are stored so callers fall back to their env defaults.
  }

  return found;
}

/** Single-key convenience wrapper around {@link readSystemSettings}. */
export async function getSettingValue(key: string): Promise<string | undefined> {
  return (await readSystemSettings([key])).get(key);
}
