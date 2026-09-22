"use client";

import { ReactNode } from "react";

/**
 * Empty state with a soft icon chip, title, description, and optional action.
 *
 * Visual polish (round 4):
 *  - Larger icon in a rounded chip with subtle bg.
 *  - Title is larger + bolder.
 *  - Description is muted but readable.
 *  - Action sits below with consistent spacing.
 *  - Subtle fade-in entrance animation via CSS keyframes.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center animate-in fade-in-50 duration-300"
    >
      {icon && (
        <div className="grid place-items-center h-16 w-16 rounded-2xl bg-muted/60 text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-lg font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
