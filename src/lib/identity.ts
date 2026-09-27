import { cookies } from "next/headers";
import { getDB } from "@/lib/db";
import { computeEmployeeHmac, normalizeEmployeeId } from "@/lib/employee-hmac";
import { getSession } from "@/lib/session";
import { getAdminUser } from "@/lib/admin-auth";

/**
 * Employee identity provider (spec §6).
 *
 * Primary source of truth: an authenticated **employee session** created by
 * `POST /api/auth/login` (email + password, PBKDF2). The server looks the
 * account up, and the identifier it derives the HMAC from is the account's
 * email — never stored alongside responses, only as an HMAC in
 * `participation_ledger` (spec §5.2).
 *
 * Secondary source: the dev impersonation cookie written by the admin
 * Employee Picker. It is only honored for an **authenticated admin**, so it
 * works as an admin preview tool instead of a way for anyone to assume an
 * arbitrary identity.
 */
export interface VerifiedEmployee {
  externalId: string;
  role?: string;
  department?: string;
  isActive: boolean;
  displayName?: string;
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
    };
  }

  // Dev impersonation preview — admins only.
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
    return { ...parsed, isActive: parsed.isActive ?? true };
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
