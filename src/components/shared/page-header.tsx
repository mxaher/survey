"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page header with title, description, and actions row.
 *
 * Adds:
 *  - Optional eyebrow label above the title (small caps muted text).
 *  - Consistent vertical rhythm (mb-6 by default).
 *  - Actions wrap on mobile.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      <div className="mt-4 h-px bg-gradient-to-l from-border via-border to-transparent" />
    </div>
  );
}
