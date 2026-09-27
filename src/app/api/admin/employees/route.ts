import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { hashPassword } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const admin = await getAdminUser();
  if (!admin) return { admin: null, deny: fail(MESSAGES.unauthorized, 401) };
  return { admin, deny: null };
}

async function requireSuperAdmin() {
  const { admin, deny } = await requireAdmin();
  if (deny || !admin) return { admin: null, deny };
  if (admin.role !== "SUPER_ADMIN") {
    return {
      admin: null,
      deny: fail("لا تملك صلاحية تنفيذ هذه العملية", 403),
    };
  }
  return { admin, deny: null };
}

/**
 * GET /api/admin/employees
 * Lists employee accounts (any admin). Password material is never returned.
 */
export const GET = apiHandler(async () => {
  const { deny } = await requireAdmin();
  if (deny) return deny;

  const db = getDB();
  const employees = await db
    .prepare(
      "SELECT id, email, displayName, department, isActive, banned, emailVerified, createdAt, updatedAt FROM EmployeeUser ORDER BY createdAt DESC"
    )
    .all();

  return ok({
    employees: (employees.results ?? []).map((e) => ({
      id: e.id,
      email: e.email,
      displayName: e.displayName,
      department: e.department,
      isActive: e.isActive,
      banned: e.banned,
      emailVerified: e.emailVerified,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    })),
  });
});

const createSchema = z.object({
  email: z.string().trim().email("البريد الإلكتروني غير صالح."),
  displayName: z.string().trim().min(1, "اسم الموظف مطلوب.").max(120),
  department: z.string().trim().max(120).optional().nullable(),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل."),
});

/**
 * POST /api/admin/employees
 * Create an employee account (SUPER_ADMIN only). Audits `employee.create`.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const { admin, deny } = await requireSuperAdmin();
  if (deny || !admin) return deny;

  const db = getDB();
  const json = await request.json().catch(() => null);
  if (!json || typeof json !== "object") {
    return fail("صيغة الطلب غير صالحة.", 400);
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return fail(parsed.error.issues?.[0]?.message ?? "صيغة الطلب غير صالحة.", 422);
  }
  const input = parsed.data;
  const email = input.email.toLowerCase();

  const existing = await db
    .prepare("SELECT id FROM EmployeeUser WHERE lower(email) = lower(?)")
    .bind(email)
    .first();
  if (existing) {
    return fail("حساب بهذا البريد الإلكتروني موجود بالفعل.", 409);
  }

  const { hash, salt } = await hashPassword(input.password);
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO EmployeeUser (id, email, displayName, department, passwordHash, salt, isActive, banned, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 1, datetime('now'), datetime('now'))"
    )
    .bind(id, email, input.displayName, input.department ?? null, hash, salt)
    .run();

  await writeAudit({
    adminUserId: admin.adminId,
    action: "employee.create",
    entityType: "employee_user",
    entityId: id,
    metadata: { email, department: input.department ?? null },
  });

  return ok(
    {
      id,
      email,
      displayName: input.displayName,
      department: input.department ?? null,
      isActive: 1,
      banned: 0,
      emailVerified: 1,
    },
    { status: 201 }
  );
});
