import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { isEmailConfigured, sendVerificationEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

const resendSchema = z.object({
  email: z.string().trim().email("البريد الإلكتروني غير صالح."),
});

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}

/**
 * POST /api/auth/resend-verification — issue a fresh one-time link.
 *
 * Always answers `sent: true` for a well-formed address so the endpoint
 * cannot be used to discover which accounts exist; an email actually goes out
 * only for a registered, still-unverified account.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const ip = clientIp(request);
  const byIp = await checkRateLimit(`resend:${ip}`);
  if (!byIp.allowed) {
    return fail("محاولات كثيرة جدًا. يرجى المحاولة بعد دقيقة.", 429);
  }

  const body = await request.json().catch(() => null);
  const parsed = resendSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues?.[0]?.message ?? "البريد الإلكتروني غير صالح.", 422);
  }

  const email = parsed.data.email.toLowerCase();
  const byEmail = await checkRateLimit(`resend:email:${email}`);
  if (!byEmail.allowed) {
    return fail("محاولات كثيرة جدًا. يرجى المحاولة بعد دقيقة.", 429);
  }

  if (!(await isEmailConfigured())) {
    return fail(
      "خدمة إرسال البريد غير متاحة حاليًا — تواصل مع إدارة النظام.",
      503
    );
  }

  const db = getDB();
  const employee = await db
    .prepare(
      "SELECT id, displayName, emailVerified FROM EmployeeUser WHERE lower(email) = lower(?) LIMIT 1"
    )
    .bind(email)
    .first<{ id: string; displayName: string | null; emailVerified: number }>();

  if (employee && !employee.emailVerified) {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
    const verifyUrl = new URL(
      `/api/auth/verify?token=${token}`,
      request.url
    ).toString();

    const delivery = await sendVerificationEmail({
      to: email,
      displayName: employee.displayName ?? "",
      verifyUrl,
    });

    if (!delivery.success) {
      console.error("[resend-verification] email failed:", delivery.error);
      return fail(
        "تعذّر إرسال بريد التأكيد. يرجى المحاولة مرة أخرى لاحقًا.",
        503
      );
    }

    await db
      .prepare(
        "UPDATE EmployeeUser SET verifyToken = ?, verifyExpiresAt = ?, updatedAt = datetime('now') WHERE id = ?"
      )
      .bind(token, expiresAt, employee.id)
      .run();
  }

  return ok({ sent: true, email });
});
