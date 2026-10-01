/**
 * Maps a readiness issue `key` (see `src/lib/readiness.ts`) to the admin
 * UI location that can fix it: which campaign-detail tab to switch to and,
 * when the issue lives in the settings form, which `data-field` anchor to
 * focus inside `CampaignEditorView`.
 *
 * Used by every readiness surface (detail header dialog, editor dialog,
 * campaigns-list dialog, readiness tab) so an "إصلاح" affordance can send
 * the admin straight to the offending control.
 */

export type ReadinessTab = "settings" | "questions" | "executives";

export interface ReadinessTarget {
  tab: ReadinessTab;
  /** `data-field` attribute of the FormItem to focus (settings tab only). */
  field?: string;
}

/** Readiness issue keys that belong to the settings form. */
const SETTINGS_FIELDS: Record<string, string> = {
  title_missing: "titleAr",
  instructions_missing: "instructionsAr",
  no_start_date: "startsAtLocal",
  no_end_date: "endsAtLocal",
  end_before_start: "endsAtLocal",
  invalid_threshold: "minimumReportingThreshold",
  min_gt_max: "minExecutives",
};

export function readinessIssueTarget(key: string): ReadinessTarget {
  const field = SETTINGS_FIELDS[key];
  if (field) return { tab: "settings", field };

  if (
    key === "no_active_executives" ||
    key === "duplicate_executives"
  ) {
    return { tab: "executives" };
  }

  if (
    key === "no_active_questions" ||
    key === "duplicate_questions" ||
    key.startsWith("question_")
  ) {
    return { tab: "questions" };
  }

  // `not_found` and anything unexpected: land on settings.
  return { tab: "settings" };
}

export function readinessIssueTargets(
  issues: { key: string }[]
): ReadinessTarget[] {
  return issues.map((iss) => readinessIssueTarget(iss.key));
}
