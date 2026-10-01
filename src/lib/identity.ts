import { cookies, headers } from "next/headers";
import { randomUUID } from "crypto";
import { getDB } from "@/lib/db";
import { computeEmployeeHmac, normalizeEmployeeId } from "@/lib/employee-hmac";
import { getSession } from "@/lib/session";
import { getAdminUser } from "@/lib/admin-auth";
import {
  ACCESS_JWT_HEADER,
  subjectFromAccessHeader,
  type ParticipantSource,
} from "@/lib/identity-provider";

/**
 * Employee identity provider (spec §6).
 *
 * Resolved **server-side only**, in this order:
 *
 *   1. Cloudflare Access JWT (`Cf-Access-JWT-Assertion`) — when
 *      `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` are configured the visitor is
 *      authenticated by the corporate identity layer before the request ever
 *      reaches the app, so the sign-in form is never needed. Only the
 *      verified `sub` is used, and only in memory, to key the participation
 *      HMAC.
 *   2. An authenticated **employee session** created by `POST /api/auth/login`
 *      (email + password, corporate `@almarshad.com` addresses only), when a
 *      browser happens to have one. Nothing requires it: the survey opens
 *      without any sign-in.
 *   3. The dev impersonation cookie written by the admin Employee Picker. Only
 *      honored for an authenticated admin, and refused by every submit
 *      endpoint — it is a preview tool, never a way to write participation.
 *   4. **Anonymous** — the default. A random per-browser id kept in an
 *      httpOnly cookie and used as the HMAC key, so a respondent never signs
 *      in, never verifies an email, and is never identified; the ledger only
 *      ever sees `HMAC(anonymous:<uuid>)`.
 */
export interface VerifiedEmployee {
  externalId: string;
  role?: string;
  department?: string;
  isActive: boolean;
  displayName?: string;
  /**
   * Where this identity came from.
   *   "cloudflare-access" — verified by the corporate identity layer.
   *   "session"           — an authenticated employee session.
   *   "dev"               — the admin Employee Picker impersonation cookie.
   *   "anonymous"         — no sign-in at all; a random per-browser id.
   *
   * `"dev"` identities may render the employee experience for preview, but
   * they are refused on every submit endpoint: otherwise an admin could pick
   * an arbitrary address and cast fabricated votes (the participation HMAC is
   * derived per subject, so each pick would be a fresh, "valid" participant).
   */
  source?: ParticipantSource;
}

const DEV_EMPLOYEE_COOKIE = "almrshd_dev_employee";
const DEV_EMPLOYEE_LIST_COOKIE = "almrshd_dev_employees";

/** Per-browser anonymous id — the only thing a respondent ever "has". */
const ANON_COOKIE = "almrshd_anon_id";
const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const ANON_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EmployeeUserRow {
  id: string;
  email: string;
  displayName: string | null;
  department: string | null;
  isActive: number;
  banned: number;
}

/**
 * Get the current employee identity.
 *
 * Never requires a sign-in: when no corporate identity, session or admin
 * preview is present, an anonymous per-browser identity is minted instead,
 * so the survey works for anyone with the link (no login, no verification).
 */
export async function getVerifiedEmployee(): Promise<VerifiedEmployee | null> {
  // 1. Background corporate identity — resolved from the Access JWT the edge
  //    attached. No user interaction, nothing sent back to the browser, and
  //    the subject is used only to key the participation HMAC.
  const reqHeaders = await headers();
  const accessSubject = await subjectFromAccessHeader(
    reqHeaders.get(ACCESS_JWT_HEADER)
  );
  if (accessSubject) {
    return {
      externalId: accessSubject,
      isActive: true,
      source: "cloudflare-access",
    };
  }

  // 2. Existing first-party session — an optional convenience, never a
  //    requirement. A stale or disabled session just falls through.
  const session = await getSession();

  if (session?.employeeUserId) {
    const db = getDB();
    const row = await db
      .prepare("SELECT * FROM EmployeeUser WHERE id = ?")
      .bind(session.employeeUserId)
      .first<EmployeeUserRow>();
    if (row && row.isActive && !row.banned) {
      return {
        externalId: row.email,
        displayName: row.displayName ?? row.email,
        department: row.department ?? undefined,
        role: "employee",
        isActive: true,
        source: "session",
      };
    }
  }

  // 3. Dev impersonation preview — admins only, and write-blocked on submit.
  const admin = await getAdminUser();
  if (admin) {
    const preview = await readDevEmployeeCookie();
    if (preview) return preview;
  }

  // 4. Anonymous participation — the default path: no sign-in, no email
  //    verification, no stored identity. The cookie id never leaves the
  //    server un-hashed: only HMAC("anonymous:<uuid>") reaches the ledger.
  return anonymousIdentity();
}

/** Mints (or reuses) the browser's anonymous participant id. */
async function anonymousIdentity(): Promise<VerifiedEmployee> {
  const store = await cookies();
  const existing = store.get(ANON_COOKIE)?.value;
  const id =
    existing && ANON_ID_RE.test(existing) ? existing : randomUUID();

  if (id !== existing) {
    store.set(ANON_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ANON_COOKIE_MAX_AGE,
    });
  }

  return {
    externalId: `anonymous:${id}`,
    isActive: true,
    source: "anonymous",
  };
}

async function readDevEmployeeCookie(): Promise<VerifiedEmployee | null> {
  const store = await cookies();
  const raw = store.get(DEV_EMPLOYEE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VerifiedEmployee;
    if (!parsed.externalId) return null;
    // Forced last: the cookie payload is caller-supplied, so it must never be
    // able to claim `source: "session"` and reach the submit endpoints.
    return { ...parsed, source: "dev", isActive: parsed.isActive ?? true };
  } catch {
    return null;
  }
}

/** Sets the dev-impersonated employee (admin Employee Picker preview). */
export async function setDevEmployee(emp: VerifiedEmployee): Promise<void> {
  const store = await cookies();
  store.set(DEV_EMPLOYEE_COOKIE, JSON.stringify(emp), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

/** Clears the dev-impersonated employee. */
export async function clearDevEmployee(): Promise<void> {
  const store = await cookies();
  store.delete(DEV_EMPLOYEE_COOKIE);
}

/** Lists the known preview employees (set by the admin via System Settings). */
export async function listDevEmployees(): Promise<VerifiedEmployee[]> {
  const store = await cookies();
  const raw = store.get(DEV_EMPLOYEE_LIST_COOKIE)?.value;
  if (!raw) {
    // Default preview roster — clearly fake, never real PII.
    return [
      { externalId: "dev-emp-001@almrshd.local", displayName: "موظف تجريبي 1", department: "العقارات", isActive: true },
      { externalId: "dev-emp-002@almrshd.local", displayName: "موظف تجريبي 2", department: "المقاولات", isActive: true },
      { externalId: "dev-emp-003@almrshd.local", displayName: "موظف تجريبي 3", department: "المعدات الكهربائية", isActive: true },
      { externalId: "dev-emp-004@almrshd.local", displayName: "موظف تجريبي 4", department: "تقنية المعلومات", isActive: true },
      { externalId: "dev-emp-005@almrshd.local", displayName: "موظف تجريبي 5", department: "الموارد البشرية", isActive: true },
    ];
  }
  try {
    return JSON.parse(raw) as VerifiedEmployee[];
  } catch {
    return [];
  }
}

export async function setDevEmployeesList(list: VerifiedEmployee[]): Promise<void> {
  const store = await cookies();
  store.set(DEV_EMPLOYEE_LIST_COOKIE, JSON.stringify(list), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Returns the HMAC of the current employee identity, or null. */
export async function getEmployeeHmac(secret?: string): Promise<string | null> {
  const emp = await getVerifiedEmployee();
  if (!emp) return null;
  return computeEmployeeHmac(emp.externalId, secret);
}

/** Re-export for tests / admin UI. */
export { normalizeEmployeeId, computeEmployeeHmac };
