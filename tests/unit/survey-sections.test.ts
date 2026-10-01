import { describe, it, expect } from "bun:test";
import { envSectionEnabled, futureSectionEnabled } from "@/lib/survey-sections";

const base = {
  enableEnvironmentSurvey: true,
  enableFutureSurvey: true,
  environmentQuestions: [{}],
  futureQuestions: [{}],
};

describe("envSectionEnabled", () => {
  it("is enabled when toggled on with at least one question", () => {
    expect(envSectionEnabled(base)).toBe(true);
  });

  it("accepts the 0/1 integers returned by D1", () => {
    expect(envSectionEnabled({ ...base, enableEnvironmentSurvey: 1 })).toBe(true);
    expect(envSectionEnabled({ ...base, enableEnvironmentSurvey: 0 })).toBe(false);
  });

  it("is disabled when the toggle is off", () => {
    expect(envSectionEnabled({ ...base, enableEnvironmentSurvey: false })).toBe(false);
  });

  it("is disabled when there are no questions", () => {
    expect(envSectionEnabled({ ...base, environmentQuestions: [] })).toBe(false);
    expect(envSectionEnabled({ ...base, environmentQuestions: null })).toBe(false);
    expect(envSectionEnabled({ ...base, environmentQuestions: undefined })).toBe(false);
  });
});

describe("futureSectionEnabled", () => {
  it("is enabled when toggled on with at least one question", () => {
    expect(futureSectionEnabled(base)).toBe(true);
  });

  it("is disabled when the toggle is off", () => {
    expect(futureSectionEnabled({ ...base, enableFutureSurvey: 0 })).toBe(false);
  });

  it("is disabled when there are no questions", () => {
    expect(futureSectionEnabled({ ...base, futureQuestions: [] })).toBe(false);
  });
});
