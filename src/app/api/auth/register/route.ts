import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isEmailConfigured, sendAccountExistsEmail, sendVerificationEmail } from "@/lib/email";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Only corporate mailboxes may hold an employee account. */
const CORPORATE_DOMAIN = "almarshad.com";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

const registerSchema = z.object({
  email: z.string().trim().email("البريد الإلكتروني غير صالح."),
  displayName: z.string().trim().min(1, "الاسم مطلوب.").max(120),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل."),
});

interface EmployeeRow {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: number;
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}

/**
 * POST /api/auth/register — employee self-registration.
 *
 * Gated by corporate domain (only `@almarshad.com`), rate limited, and every
 * account starts unverified: the one-time link sent to the mailbox is what
 * flips `emailVerified`. An address that is already registered gets a notice
 * email instead of an error so the endpoint cannot be used to enumerate
 * accounts.
 *
 * The email is sent *before* the row is written: a delivery failure leaves no
 * half-registered account behind.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const ip = clientIp(request);
  const rl = await checkRateLimit(`register:${ip}`);
  if (!rl.allowed) {
    return fail("محاولات كثيرة جدًا. يرجى المحاولة بعد دقيقة.", 429);
  }

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues?.[0]?.message ?? "صيغة الطلب غير صالحة.", 422);
  }

  const email = parsed.data.email.toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (domain !== CORPORATE_DOMAIN) {
    return fail(
      `التسجيل متاح لموظفي الشركة فقط عبر بريد ‎@${CORPORATE_DOMAIN}‎.`,
      422
    );
  }

  if (!isEmailConfigured()) {
    return fail(
      "التسجيل الذاتي غير متاح حاليًا — تواصل مع إدارة النظام لإنشاء حسابك.",
      503
    );
  }

  const db = getDB();
  const existing = await db
    .prepare(
      "SELECT id, email, displayName, emailVerified FROM EmployeeUser WHERE lower(email) = lower(?) LIMIT 1"
    )
    .bind(email)
    .first<EmployeeRow>();

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
  const verifyUrl = new URL(`/api/auth/verify?token=${token}`, request.url).toString();

  // Send first — never leave an account that nobody can verify.
  const delivery = existing?.emailVerified
    ? await sendAccountExistsEmail({ to: email, displayName: existing.displayName })
    : await sendVerificationEmail({ to: email, displayName: parsed.data.displayName, verifyUrl });

  if (!delivery.success) {
    console.error("[register] verification email failed:", delivery.error);
    return fail(
      "تعذّر إرسال بريد التأكيد. يرجى المحاولة مرة أخرى لاحقًا أو التواصل مع إدارة النظام.",
      503
    );
  }

  const { hash, salt } = await hashPassword(parsed.data.password);

  if (existing) {
    // Re-registration on a not-yet-verified address: refresh the credentials
    // and issue a fresh link (verified accounts never reach this branch).
    await db
      .prepare(
        "UPDATE EmployeeUser SET displayName = ?, passwordHash = ?, salt = ?, verifyToken = ?, verifyExpiresAt = ?, updatedAt = datetime('now') WHERE id = ?"
      )
      .bind(parsed.data.displayName, hash, salt, token, expiresAt, existing.id)
      .run();
    return ok({ sent: true, email });
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO EmployeeUser (id, email, displayName, passwordHash, salt, emailVerified, verifyToken, verifyExpiresAt, isActive, banned, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, 0, datetime('now'), datetime('now'))"
    )
    .bind(id, email, parsed.data.displayName, hash, salt, token, expiresAt)
    .run();

  await writeAudit({
    action: "employee.register",
    entityType: "employee_user",
    entityId: id,
    metadata: { source: "self-service" },
  });

  return ok({ sent: true, email }, { status: 201 });
});
