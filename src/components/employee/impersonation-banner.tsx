"use client";

/**
 * Admin preview (impersonation) chip.
 *
 * Identity is resolved in the background (Cloudflare Access → session), so
 * nobody signs in through this banner. It only renders while an admin is
 * previewing the survey through the Employee Picker: a small "previewing
 * as: …" chip above the survey so the admin always knows which identity is
 * active.
 */
import { useQuery } from "@tanstack/react-query";
import { UserCircle2 } from "lucide-react";
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
  // Only admins can read this endpoint (it is admin-gated server-side), so
  // anonymous visitors simply get `current: null` and see no chip.
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

  // 401 → the "could not verify eligibility" card owns that state; the
  // banner stays out of the way so visitors get one clear action.
  if (unauthorized) return null;

  // Admin preview (impersonation) active → subtle chip so the admin knows
  // which identity they are previewing the survey with.
  if (data?.current) {
    const name = data.current.displayName ?? data.current.externalId;
    return (
      <div className="mx-auto max-w-4xl mb-3 flex items-center justify-between gap-3 rounded-md border border-dashed border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        <div className="flex items-center gap-2">
          <UserCircle2 className="h-4 w-4" />
          <span>معاينة المدير — الهوية الحالية:</span>
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
