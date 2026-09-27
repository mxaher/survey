import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { verifyPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().min(1, "البريد الإلكتروني مطلوب."),
  password: z.string().min(1, "كلمة المرور مطلوبة."),
});

/** Deliberately identical for unknown email, wrong password and inactive
 * account so this endpoint cannot be used to enumerate accounts. */
const INVALID_CREDENTIALS = "البريد الإلكتروني أو كلمة المرور غير صحيحة.";

interface AdminRow {
  id: string;
  externalId: string;
  displayName: string | null;
  email: string | null;
  role: "SUPER_ADMIN" | "SURVEY_ADMIN";
  isActive: number;
  passwordHash: string | null;
  salt: string | null;
}

interface EmployeeRow {
  id: string;
  email: string;
  displayName: string | null;
  department: string | null;
  isActive: number;
  banned: number;
  passwordHash: string;
  salt: string;
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}

/**
 * POST /api/auth/login — email + password.
 * Admins match `AdminUser.externalId`/`email`; employees match
 * `EmployeeUser.email`. On success an opaque session row is created and the
 * httpOnly `session_token` cookie is set.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const rl = await checkRateLimit(`login:${clientIp(request)}`);
  if (!rl.allowed) {
    return fail("محاولات كثيرة جدًا. يرجى المحاولة بعد دقيقة.", 429);
  }

  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      parsed.error.issues?.[0]?.message ?? "البريد الإلكتروني وكلمة المرور مطلوبان.",
      400
    );
  }
  const { email, password } = parsed.data;
  const db = getDB();

  const admin = await db
    .prepare(
      "SELECT * FROM AdminUser WHERE lower(externalId) = lower(?) " +
        "OR (email IS NOT NULL AND lower(email) = lower(?)) LIMIT 1"
    )
    .bind(email, email)
    .first<AdminRow>();

  if (admin) {
    if (
      !admin.isActive ||
      !admin.passwordHash ||
      !admin.salt ||
      !(await verifyPassword(password, admin.passwordHash, admin.salt))
    ) {
      return fail(INVALID_CREDENTIALS, 401);
    }
    await createSession("admin", admin.id);
    return ok({
      user: {
        kind: "admin" as const,
        name: admin.displayName ?? admin.externalId,
        email: admin.email ?? admin.externalId,
        isAdmin: true,
        role: admin.role,
      },
    });
  }

  const employee = await db
    .prepare("SELECT * FROM EmployeeUser WHERE lower(email) = lower(?) LIMIT 1")
    .bind(email)
    .first<EmployeeRow>();

  if (employee) {
    if (
      !employee.isActive ||
      employee.banned ||
      !(await verifyPassword(password, employee.passwordHash, employee.salt))
    ) {
      return fail(INVALID_CREDENTIALS, 401);
    }
    await createSession("employee", employee.id);
    return ok({
      user: {
        kind: "employee" as const,
        name: employee.displayName ?? employee.email,
        email: employee.email,
        isAdmin: false,
        department: employee.department ?? undefined,
      },
    });
  }

  return fail(INVALID_CREDENTIALS, 401);
});
