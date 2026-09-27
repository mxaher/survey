import { cookies, headers } from "next/headers";
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
 *   1. Cloudflare Access JWT (`Cf-Access-JWT-Assertion`) — the production
 *      path. The visitor is authenticated by the corporate identity layer
 *      before the request ever reaches the app, so no username/password
 *      screen is rendered. Only the verified `sub` is used, and only in
 *      memory, to key the participation HMAC.
 *   2. An authenticated **employee session** created by `POST /api/auth/login`
 *      (email + password). The identifier hashed is the account email — never
 *      stored alongside responses, only as an HMAC in `ParticipationLedger`.
 *      No UI in the survey flow renders this form; it remains for local work
 *      and for sessions already established through the admin shell.
 *   3. The dev impersonation cookie written by the admin Employee Picker. Only
 *      honored for an authenticated admin, and refused by every submit
 *      endpoint — it is a preview tool, never a way to write participation.
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

interface EmployeeUserRow {
  id: string;
  email: string;
  displayName: string | null;
  department: string | null;
  isActive: number;
  banned: number;
}

/** Get the current employee identity. Returns null when nobody is signed in. */
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

  // 2. Existing first-party session.
  const session = await getSession();

  if (session?.employeeUserId) {
    const db = getDB();
    const row = await db
      .prepare("SELECT * FROM EmployeeUser WHERE id = ?")
      .bind(session.employeeUserId)
      .first<EmployeeUserRow>();
    if (!row || !row.isActive || row.banned) return null;
    return {
      externalId: row.email,
      displayName: row.displayName ?? row.email,
      department: row.department ?? undefined,
      role: "employee",
      isActive: true,
      source: "session",
    };
  }

  // 3. Dev impersonation preview — admins only, and write-blocked on submit.
  const admin = await getAdminUser();
  if (!admin) return null;
  return readDevEmployeeCookie();
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
