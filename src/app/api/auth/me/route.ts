import { ok, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { getSession } from "@/lib/session";
import { getDB } from "@/lib/db";

export const dynamic = "force-dynamic";

interface EmployeeRow {
  id: string;
  email: string;
  displayName: string | null;
  department: string | null;
}

/**
 * GET /api/auth/me — who is signed in (employee session or admin session).
 * Always answers 200 so clients can branch on `authenticated` without
 * treating a logged-out visitor as an error.
 */
export const GET = apiHandler(async () => {
  const session = await getSession();
  if (!session) return ok({ authenticated: false });

  if (session.adminUserId) {
    const admin = await getAdminUser();
    if (admin) {
      return ok({
        authenticated: true,
        kind: "admin" as const,
        name: admin.displayName ?? admin.externalId,
        email: admin.email ?? admin.externalId,
        isAdmin: true,
        role: admin.role,
      });
    }
    return ok({ authenticated: false });
  }

  if (session.employeeUserId) {
    const db = getDB();
    const employee = await db
      .prepare(
        "SELECT id, email, displayName, department FROM EmployeeUser WHERE id = ? AND isActive = 1 AND banned = 0"
      )
      .bind(session.employeeUserId)
      .first<EmployeeRow>();
    if (employee) {
      return ok({
        authenticated: true,
        kind: "employee" as const,
        name: employee.displayName ?? employee.email,
        email: employee.email,
        isAdmin: false,
        department: employee.department ?? undefined,
      });
    }
  }

  return ok({ authenticated: false });
});
