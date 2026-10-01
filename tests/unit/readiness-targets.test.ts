import { describe, it, expect } from "bun:test";
import { readinessIssueTarget } from "@/lib/readiness-targets";

describe("readinessIssueTarget", () => {
  it("maps settings-form issues to their field", () => {
    expect(readinessIssueTarget("title_missing")).toEqual({
      tab: "settings",
      field: "titleAr",
    });
    expect(readinessIssueTarget("instructions_missing")).toEqual({
      tab: "settings",
      field: "instructionsAr",
    });
    expect(readinessIssueTarget("no_start_date")).toEqual({
      tab: "settings",
      field: "startsAtLocal",
    });
    expect(readinessIssueTarget("no_end_date")).toEqual({
      tab: "settings",
      field: "endsAtLocal",
    });
    expect(readinessIssueTarget("end_before_start")).toEqual({
      tab: "settings",
      field: "endsAtLocal",
    });
    expect(readinessIssueTarget("invalid_threshold")).toEqual({
      tab: "settings",
      field: "minimumReportingThreshold",
    });
    expect(readinessIssueTarget("min_gt_max")).toEqual({
      tab: "settings",
      field: "minExecutives",
    });
  });

  it("maps assignment issues to their tab without a field", () => {
    expect(readinessIssueTarget("no_active_executives")).toEqual({
      tab: "executives",
    });
    expect(readinessIssueTarget("duplicate_executives")).toEqual({
      tab: "executives",
    });
    expect(readinessIssueTarget("no_active_questions")).toEqual({
      tab: "questions",
    });
    expect(readinessIssueTarget("duplicate_questions")).toEqual({
      tab: "questions",
    });
    expect(readinessIssueTarget("question_Q01_no_active_options")).toEqual({
      tab: "questions",
    });
  });

  it("falls back to settings for unknown keys", () => {
    expect(readinessIssueTarget("not_found")).toEqual({ tab: "settings" });
    expect(readinessIssueTarget("something_new")).toEqual({ tab: "settings" });
  });
});
