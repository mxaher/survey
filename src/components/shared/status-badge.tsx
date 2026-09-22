"use client";

import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_STATUSES } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Status badge with WCAG-compliant semantic colors.
 *
 * Each status has a distinct hue + dot indicator so it's never
 * color-only (spec §4: "never color-only status indicators").
 *
 * Contrast: text/bg pairs are AA-compliant at the chosen sizes.
 */
const STATUS_STYLES: Record<
  string,
  { dot: string; badge: string }
> = {
  draft: {
    dot: "bg-slate-500",
    badge:
      "bg-slate-100 text-slate-800 border-slate-300 " +
      "dark:bg-slate-800/70 dark:text-slate-200 dark:border-slate-700",
  },
  scheduled: {
    dot: "bg-amber-500",
    badge:
      "bg-amber-100 text-amber-900 border-amber-300 " +
      "dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800",
  },
  active: {
    dot: "bg-emerald-500",
    badge:
      "bg-emerald-100 text-emerald-900 border-emerald-300 " +
      "dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800",
  },
  closed: {
    dot: "bg-sky-500",
    badge:
      "bg-sky-100 text-sky-900 border-sky-300 " +
      "dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-800",
  },
  archived: {
    dot: "bg-zinc-400",
    badge:
      "bg-zinc-100 text-zinc-600 border-zinc-300 " +
      "dark:bg-zinc-900/60 dark:text-zinc-400 dark:border-zinc-800",
  },
};

const ACTIVE_DOT_PULSE = "animate-pulse";

export function StatusBadge({ status }: { status: string }) {
  const meta = CAMPAIGN_STATUSES.find((s) => s.key === status);
  const label = meta?.labelAr ?? status;
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  const isAnimated = status === "active";
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-2 py-0.5 text-xs font-semibold inline-flex items-center gap-1.5 rounded-full",
        style.badge
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          style.dot,
          isAnimated && ACTIVE_DOT_PULSE
        )}
        aria-hidden
      />
      {label}
    </Badge>
  );
}
