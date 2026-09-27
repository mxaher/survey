"use client";

/**
 * Dev-mode impersonation banner (Task 3-a, spec §6).
 *
 * Two states:
 *   1. **Prompt** — when an employee endpoint returns 401, the banner explains
 *      that the system is running in dev mode and the user must pick an
 *      employee identity via the admin shell. Provides a CTA link to
 *      `/?view=admin`. In production this slot would render the real SSO
 *      login / OIDC redirect prompt instead.
 *   2. **Active** — when an employee identity is currently impersonated, the
 *      banner shows a subtle "dev mode as: <name>" chip so the user knows
 *      which identity is active.
 *
 * The banner renders in every environment (see note in the component): the
 * identity layer is dev-mode here, so gating it on NODE_ENV only hid the
 * prompt and left visitors stuck on the skeleton.
 *
 * Privacy: the only identity info shown is the impersonated employee's
 * display name (never the HMAC, never the underlying `externalId` verbatim —
 * though the dev roster's `externalId` IS a fake local address like
 * `dev-emp-001@almrshd.local`, so displaying it as a hint is acceptable).
 */
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, UserCircle2, ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ImpersonationData {
  current: {
    externalId: string;
    displayName?: string;
    department?: string;
    role?: string;
    isActive: boolean;
  } | null;
}

export function ImpersonationBanner({ unauthorized }: { unauthorized: boolean }) {
  // Rendered in every environment: this deployment has no SSO, so the dev-mode
  // picker is the only identity source. Without the banner an unauthenticated
  // visitor would sit on the loading skeleton forever.
  const { data } = useQuery<ImpersonationData>({
    queryKey: ["dev-impersonate"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dev-impersonate", {
        cache: "no-store",
      });
      if (!res.ok) return { current: null };
      const json = await res.json();
      return { current: json?.data?.current ?? null };
    },
    staleTime: 30_000,
  });

  // 401 + no impersonation → show the prompt to pick an employee identity.
  if (unauthorized && !data?.current) {
    return (
      <Alert
        variant="destructive"
        className="mx-auto max-w-4xl mb-4"
      >
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>وضع التطوير مفعّل</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <p className="leading-relaxed">
            أنت تستخدم النظام في وضع التطوير. يجب اختيار هوية موظف من لوحة
            الإدارة للتجربة كموظف قبل المشاركة في الاستبيان.
          </p>
          <div>
            <Button asChild size="sm" className="gap-2">
              <a href="/?view=admin">
                <ArrowLeft className="h-4 w-4" />
                الانتقال إلى لوحة الإدارة لاختيار هوية موظف
              </a>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  // Active impersonation → show a subtle "dev mode as: …" chip.
  if (data?.current) {
    const name = data.current.displayName ?? data.current.externalId;
    return (
      <div className="mx-auto max-w-4xl mb-3 flex items-center justify-between gap-3 rounded-md border border-dashed border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        <div className="flex items-center gap-2">
          <UserCircle2 className="h-4 w-4" />
          <span>وضع التطوير — الهوية الحالية:</span>
          <Badge variant="secondary" className="font-mono">
            {name}
          </Badge>
          {data.current.department ? (
            <span className="text-muted-foreground">
              ({data.current.department})
            </span>
          ) : null}
        </div>
        <a
          href="/?view=admin"
          className="text-amber-900 dark:text-amber-200 underline-offset-4 hover:underline"
        >
          تغيير الهوية
        </a>
      </div>
    );
  }

  return null;
}
