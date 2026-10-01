import { Wrench, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  readinessIssueTarget,
  type ReadinessTarget,
} from "@/lib/readiness-targets";

export interface ReadinessIssue {
  key: string;
  messageAr: string;
}

interface ReadinessIssueListProps {
  issues: ReadinessIssue[];
  /**
   * `dialog` renders the bordered card list used inside AlertDialogs;
   * `alert` renders the compact list used inside the readiness Alert.
   */
  variant: "dialog" | "alert";
  /**
   * When supplied, each issue gets an «إصلاح» button that resolves it.
   * Omit it to keep the list read-only.
   */
  onResolve?: (target: ReadinessTarget) => void;
}

/**
 * The single place every readiness issue list is rendered from, so the
 * four call sites (detail header dialog, editor dialog, campaigns list
 * dialog, detail readiness tab) stay in sync and all gain an «إصلاح»
 * shortcut back to the field that fixes them.
 */
export function ReadinessIssueList({
  issues,
  variant,
  onResolve,
}: ReadinessIssueListProps) {
  if (variant === "alert") {
    return (
      <ul className="mt-2 flex flex-col gap-1">
        {issues.map((iss) => (
          <li key={iss.key} className="flex items-start gap-2">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{iss.messageAr}</span>
            {onResolve && (
              <ResolveButton issue={iss} onResolve={onResolve} variant="link" />
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="max-h-72 overflow-y-auto space-y-2 scroll-rtl pe-1">
      {issues.map((iss) => (
        <li
          key={iss.key}
          className="flex gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm"
        >
          <span className="text-destructive" aria-hidden="true">
            •
          </span>
          <span className="min-w-0 flex-1 text-foreground">
            {iss.messageAr}
          </span>
          {onResolve && (
            <ResolveButton issue={iss} onResolve={onResolve} variant="ghost" />
          )}
        </li>
      ))}
    </ul>
  );
}

function ResolveButton({
  issue,
  onResolve,
  variant,
}: {
  issue: ReadinessIssue;
  onResolve: (target: ReadinessTarget) => void;
  variant: "link" | "ghost";
}) {
  const isLink = variant === "link";
  return (
    <Button
      type="button"
      variant={variant}
      className={
        isLink
          ? "h-auto shrink-0 self-start p-0 text-xs"
          : "shrink-0 gap-1 self-start text-primary hover:text-primary"
      }
      aria-label={`إصلاح: ${issue.messageAr}`}
      onClick={() => onResolve(readinessIssueTarget(issue.key))}
    >
      <Wrench className={isLink ? "h-3 w-3" : "h-3.5 w-3.5"} />
      إصلاح
    </Button>
  );
}
