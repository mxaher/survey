import { cookies } from "next/headers";
import { computeEmployeeHmac, normalizeEmployeeId } from "@/lib/employee-hmac";

/**
 * Dev-mode EmployeeIdentityProvider (spec §6).
 *
 * In production this would call Cloudflare Access / Microsoft Entra ID /
 * the company SSO via the `EmployeeIdentityProvider` interface. Here we
 * implement a clearly-labeled dev mode: the admin "impersonates" an
 * employee by setting a cookie through the admin UI (Employee Picker),
 * and the server computes the HMAC from that identifier.
 *
 * The identifier is NEVER persisted to the responses layer — only its
 * HMAC lives in `participation_ledger`, which is never joined to
 * responses (see spec §5.2).
 *
 * The UI clearly labels this as dev mode and the README must call out
 * that residual risk from the identity provider / infra logs is
 * "de-identified," not "100% anonymous."
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

/** Get the currently impersonated employee (dev mode). Returns null if none. */
export async function getVerifiedEmployee(): Promise<VerifiedEmployee | null> {
  if (process.env.NODE_ENV === "production") {
    // In production this is where the real IdP hook would go.
    // For now, return null — the app must be configured with a real provider.
    return null;
  }

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

/** Sets the dev-impersonated employee (called from the admin Employee Picker). */
export async function setDevEmployee(emp: VerifiedEmployee): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
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
  if (process.env.NODE_ENV === "production") return;
  const store = await cookies();
  store.delete(DEV_EMPLOYEE_COOKIE);
}

/** Lists the known dev-mode employees (set by the admin via System Settings). */
export async function listDevEmployees(): Promise<VerifiedEmployee[]> {
  if (process.env.NODE_ENV === "production") return [];
  const store = await cookies();
  const raw = store.get(DEV_EMPLOYEE_LIST_COOKIE)?.value;
  if (!raw) {
    // Default dev roster — clearly fake, never real PII.
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
  if (process.env.NODE_ENV === "production") return;
  const store = await cookies();
  store.set(DEV_EMPLOYEE_LIST_COOKIE, JSON.stringify(list), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Returns the HMAC of the currently impersonated employee, or null. */
export async function getEmployeeHmac(): Promise<string | null> {
  const emp = await getVerifiedEmployee();
  if (!emp) return null;
  return computeEmployeeHmac(emp.externalId);
}

/** Re-export for tests / admin UI. */
export { normalizeEmployeeId, computeEmployeeHmac };
