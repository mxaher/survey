"use client";

/**
 * Auth card: sign-in and first-run admin setup.
 *
 * Rendered only by the admin shell (`/?view=admin`). The employee survey flow
 * never shows a username/password form — eligibility there is verified in the
 * background by the corporate identity layer (see `src/lib/identity.ts`).
 *
 * Self-registration was removed: employees are provisioned through the
 * corporate directory, not by creating accounts in the app.
 *
 * Posts to `/api/auth/login` or `/api/auth/setup`, then reloads so every
 * query re-runs against the new session.
 */
import { useState } from "react";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_TITLE } from "@/lib/messages";

type View = "login" | "setup";

interface AuthCardProps {
  mode?: View;
  /** Full-screen centered variant (admin shell), instead of inline. */
  standalone?: boolean;
  onSuccess?: () => void;
}

interface PostResult {
  ok: boolean;
  error?: string;
  info?: string;
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
        info: json?.needsVerification === true ? json?.error : undefined,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "تعذّر الاتصال بالخادم. يرجى المحاولة مجددًا." };
  }
}

export function AuthCard({
  mode = "login",
  standalone,
  onSuccess,
}: AuthCardProps) {
  const [view, setView] = useState<View>(mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setInfo(null);
    setSubmitting(true);

    const result =
      view === "setup"
        ? await postJson("/api/auth/setup", { email, displayName, password })
        : await postJson("/api/auth/login", { email, password });

    if (!result.ok) {
      if (result.info) {
        setInfo(result.info);
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

  const titles: Record<View, string> = {
    login: "تسجيل الدخول",
    setup: "إعداد حساب المدير",
  };

  const card = (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto h-12 w-12 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">
          الم
        </div>
        <CardTitle className="text-xl flex items-center justify-center gap-2">
          {view === "setup" ? (
            <ShieldCheck className="h-5 w-5" />
          ) : (
            <LogIn className="h-5 w-5" />
          )}
          {titles[view]}
        </CardTitle>
        <CardDescription className="leading-relaxed">
          {view === "setup"
            ? "لم يتم إنشاء حساب إداري بعد. أنشئ حساب المدير العام الآن — لن تتاح هذه الخطوة مرة أخرى."
            : `الدخول إلى ${APP_TITLE} بحسابك المعتمد.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {view !== "login" && (
            <div className="space-y-2">
              <Label htmlFor="auth-name">الاسم</Label>
              <Input
                id="auth-name"
                dir="rtl"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="اسم المدير"
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
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3">
              <p className="text-sm leading-relaxed">{info}</p>
            </div>
          ) : null}

          <Button type="submit" className="w-full min-h-[44px] gap-2" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {view === "setup" ? "إنشاء الحساب والدخول" : "تسجيل الدخول"}
          </Button>
        </form>
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
