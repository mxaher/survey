"use client";

/**
 * Auth card: sign-in, first-run admin setup, and employee self-registration.
 *
 * Rendered by the admin shell (`/?view=admin`) and by the employee survey
 * (`/?view=employee`) whenever there is no session. Registration is offered
 * only from the employee card (`canRegister`), accepts corporate
 * `@almarshad.com` addresses only, and posts to `/api/auth/login`,
 * `/api/auth/setup`, `/api/auth/register` or `/api/auth/resend-verification`,
 * then reloads so every query re-runs against the new session.
 */
import { useState } from "react";
import { Loader2, LogIn, MailCheck, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_TITLE } from "@/lib/messages";

type View = "login" | "setup" | "register" | "sent";

interface AuthCardProps {
  mode?: "login" | "setup" | "register";
  /** Full-screen centered variant (admin shell), instead of inline. */
  standalone?: boolean;
  /** Offer self-registration from the sign-in form (employee app only). */
  canRegister?: boolean;
  onSuccess?: () => void;
}

interface PostResult {
  ok: boolean;
  error?: string;
  needsVerification?: boolean;
  /** Present on a successful register: true when the account is usable now. */
  verified?: boolean;
}

async function postJson(url: string, body: unknown): Promise<PostResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        error: json?.error ?? "تعذّر إتمام العملية. يرجى المحاولة مجددًا.",
        needsVerification: json?.needsVerification === true,
      };
    }
    return { ok: true, verified: json?.data?.verified === true };
  } catch {
    return { ok: false, error: "تعذّر الاتصال بالخادم. يرجى المحاولة مجددًا." };
  }
}

export function AuthCard({
  mode = "login",
  standalone,
  canRegister = false,
  onSuccess,
}: AuthCardProps) {
  const [view, setView] = useState<View>(mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [sentTo, setSentTo] = useState("");

  async function handleResend(target: string) {
    if (resendState === "sending") return;
    setResendState("sending");
    setError(null);
    const result = await postJson("/api/auth/resend-verification", { email: target });
    if (!result.ok) {
      setResendState("idle");
      setError(result.error ?? null);
      return;
    }
    setResendState("sent");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setInfo(null);
    setSubmitting(true);

    if (view === "register") {
      const result = await postJson("/api/auth/register", { email, displayName, password });
      if (!result.ok) {
        setError(result.error ?? null);
        setSubmitting(false);
        return;
      }
      if (result.verified) {
        // No mail provider configured — the account is usable immediately.
        setInfo("تم إنشاء حسابك بنجاح. يمكنك تسجيل الدخول الآن.");
        setView("login");
        setSubmitting(false);
        return;
      }
      setSentTo(email);
      setResendState("idle");
      setView("sent");
      setSubmitting(false);
      return;
    }

    const result =
      view === "setup"
        ? await postJson("/api/auth/setup", { email, displayName, password })
        : await postJson("/api/auth/login", { email, password });

    if (!result.ok) {
      if (result.needsVerification && email) {
        setInfo(result.error ?? "لم يتم تأكيد بريدك الإلكتروني بعد.");
        setResendState("idle");
      } else {
        setError(result.error ?? null);
      }
      setSubmitting(false);
      return;
    }

    if (onSuccess) {
      onSuccess();
      return;
    }
    window.location.reload();
  }

  function switchTo(next: View) {
    setError(null);
    setInfo(null);
    setResendState("idle");
    setView(next);
  }

  const titles: Record<View, string> = {
    login: "تسجيل الدخول",
    setup: "إعداد حساب المدير",
    register: "إنشاء حساب موظف",
    sent: "تفقّد بريدك الإلكتروني",
  };

  const card = (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-3 text-center">
        <img
          src="/almarshad-logo.png"
          alt="المرشد القابضة"
          className="mx-auto h-12 w-auto max-w-full object-contain"
        />
        <CardTitle className="text-xl flex items-center justify-center gap-2">
          {view === "setup" ? (
            <ShieldCheck className="h-5 w-5" />
          ) : view === "register" ? (
            <UserPlus className="h-5 w-5" />
          ) : view === "sent" ? (
            <MailCheck className="h-5 w-5" />
          ) : (
            <LogIn className="h-5 w-5" />
          )}
          {titles[view]}
        </CardTitle>
        <CardDescription className="leading-relaxed">
          {view === "setup"
            ? "لم يتم إنشاء حساب إداري بعد. أنشئ حساب المدير العام الآن — لن تتاح هذه الخطوة مرة أخرى."
            : view === "register"
              ? `أنشئ حساب موظف جديد ببريد ‎@almarshad.com‎.`
              : view === "sent"
                ? "تم إرسال رسالة تحتوي على رابط التأكيد. اتبع الرابط داخلها ثم عد لتسجيل الدخول."
                : `الدخول إلى ${APP_TITLE} بحسابك المعتمد.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {view === "sent" ? (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 px-3 py-3 text-sm leading-relaxed" dir="ltr">
              {sentTo}
            </div>

            {resendState === "sent" ? (
              <p className="text-sm text-muted-foreground leading-relaxed">
                تم إرسال رابط جديد. تفقّد صندوق الوارد وملف الرسائل غير المرغوب فيها.
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full min-h-[44px] gap-2"
                disabled={resendState === "sending"}
                onClick={() => handleResend(sentTo)}
              >
                {resendState === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                إعادة إرسال رابط التأكيد
              </Button>
            )}

            {error ? (
              <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 leading-relaxed">
                {error}
              </p>
            ) : null}

            <Button
              type="button"
              className="w-full min-h-[44px]"
              onClick={() => switchTo("login")}
            >
              العودة إلى تسجيل الدخول
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {view !== "login" && (
              <div className="space-y-2">
                <Label htmlFor="auth-name">الاسم</Label>
                <Input
                  id="auth-name"
                  dir="rtl"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={view === "setup" ? "اسم المدير" : "الاسم الكامل"}
                  autoComplete="name"
                  required
                  minLength={1}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="auth-email">البريد الإلكتروني</Label>
              <Input
                id="auth-email"
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@almarshad.com"
                autoComplete="username"
                required
              />
              {view === "register" ? (
                <p className="text-xs text-muted-foreground">
                  يجب أن يكون بريدك الوظيفي من ‎@almarshad.com‎.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="auth-password">كلمة المرور</Label>
              <Input
                id="auth-password"
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={view === "login" ? "current-password" : "new-password"}
                required
                minLength={8}
              />
              {view !== "login" ? (
                <p className="text-xs text-muted-foreground">8 أحرف على الأقل.</p>
              ) : null}
            </div>

            {error ? (
              <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 leading-relaxed">
                {error}
              </p>
            ) : null}

            {info ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 space-y-2">
                <p className="text-sm leading-relaxed">{info}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full min-h-[40px] gap-2"
                  disabled={resendState === "sending" || resendState === "sent"}
                  onClick={() => handleResend(email)}
                >
                  {resendState === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {resendState === "sent" ? "تم إرسال رابط جديد" : "إرسال رابط التأكيد مجددًا"}
                </Button>
              </div>
            ) : null}

            <Button type="submit" className="w-full min-h-[44px] gap-2" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {view === "setup"
                ? "إنشاء الحساب والدخول"
                : view === "register"
                  ? "إنشاء الحساب"
                  : "تسجيل الدخول"}
            </Button>

            {view === "login" && canRegister ? (
              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => switchTo("register")}
              >
                ليس لديك حساب؟ إنشاء حساب موظف
              </button>
            ) : null}

            {view === "register" ? (
              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => switchTo("login")}
              >
                لديك حساب بالفعل؟ تسجيل الدخول
              </button>
            ) : null}

            {view === "login" && !canRegister ? (
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                لا تملك حسابًا؟ تواصل مع مدير النظام لإنشاء حساب موظف.
              </p>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  );

  if (!standalone) return card;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      {card}
    </div>
  );
}
