"use client";

/**
 * Email + password sign-in card (and first-run admin setup form).
 *
 * Ported from the fifa2026-vercel login flow: posts to `/api/auth/login`
 * (or `/api/auth/setup` when the platform has no admin credential yet),
 * then reloads so every query re-runs against the new session.
 */
import { useState } from "react";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_TITLE } from "@/lib/messages";

interface AuthCardProps {
  mode?: "login" | "setup";
  /** Full-screen centered variant (admin shell), instead of inline. */
  standalone?: boolean;
  onSuccess?: () => void;
}

async function postJson(
  url: string,
  body: unknown
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error ?? "تعذّر إتمام العملية. يرجى المحاولة مجددًا." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "تعذّر الاتصال بالخادم. يرجى المحاولة مجددًا." };
  }
}

export function AuthCard({ mode = "login", standalone, onSuccess }: AuthCardProps) {
  const isSetup = mode === "setup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    const result = isSetup
      ? await postJson("/api/auth/setup", { email, displayName, password })
      : await postJson("/api/auth/login", { email, password });

    if (!result.ok) {
      setError(result.error ?? null);
      setSubmitting(false);
      return;
    }

    if (onSuccess) {
      onSuccess();
      return;
    }
    window.location.reload();
  }

  const card = (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto h-12 w-12 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">
          الم
        </div>
        <CardTitle className="text-xl flex items-center justify-center gap-2">
          {isSetup ? <ShieldCheck className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
          {isSetup ? "إعداد حساب المدير" : "تسجيل الدخول"}
        </CardTitle>
        <CardDescription className="leading-relaxed">
          {isSetup
            ? "لم يتم إنشاء حساب إداري بعد. أنشئ حساب المدير العام الآن — لن تتاح هذه الخطوة مرة أخرى."
            : `الدخول إلى ${APP_TITLE} بحسابك المعتمد.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {isSetup && (
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
              autoComplete={isSetup ? "new-password" : "current-password"}
              required
              minLength={8}
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 leading-relaxed">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full min-h-[44px] gap-2" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSetup ? "إنشاء الحساب والدخول" : "تسجيل الدخول"}
          </Button>

          {!isSetup ? (
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              لا تملك حسابًا؟ تواصل مع مدير النظام لإنشاء حساب موظف.
            </p>
          ) : null}
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
