"use client";

import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_STATUSES } from "@/lib/constants";

const statusColor: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  scheduled: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  active: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  closed: "bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200",
  archived: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300",
};

export function StatusBadge({ status }: { status: string }) {
  const meta = CAMPAIGN_STATUSES.find((s) => s.key === status);
  const label = meta?.labelAr ?? status;
  const cls = statusColor[status] ?? "";
  return (
    <Badge
      variant="outline"
      className={`px-2 py-0.5 text-xs font-medium border-0 ${cls}`}
    >
      {label}
    </Badge>
  );
}
