import { readWorkerEnv } from "@/lib/env";
import {
  EMAIL_FROM_KEY,
  RESEND_API_KEY_KEY,
  readSystemSettings,
} from "@/lib/settings";

/**
 * Transactional email.
 *
 * Driven by employee self-registration: `POST /api/auth/register` and
 * `POST /api/auth/resend-verification` send the one-time verification link
 * whenever a provider is configured, and `isEmailConfigured()` tells them to
 * activate the account immediately instead. Admin-triggered notices use the
 * same transport.
 *
 * Providers, ported from fifa2026-vercel `src/lib/email.ts`:
 *   1. Resend  — `RESEND_API_KEY`
 *   2. Mailjet — `MAILJET_API_KEY` + `MAILJET_SECRET_KEY` (fallback)
 * Sender identity comes from `EMAIL_FROM` (+ optional `EMAIL_FROM_NAME`), which
 * must be a domain verified with the provider.
 *
 * Each value is resolved from two places, in order:
 *   1. **Worker env** — a secret (`wrangler secret put RESEND_API_KEY`) or a
 *      `[vars]` entry. Always wins: it is the platform-level, rotatable copy.
 *   2. **`SystemSetting` row** — written from the admin settings screen
 *      (`إعدادات النظام ← التحقق من البريد الإلكتروني`). This is what lets an
 *      operator enable verification without a redeploy.
 *
 * {@link getEmailStatus} reports which source won so the UI can say so.
 */

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  provider?: "resend" | "mailjet";
  error?: string;
}

export interface EmailConfig {
  resendApiKey?: string;
  mailjetApiKey?: string;
  mailjetSecretKey?: string;
  fromEmail: string;
  fromName: string;
}

/** Where a resolved value came from. `null` = nothing found anywhere. */
export type EmailConfigSource = "worker_env" | "system_setting" | null;

export interface EmailStatus {
  /** At least one provider key *and* a sender are present. */
  configured: boolean;
  /** Source of the provider key that would actually be used. */
  providerSource: EmailConfigSource;
  /** Source of the sender address. */
  senderSource: EmailConfigSource;
  /** Provider that would be tried first, or null. */
  provider: "resend" | "mailjet" | null;
  /** Resolved sender address — never a secret, safe to display. */
  fromEmail: string | null;
}

export interface ResolvedEmail {
  config: EmailConfig | null;
  status: EmailStatus;
}

const DEFAULT_FROM_NAME = "استبيان بيئة العمل";

const ENV_KEYS = [
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "MAILJET_API_KEY",
  "MAILJET_SECRET_KEY",
  "EMAIL_FROM_NAME",
] as const;

/**
 * Pure resolution step — takes the two candidate sources and decides what the
 * transport should use. Kept side-effect free so it can be unit tested.
 */
export function resolveEmailConfig(input: {
  env: Partial<Record<(typeof ENV_KEYS)[number], string>>;
  settings: Map<string, string>;
}): ResolvedEmail {
  const { env, settings } = input;

  const envFrom = env.EMAIL_FROM;
  const fromEmail = envFrom ?? settings.get(EMAIL_FROM_KEY);
  const senderSource: EmailConfigSource = envFrom
    ? "worker_env"
    : fromEmail
      ? "system_setting"
      : null;

  const envResend = env.RESEND_API_KEY;
  const resendApiKey = envResend ?? settings.get(RESEND_API_KEY_KEY);

  const mailjetApiKey = env.MAILJET_API_KEY;
  const mailjetSecretKey = env.MAILJET_SECRET_KEY;
  const hasMailjet = Boolean(mailjetApiKey && mailjetSecretKey);

  const provider = resendApiKey ? "resend" : hasMailjet ? "mailjet" : null;
  // Source of the provider that will actually be tried. Mailjet has no
  // settings-row equivalent, so it always comes from the worker env.
  const providerSource: EmailConfigSource =
    provider === "resend"
      ? envResend
        ? "worker_env"
        : "system_setting"
      : provider === "mailjet"
        ? "worker_env"
        : null;

  const status: EmailStatus = {
    configured: Boolean(fromEmail) && Boolean(provider),
    providerSource,
    senderSource,
    provider,
    fromEmail: fromEmail ?? null,
  };

  if (!fromEmail) {
    // Without a verified sender the provider keys are unusable, exactly as
    // before: no config at all, so callers take their "not configured" path.
    return { config: null, status };
  }

  return {
    config: {
      resendApiKey,
      mailjetApiKey,
      mailjetSecretKey,
      fromEmail,
      fromName: env.EMAIL_FROM_NAME ?? DEFAULT_FROM_NAME,
    },
    status,
  };
}

async function loadConfig(): Promise<ResolvedEmail> {
  const env: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
  for (const key of ENV_KEYS) {
    const value = readWorkerEnv(key);
    if (value) env[key] = value;
  }

  const settings = await readSystemSettings([EMAIL_FROM_KEY, RESEND_API_KEY_KEY]);
  return resolveEmailConfig({ env, settings });
}

/** Full picture of the email transport, for admin surfaces. */
export async function getEmailStatus(): Promise<EmailStatus> {
  return (await loadConfig()).status;
}

/** Whether at least one provider + sender is configured. */
export async function isEmailConfigured(): Promise<boolean> {
  return (await loadConfig()).status.configured;
}

async function sendViaResend(
  config: EmailConfig,
  to: string,
  subject: string,
  html: string
): Promise<EmailSendResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [to],
      subject,
      html,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    return { success: false, error: `Resend (${response.status}): ${text}` };
  }

  let data: { id?: string } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    return { success: false, error: `Resend: invalid JSON: ${text}` };
  }
  if (!data?.id) {
    return { success: false, error: `Resend: response missing id: ${text}` };
  }
  return { success: true, messageId: data.id, provider: "resend" };
}

async function sendViaMailjet(
  config: EmailConfig,
  to: string,
  subject: string,
  html: string
): Promise<EmailSendResult> {
  const auth = Buffer.from(
    `${config.mailjetApiKey}:${config.mailjetSecretKey}`
  ).toString("base64");

  const response = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: config.fromEmail, Name: config.fromName },
          To: [{ Email: to }],
          Subject: subject,
          HTMLPart: html,
        },
      ],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    return { success: false, error: `Mailjet (${response.status}): ${text}` };
  }

  let data: { Messages?: { Status?: string }[] } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    return { success: false, error: `Mailjet: invalid JSON: ${text}` };
  }
  if (!data?.Messages?.[0]) {
    return { success: false, error: `Mailjet: unexpected response: ${text}` };
  }
  return {
    success: true,
    messageId: data.Messages[0].Status ?? "sent",
    provider: "mailjet",
  };
}

/** Send through Resend first, falling back to Mailjet when configured. */
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<EmailSendResult> {
  const { config } = await loadConfig();
  if (!config) {
    return {
      success: false,
      error: "EMAIL_FROM is not configured (set the verified sender address).",
    };
  }

  let resendError = "";
  if (config.resendApiKey) {
    const result = await sendViaResend(config, to, subject, html);
    if (result.success) return result;
    resendError = result.error ?? "";
    console.warn("[email] Resend failed, trying Mailjet fallback:", resendError);
  }

  if (config.mailjetApiKey && config.mailjetSecretKey) {
    return sendViaMailjet(config, to, subject, html);
  }

  if (!config.resendApiKey && !config.mailjetApiKey) {
    return {
      success: false,
      error: "No email provider configured (set RESEND_API_KEY or Mailjet keys).",
    };
  }

  return { success: false, error: `Resend: ${resendError}` };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#0f172a;padding:24px;text-align:center;">
      <div style="display:inline-block;background:#e2e8f0;color:#0f172a;font-weight:bold;border-radius:8px;padding:6px 14px;font-size:15px;">المرشد</div>
      <h1 style="color:#ffffff;font-size:19px;margin:16px 0 4px 0;">${title}</h1>
    </div>
    <div style="padding:24px;color:#334155;font-size:15px;line-height:1.8;">${bodyHtml}</div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 24px;text-align:center;color:#94a3b8;font-size:12px;">
      رسالة تلقائية من منصة ${DEFAULT_FROM_NAME} — لا تُرسل إلى هذه العناوين.
    </div>
  </div>
</body>
</html>`;
}

function button(label: string, href: string): string {
  return `<div style="text-align:center;margin:24px 0;">
    <a href="${escapeHtml(href)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 32px;border-radius:8px;font-size:15px;">${label}</a>
  </div>
  <p style="font-size:13px;color:#64748b;margin:0 0 8px 0;">إذا لم يعمل الزر، انسخ الرابط التالي والصقه في متصفحك:</p>
  <p style="font-size:12px;color:#334155;word-break:break-all;background:#f1f5f9;padding:10px;border-radius:6px;margin:0;" dir="ltr">${escapeHtml(href)}</p>`;
}

/** One-time verification link sent to a newly registered corporate mailbox. */
export async function sendVerificationEmail(params: {
  to: string;
  displayName: string;
  verifyUrl: string;
}): Promise<EmailSendResult> {
  const { to, displayName, verifyUrl } = params;
  const html = layout(
    "تأكيد بريدك الإلكتروني",
    `<p style="margin:0 0 12px 0;">مرحبًا ${escapeHtml(displayName)}،</p>
     <p style="margin:0 0 12px 0;">تم إنشاء حسابك للاستبيان الداخلي. لتفعيل الحساب وتسجيل الدخول، يرجى تأكيد بريدك الإلكتروني من خلال الرابط أدناه.</p>
     <p style="margin:0;color:#64748b;font-size:13px;">صلاحية الرابط 24 ساعة، ويمكنك طلب رابط جديد إذا انتهت.</p>
     ${button("تأكيد البريد الإلكتروني", verifyUrl)}`
  );

  return sendEmail(
    to,
    "تأكيد البريد الإلكتروني — استبيان بيئة العمل",
    html
  );
}

/** Sent when somebody tries to register an address that is already verified. */
export async function sendAccountExistsEmail(params: {
  to: string;
  displayName?: string | null;
}): Promise<EmailSendResult> {
  const greeting = params.displayName
    ? `مرحبًا ${escapeHtml(params.displayName)}،`
    : "مرحبًا،";

  const html = layout(
    "لديك حساب بالفعل",
    `<p style="margin:0 0 12px 0;">${greeting}</p>
     <p style="margin:0 0 12px 0;">تمت محاولة إنشاء حساب باستخدام بريدك الإلكتروني في منصة استبيان بيئة العمل، لكن لديك حساب فعّال بالفعل.</p>
     <p style="margin:0;">إذا كنت تواجه صعوبة في تسجيل الدخول، تواصل مع إدارة النظام لإعادة تعيين كلمة المرور.</p>`
  );

  return sendEmail(params.to, "حسابك موجود بالفعل — استبيان بيئة العمل", html);
}
