/**
 * Shared helpers for audit log display — used by both the audit view
 * (full table) and the dashboard's "recent activity" widget.
 *
 * Kept here (not in the audit-view component) so the dashboard can import
 * without pulling the entire audit-view client bundle.
 */

export const ENTITY_LABELS_AR: Record<string, string> = {
  campaign: "حملة",
  question: "سؤال",
  executive: "مسؤول",
  system_setting: "إعداد",
  admin_user: "مستخدم إدارة",
  campaign_question: "سؤال حملة",
  campaign_executive: "مسؤول حملة",
};

/** Map action verbs to semantic tones for the action badge. */
export function actionTone(action: string): {
  cls: string;
} {
  if (action.endsWith(".create") || action.endsWith(".assign"))
    return {
      cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    };
  if (action.endsWith(".activate") || action.endsWith(".schedule"))
    return {
      cls: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
    };
  if (
    action.endsWith(".deactivate") ||
    action.endsWith(".close") ||
    action.endsWith(".archive")
  )
    return {
      cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    };
  if (action.endsWith(".delete") || action.endsWith(".remove"))
    return {
      cls: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
    };
  if (action.endsWith(".reorder") || action.endsWith(".copy"))
    return {
      cls: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200",
    };
  if (action.endsWith(".export"))
    return {
      cls: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
    };
  if (action.endsWith(".update") || action.endsWith(".edit"))
    return { cls: "bg-primary/10 text-primary" };
  return { cls: "bg-secondary text-secondary-foreground" };
}
