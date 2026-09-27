import { describe, it, expect } from "bun:test";
import {
  computeScoredMetrics,
  combineMetrics,
  classifyCategory,
  classifyAnswer,
  interpretationBandAr,
  rankStrengths,
  rankDevelopmentAreas,
  rankDevelopmentPriorities,
  reportGate,
  perQuestionSuppressed,
  BELOW_THRESHOLD_MESSAGE_AR,
  THRESHOLD_NOT_MET_REASON,
  trendLabelAr,
  validateSelections,
  buildSelectionReport,
  buildDistribution,
  optionSentiment,
  type AnswerRow,
  type RankedCategory,
} from "@/lib/scoring";

/** Spec §8 reference fixture: 8 always / 6 often / 3 sometimes / 2 rarely /
 *  1 never / 2 not_applicable across 22 submitted answers. */
function referenceRows(): AnswerRow[] {
  const rows: AnswerRow[] = [];
  const push = (value: string, score: number | null, times: number) => {
    for (let i = 0; i < times; i++) rows.push({ selectedValue: value, selectedScore: score });
  };
  push("always", 5, 8);
  push("often", 4, 6);
  push("sometimes", 3, 3);
  push("rarely", 2, 2);
  push("never", 1, 1);
  push("not_applicable", null, 2);
  return rows;
}

describe("scoring formulas (spec §5, §8)", () => {
  it("reproduces the reference fixture exactly", () => {
    const m = computeScoredMetrics(referenceRows());
    expect(m.totalSubmittedAnswers).toBe(22);
    expect(m.validScoredAnswers).toBe(20);
    expect(m.totalScore).toBe(78);
    expect(m.averageScore).toBe(3.9);
    expect(m.indexScore).toBe(78);
    expect(m.favorableRate).toBe(70);
    expect(m.neutralRate).toBe(15);
    expect(m.unfavorableRate).toBe(15);
    expect(m.notApplicableCount).toBe(2);
    expect(m.notApplicableRate).toBe(9.09);
  });

  it("returns null (never 0) when there is no valid data", () => {
    const m = computeScoredMetrics([]);
    expect(m.averageScore).toBeNull();
    expect(m.indexScore).toBeNull();
    expect(m.favorableRate).toBeNull();
    expect(m.neutralRate).toBeNull();
    expect(m.unfavorableRate).toBeNull();
    expect(m.notApplicableRate).toBeNull();

    const allNA = computeScoredMetrics([
      { selectedValue: "not_applicable", selectedScore: null },
      { selectedValue: "not_applicable", selectedScore: null },
    ]);
    expect(allNA.averageScore).toBeNull();
    expect(allNA.notApplicableRate).toBe(100);
    expect(allNA.favorableRate).toBeNull();
  });

  it("excludes null scores from valid counts", () => {
    const m = computeScoredMetrics([
      { selectedValue: "sometimes", selectedScore: 3 },
      { selectedValue: "sometimes", selectedScore: null },
    ]);
    expect(m.validScoredAnswers).toBe(1);
    expect(m.notApplicableCount).toBe(1);
    expect(m.averageScore).toBe(3);
  });

  it("combines per-question metrics into a category rollup", () => {
    const combined = combineMetrics([
      computeScoredMetrics(referenceRows()),
      computeScoredMetrics([
        { selectedValue: "always", selectedScore: 5 },
        { selectedValue: "always", selectedScore: 5 },
      ]),
    ]);
    expect(combined.totalSubmittedAnswers).toBe(24);
    expect(combined.validScoredAnswers).toBe(22);
    expect(combined.totalScore).toBe(88);
    expect(combined.averageScore).toBe(4);
    expect(combined.indexScore).toBe(80);
    expect(combined.favorableRate).toBe(72.73);
    expect(combined.notApplicableRate).toBe(8.33);
  });

  it("prefers database flags over the value fallback", () => {
    const classified = classifyAnswer("custom_value", 4, {
      isFavorable: true,
      isUnfavorable: false,
      isExcludedFromCalculation: false,
    });
    expect(classified.valid).toBe(true);
    expect(classified.favorable).toBe(true);

    const excluded = classifyAnswer("custom_value", null, {
      isExcludedFromCalculation: true,
    });
    expect(excluded.valid).toBe(false);
    expect(excluded.excluded).toBe(true);
  });

  it("derives option sentiment for the standard scales", () => {
    expect(optionSentiment("always", 5, "scale")).toEqual({
      isFavorable: true,
      isUnfavorable: false,
      isExcludedFromCalculation: false,
    });
    expect(optionSentiment("not_applicable", null, "scale")).toEqual({
      isFavorable: false,
      isUnfavorable: false,
      isExcludedFromCalculation: true,
    });
    expect(optionSentiment("neutral", 3, "scale")).toEqual({
      isFavorable: false,
      isUnfavorable: false,
      isExcludedFromCalculation: false,
    });
    expect(optionSentiment("some_option", null, "multi_choice")).toEqual({
      isFavorable: false,
      isUnfavorable: false,
      isExcludedFromCalculation: false,
    });
  });
});

describe("distribution percentages", () => {
  const options = [
    { value: "always", labelAr: "دائماً" },
    { value: "often", labelAr: "غالباً" },
    { value: "sometimes", labelAr: "أحياناً" },
    { value: "rarely", labelAr: "نادراً" },
    { value: "never", labelAr: "أبداً" },
    { value: "not_applicable", labelAr: "لا ينطبق" },
  ];

  it("uses valid answers as denominator and submitted answers for NA", () => {
    const rows = referenceRows();
    const metrics = computeScoredMetrics(rows);
    const dist = buildDistribution(options, rows, metrics);
    expect(dist.always.percentage).toBe(40); // 8 / 20
    expect(dist.often.percentage).toBe(30); // 6 / 20
    expect(dist.not_applicable.percentage).toBe(9.09); // 2 / 22
    expect(dist.never.count).toBe(1);
  });

  it("zeroes the distribution when the question is suppressed", () => {
    const rows = referenceRows();
    const metrics = computeScoredMetrics(rows);
    const dist = buildDistribution(options, rows, metrics, true);
    expect(dist.always.count).toBe(0);
    expect(dist.always.percentage).toBe(0);
    expect(dist.not_applicable.percentage).toBe(0);
  });
});

describe("category classification (spec §8)", () => {
  it("flags strengths only at avg >= 4.00 AND favourable >= 75%", () => {
    expect(classifyCategory({ averageScore: 4, favorableRate: 75, unfavorableRate: 0 })).toEqual({
      strength: true,
      development: false,
      priority: false,
    });
    expect(classifyCategory({ averageScore: 4, favorableRate: 74.99, unfavorableRate: 0 }).strength).toBe(false);
    expect(classifyCategory({ averageScore: 3.99, favorableRate: 90, unfavorableRate: 0 }).strength).toBe(false);
  });

  it("flags development areas at avg < 3.50 OR unfavourable >= 20%", () => {
    expect(classifyCategory({ averageScore: 3.49, favorableRate: 50, unfavorableRate: 10 }).development).toBe(true);
    expect(classifyCategory({ averageScore: 3.6, favorableRate: 50, unfavorableRate: 20 }).development).toBe(true);
    expect(classifyCategory({ averageScore: 4, favorableRate: 80, unfavorableRate: 19.9 }).development).toBe(false);
  });

  it("flags high-priority development at avg < 3.00 OR unfavourable >= 30%", () => {
    expect(classifyCategory({ averageScore: 2.99, favorableRate: 30, unfavorableRate: 29 }).priority).toBe(true);
    expect(classifyCategory({ averageScore: 3.5, favorableRate: 40, unfavorableRate: 30 }).priority).toBe(true);
    expect(classifyCategory({ averageScore: 3.5, favorableRate: 40, unfavorableRate: 29.9 }).priority).toBe(false);
  });

  it("never classifies a category with no valid answers", () => {
    expect(
      classifyCategory({ averageScore: null, favorableRate: null, unfavorableRate: null })
    ).toEqual({ strength: false, development: false, priority: false });
  });

  it("ranks and caps the three report lists", () => {
    const categories: RankedCategory[] = [
      { categoryCode: "a", categoryAr: "أ", averageScore: 4.6, indexScore: 92, favorableRate: 90, neutralRate: 8, unfavorableRate: 2, notApplicableRate: 3, questionCount: 2 },
      { categoryCode: "b", categoryAr: "ب", averageScore: 4.1, indexScore: 82, favorableRate: 78, neutralRate: 15, unfavorableRate: 7, notApplicableRate: 4, questionCount: 2 },
      { categoryCode: "c", categoryAr: "ج", averageScore: 4.0, indexScore: 80, favorableRate: 75, neutralRate: 20, unfavorableRate: 5, notApplicableRate: 5, questionCount: 2 },
      { categoryCode: "d", categoryAr: "د", averageScore: 3.9, indexScore: 78, favorableRate: 70, neutralRate: 15, unfavorableRate: 15, notApplicableRate: 5, questionCount: 2 },
      { categoryCode: "e", categoryAr: "هـ", averageScore: 2.5, indexScore: 50, favorableRate: 20, neutralRate: 30, unfavorableRate: 50, notApplicableRate: 5, questionCount: 2 },
      { categoryCode: "f", categoryAr: "و", averageScore: 3.2, indexScore: 64, favorableRate: 40, neutralRate: 35, unfavorableRate: 25, notApplicableRate: 5, questionCount: 2 },
      { categoryCode: "g", categoryAr: "ز", averageScore: 3.4, indexScore: 68, favorableRate: 45, neutralRate: 35, unfavorableRate: 20, notApplicableRate: 5, questionCount: 2 },
      { categoryCode: "h", categoryAr: "ح", averageScore: 2.8, indexScore: 56, favorableRate: 25, neutralRate: 30, unfavorableRate: 45, notApplicableRate: 5, questionCount: 2 },
    ];

    const strengths = rankStrengths(categories);
    expect(strengths.length).toBe(3);
    expect(strengths.map((c) => c.categoryCode)).toEqual(["a", "b", "c"]);

    const priorities = rankDevelopmentPriorities(categories);
    expect(priorities.map((c) => c.categoryCode)).toEqual(["e", "h"]);

    const areas = rankDevelopmentAreas(categories);
    expect(areas.length).toBe(3);
    expect(areas[0].categoryCode).toBe("e");
  });

  it("maps average scores to the Arabic interpretation bands", () => {
    expect(interpretationBandAr(4.5)).toBe("مرتفع");
    expect(interpretationBandAr(4.49)).toBe("فوق المتوسط");
    expect(interpretationBandAr(4.0)).toBe("فوق المتوسط");
    expect(interpretationBandAr(3.5)).toBe("متوسط");
    expect(interpretationBandAr(3.0)).toBe("منخفض");
    expect(interpretationBandAr(2.9)).toBe("منخفض جداً");
    expect(interpretationBandAr(null)).toBeNull();
  });
});

describe("privacy threshold gate (spec §8)", () => {
  it("blocks reports below the campaign threshold with the mandated copy", () => {
    const gate = reportGate(6, 7);
    expect(gate.reportAvailable).toBe(false);
    expect(gate.reason).toBe(THRESHOLD_NOT_MET_REASON);
    expect(gate.reason).toBe("minimum_threshold_not_met");
    expect(gate.messageAr).toBe(
      "لا يمكن عرض نتائج هذه المجموعة حالياً حفاظاً على سرية المشاركين."
    );
    expect(gate.messageAr).toBe(BELOW_THRESHOLD_MESSAGE_AR);
    expect(gate.threshold).toBe(7);
    expect(gate.respondentCount).toBe(6);
  });

  it("allows reports at or above the threshold", () => {
    expect(reportGate(7, 7).reportAvailable).toBe(true);
    expect(reportGate(8, 7).reportAvailable).toBe(true);
  });

  it("falls back to the default threshold of 7", () => {
    expect(reportGate(6, null).reportAvailable).toBe(false);
    expect(reportGate(6, undefined).threshold).toBe(7);
    expect(reportGate(7, null).reportAvailable).toBe(true);
    expect(reportGate(6, 0).threshold).toBe(7);
  });

  it("applies the same rule per question", () => {
    expect(perQuestionSuppressed(6, 7)).toBe(true);
    expect(perQuestionSuppressed(7, 7)).toBe(false);
    expect(perQuestionSuppressed(6, null)).toBe(true);
  });
});

describe("trend labels (spec §10)", () => {
  it("uses a 0.20 score delta", () => {
    expect(trendLabelAr(0.21)).toBe("تحسن");
    expect(trendLabelAr(-0.21)).toBe("تراجع");
    expect(trendLabelAr(0.2)).toBe("مستقر");
    expect(trendLabelAr(-0.2)).toBe("مستقر");
    expect(trendLabelAr(0)).toBe("مستقر");
    expect(trendLabelAr(null)).toBeNull();
  });
});

describe("future selection reporting (spec §7)", () => {
  const options = [
    { value: "clarity_communication", labelAr: "وضوح القرارات", displayOrder: 1 },
    { value: "fairness", labelAr: "العدالة", displayOrder: 2 },
    { value: "recognition", labelAr: "التقدير", displayOrder: 3 },
    { value: "growth", labelAr: "التطور", displayOrder: 4 },
  ];

  it("computes selection rate over unique respondents and ranks", () => {
    const counts = new Map([
      ["clarity_communication", 4],
      ["fairness", 3],
      ["recognition", 3],
      ["growth", 0],
    ]);
    const report = buildSelectionReport(options, counts, 10);
    expect(report[0].selectionRate).toBe(40); // 4 / 10 respondents
    expect(report.find((o) => o.value === "clarity_communication")!.rank).toBe(1);
    expect(report.find((o) => o.value === "fairness")!.rank).toBe(2);
    expect(report.find((o) => o.value === "recognition")!.rank).toBe(3);
    expect(report.find((o) => o.value === "growth")!.rank).toBe(4);
    expect(report.find((o) => o.value === "growth")!.selectionRate).toBe(0);
  });

  it("does not use response totals as the denominator", () => {
    // 12 selections made by 5 respondents → rate is over 5, not 12.
    const counts = new Map([["clarity_communication", 4]]);
    const report = buildSelectionReport(options, counts, 5);
    expect(report[0].selectionRate).toBe(80);
  });

  it("zeroes everything when suppressed", () => {
    const counts = new Map([["clarity_communication", 4]]);
    const report = buildSelectionReport(options, counts, 5, true);
    expect(report[0].selectionCount).toBe(0);
    expect(report[0].selectionRate).toBe(0);
  });
});

describe("server-side selection validation (spec §9)", () => {
  const allowed = ["a", "b", "c", "d", "e"];

  it("rejects more than maxSelections choices", () => {
    const result = validateSelections({
      questionType: "multi_choice",
      maxSelections: 3,
      selectedValues: ["a", "b", "c", "d"],
      allowedValues: allowed,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("too_many");
    expect(result.errorAr).toBe(
      "لا يمكن اختيار أكثر من 3 خيارات. يرجى اختيار ما يصل إلى 3 خيارات فقط."
    );
  });

  it("accepts up to maxSelections choices", () => {
    expect(
      validateSelections({
        questionType: "multi_choice",
        maxSelections: 3,
        selectedValues: ["a", "b", "c"],
        allowedValues: allowed,
      }).ok
    ).toBe(true);
  });

  it("rejects duplicates, unknown values and empty required answers", () => {
    expect(
      validateSelections({
        questionType: "multi_choice",
        maxSelections: 3,
        selectedValues: ["a", "a"],
        allowedValues: allowed,
      }).code
    ).toBe("duplicates");

    expect(
      validateSelections({
        questionType: "multi_choice",
        maxSelections: 3,
        selectedValues: ["zzz"],
        allowedValues: allowed,
      }).code
    ).toBe("unknown");

    expect(
      validateSelections({
        questionType: "multi_choice",
        maxSelections: 3,
        selectedValues: [],
        allowedValues: allowed,
      }).code
    ).toBe("empty");

    expect(
      validateSelections({
        questionType: "multi_choice",
        maxSelections: 3,
        selectedValues: [],
        allowedValues: allowed,
        isRequired: false,
      }).ok
    ).toBe(true);
  });

  it("requires exactly one answer for single-choice questions", () => {
    expect(
      validateSelections({
        questionType: "single_choice",
        maxSelections: 1,
        selectedValues: ["a"],
        allowedValues: allowed,
      }).ok
    ).toBe(true);
    expect(
      validateSelections({
        questionType: "single_choice",
        maxSelections: 1,
        selectedValues: ["a", "b"],
        allowedValues: allowed,
      }).code
    ).toBe("wrong_count");
  });
});
