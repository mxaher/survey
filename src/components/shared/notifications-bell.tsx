"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Bell, AlertTriangle, Info, AlertCircle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

type Notification = {
  id: string;
  type: "about_to_close" | "threshold_not_met" | "no_responses" | "draft_not_scheduled";
  severity: "warning" | "info" | "critical";
  campaignId: string;
  campaignTitle: string;
  messageAr: string;
};

type Envelope = { ok: boolean; data: { notifications: Notification[]; count: number } };

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertCircle,
    cls: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    border: "border-rose-200 dark:border-rose-900/50",
    dot: "bg-rose-500",
  },
  warning: {
    icon: AlertTriangle,
    cls: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-900/50",
    dot: "bg-amber-500",
  },
  info: {
    icon: Info,
    cls: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-50 dark:bg-sky-950/30",
    border: "border-sky-200 dark:border-sky-900/50",
    dot: "bg-sky-500",
  },
} as const;

export function NotificationsBell() {
  const router = useRouter();

  const { data, isLoading } = useQuery<Envelope>({
    queryKey: ["admin-notifications"],
    queryFn: () => fetchJson<Envelope>("/api/admin/notifications"),
    staleTime: 60_000, // refresh every minute
  });

  const notifications = data?.data?.notifications ?? [];
  const count = data?.data?.count ?? 0;
  const hasUnread = count > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label="الإشعارات"
        >
          <Bell className="h-4 w-4" />
          {hasUnread && (
            <span
              className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white"
            >
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        sideOffset={8}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">الإشعارات</span>
          </div>
          {count > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {count} جديد
            </Badge>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto scroll-rtl">
          {isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="py-8 text-center">
              <Bell className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">
                لا توجد إشعارات حالياً
              </p>
              <p className="text-xs text-muted-foreground/70">
                جميع الحملات تسير بسلاسة
              </p>
            </div>
          ) : (
            <ul className="py-1">
              {notifications.map((n) => {
                const cfg = SEVERITY_CONFIG[n.severity];
                const Icon = cfg.icon;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        router.push(
                          `/?view=admin&tab=campaigns&sub=detail&id=${encodeURIComponent(n.campaignId)}`
                        );
                      }}
                      className={cn(
                        "flex w-full items-start gap-2.5 px-4 py-2.5 text-start transition-colors hover:bg-accent/50"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full",
                          cfg.bg,
                          cfg.cls
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs leading-relaxed text-foreground">
                          {n.messageAr}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          انقر للعرض
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
