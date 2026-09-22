"use client";

import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Stat card with:
 *  - tabular-nums for number alignment across cards in a row.
 *  - subtle hover micro-interaction (lift + shadow).
 *  - optional accent color for the icon.
 */
export function StatCard({
  title,
  value,
  icon,
  hint,
  accent = "text-muted-foreground",
  tone = "default",
}: {
  title: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: string;
  /** Icon color class — defaults to muted. Use a tone class for emphasis. */
  accent?: string;
  /** Optional tone for the icon background chip. */
  tone?: "default" | "navy" | "gold" | "emerald" | "amber" | "sky";
}) {
  const toneCls = TONES[tone] ?? TONES.default;
  return (
    <Card
      className={cn(
        "group relative overflow-hidden transition-all duration-200",
        "hover:shadow-md hover:-translate-y-0.5 hover:border-primary/30"
      )}
    >
      {/* subtle top accent line on hover */}
      <span
        className={cn(
          "absolute inset-x-0 top-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity",
          toneCls.bar
        )}
        aria-hidden
      />
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon && (
          <div
            className={cn(
              "grid place-items-center h-9 w-9 rounded-lg transition-colors",
              toneCls.iconBg,
              accent
            )}
          >
            {icon}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div
          className="text-2xl font-bold text-foreground tracking-tight"
          style={{ fontFeatureSettings: '"tnum" 1, "lnum" 1' }}
        >
          {value}
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const TONES: Record<
  "default" | "navy" | "gold" | "emerald" | "amber" | "sky",
  { iconBg: string; bar: string }
> = {
  default: {
    iconBg: "bg-muted/60",
    bar: "bg-primary",
  },
  navy: {
    iconBg: "bg-primary/10 text-primary",
    bar: "bg-primary",
  },
  gold: {
    iconBg: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  emerald: {
    iconBg:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  amber: {
    iconBg:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  sky: {
    iconBg:
      "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
    bar: "bg-sky-500",
  },
};
