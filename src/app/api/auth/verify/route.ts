import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { apiHandler } from "@/lib/api";

export const dynamic = "force-dynamic";

const LOGIN_URL = "/?view=employee";

/**
 * GET /api/auth/verify?token=… — the link emailed at self-registration.
 *
 * Renders a small self-contained HTML page for every outcome (the recipient
 * is an employee following an email, not an API client). Success flips
 * `emailVerified` and consumes the one-time token.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) return page("error", "رابط التأكيد غير صالح");

  const db = getDB();
  const employee = await db
    .prepare(
      "SELECT id, emailVerified, verifyExpiresAt FROM EmployeeUser WHERE verifyToken = ? LIMIT 1"
    )
    .bind(token)
    .first<{ id: string; emailVerified: number; verifyExpiresAt: string | null }>();

  if (!employee) {
    return page("error", "رابط التأكيد غير صالح أو تم استخدامه بالفعل.");
  }

  if (employee.emailVerified) {
    return page("success", "تم تأكيد بريدك الإلكتروني مسبقًا. يمكنك تسجيل الدخول الآن.");
  }

  const expired =
    !employee.verifyExpiresAt ||
    new Date(employee.verifyExpiresAt).getTime() < Date.now();

  if (expired) {
    return page(
      "expired",
      "انتهت صلاحية رابط التأكيد. يمكنك طلب رابطًا جديدًا من صفحة تسجيل الدخول."
    );
  }

  await db
    .prepare(
      "UPDATE EmployeeUser SET emailVerified = 1, verifyToken = NULL, verifyExpiresAt = NULL, updatedAt = datetime('now') WHERE id = ?"
    )
    .bind(employee.id)
    .run();

  return page(
    "success",
    "تم تأكيد بريدك الإلكتروني بنجاح. يمكنك الآن تسجيل الدخول والمشاركة في الاستبيان."
  );
});

type Status = "success" | "error" | "expired";

const TITLES: Record<Status, string> = {
  success: "تم تأكيد البريد الإلكتروني",
  expired: "انتهت صلاحية رابط التأكيد",
  error: "تعذّر تأكيد البريد الإلكتروني",
};

function page(status: Status, message: string): NextResponse {
  const tone =
    status === "success" ? "#16a34a" : status === "expired" ? "#d97706" : "#dc2626";
  const marker = status === "success" ? "تم" : status === "expired" ? "انتهى" : "خطأ";
  const title = TITLES[status];

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
           background:#f1f5f9; font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif; padding:24px; }
    .card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:36px 28px;
            max-width:440px; width:100%; text-align:center; }
    .badge { display:inline-block; color:${tone}; background:${tone}1a; border:1px solid ${tone}40;
             border-radius:999px; padding:6px 16px; font-size:13px; font-weight:700; }
    h1 { font-size:20px; color:#0f172a; margin:18px 0 10px; }
    p { color:#475569; font-size:15px; line-height:1.8; margin:0; }
    a.btn { display:inline-block; margin-top:24px; background:#0f172a; color:#fff; text-decoration:none;
            font-weight:700; padding:12px 32px; border-radius:8px; font-size:15px; }
    .brand { font-weight:700; color:#0f172a; font-size:15px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">المرشد</div>
    <div class="badge" style="margin-top:14px;">${marker}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a class="btn" href="${LOGIN_URL}">تسجيل الدخول</a>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: status === "success" ? 200 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
