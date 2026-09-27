/**
 * Scoring engine (spec §5, §8, §10) — pure functions only.
 *
 * Everything a report needs to turn raw `Response` rows into scores is
 * computed here, server-side:
 *
 *   • sentiment classification (favourable / neutral / unfavorable /
 *     excluded) driven by the option flags stored in the database, with a
 *     value-based fallback for rows written before those flags existed;
 *   • averages, index scores and distribution rates;
 *   • category classification (strengths / development areas / priorities);
 *   • the minimum-reporting-threshold privacy gate;
 *   • future-survey selection rates;
 *   • server-side validation of multi/single choice selections.
 *
 * No framework access — the module is shared by the report routes, the
 * export builder and the test suite.
 */

import { MESSAGES } from "@/lib/messages";

/** Percentages and scores are reported with two decimals. */
export function round2(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/** `numerator / denominator * 100`, or null when the denominator is 0. */
export function percent(
  numerator: number,
  denominator: number
): number | null {
  if (!denominator) return null;
  return round2((numerator / denominator) * 100);
}

// ---------------------------------------------------------------------------
// Thresholds & standard copy
// ---------------------------------------------------------------------------

/** Default minimum reporting threshold (spec: 7). */
export const DEFAULT_REPORTING_THRESHOLD = 7;

/** Exact privacy copy shown when a report is below threshold (spec §8).
 *  Single source of truth: `MESSAGES.belowThreshold`. */
export const BELOW_THRESHOLD_MESSAGE_AR = MESSAGES.belowThreshold;

export const THRESHOLD_NOT_MET_REASON = "minimum_threshold_not_met" as const;

/** Explanation attached to multi-select priority questions (spec §7). */
export const FUTURE_SELECTION_NOTE_AR =
  "يمكن لكل مشارك اختيار ما يصل إلى ثلاث أولويات، لذلك قد يتجاوز مجموع النسب 100٪.";

/** Trend labels + the delta that counts as a real change (spec §10). */
export const TREND_DELTA_THRESHOLD = 0.2;
export const TREND_LABELS = {
  improved: "تحسن",
  declined: "تراجع",
  stable: "مستقر",
} as const;

/** Classification labels (spec §8). */
export const CLASSIFICATION_LABELS = {
  strength: "نقاط القوة",
  development: "فرص التحسين",
  priority: "أولويات تطويرية مرتفعة",
} as const;

// ---------------------------------------------------------------------------
// Answer classification
// ---------------------------------------------------------------------------

export interface OptionSentiment {
  isFavorable: boolean;
  isUnfavorable: boolean;
  isExcludedFromCalculation: boolean;
}

export interface AnswerRow {
  selectedValue: string | null;
  selectedScore: number | null;
}

const EXCLUDED_VALUE = "not_applicable";
const FALLBACK_FAVORABLE = new Set([
  "always",
  "often",
  "agree_strongly",
  "agree",
]);
const FALLBACK_UNFAVORABLE = new Set([
  "rarely",
  "never",
  "disagree",
  "disagree_strongly",
]);

export interface ClassifiedAnswer {
  /** Valid scored answer: usable for averages and distributions. */
  valid: boolean;
  /** Excluded: `not_applicable` or a null score (never counted as valid). */
  excluded: boolean;
  favorable: boolean;
  unfavorable: boolean;
}

/**
 * Classify one answer. The database flags are authoritative; the value
 * fallback keeps historical rows (written before the flags existed) working.
 */
export function classifyAnswer(
  value: string | null,
  score: number | null,
  sentiment?: Partial<OptionSentiment> | null
): ClassifiedAnswer {
  const hasScore = typeof score === "number" && Number.isFinite(score);
  const excluded =
    sentiment?.isExcludedFromCalculation === true ||
    value === EXCLUDED_VALUE ||
    !hasScore;

  if (excluded) {
    return { valid: false, excluded: true, favorable: false, unfavorable: false };
  }

  const v = value ?? "";
  const favorable =
    sentiment?.isFavorable === true || FALLBACK_FAVORABLE.has(v);
  const unfavorable =
    sentiment?.isUnfavorable === true || FALLBACK_UNFAVORABLE.has(v);

  return { valid: true, excluded: false, favorable, unfavorable };
}

/** DB flags for an option, derived from the stored value (spec §9:
 *  "keep the scoring configuration database-driven"). Used whenever an
 *  administrator creates or edits options so sentiment stays correct. */
export function optionSentiment(
  value: string,
  score: number | null,
  questionType: string
): OptionSentiment {
  const scored = questionType === "scale" || questionType === "yes_no";
  if (!scored) {
    return {
      isFavorable: false,
      isUnfavorable: false,
      isExcludedFromCalculation: false,
    };
  }
  const excluded = value === EXCLUDED_VALUE || score === null;
  return {
    isFavorable: !excluded && FALLBACK_FAVORABLE.has(value),
    isUnfavorable: !excluded && FALLBACK_UNFAVORABLE.has(value),
    isExcludedFromCalculation: excluded,
  };
}

// ---------------------------------------------------------------------------
// Scored metrics
// ---------------------------------------------------------------------------

export interface ScoredMetrics {
  totalSubmittedAnswers: number;
  validScoredAnswers: number;
  notApplicableCount: number;
  /** % of submitted answers that were excluded. */
  notApplicableRate: number | null;
  totalScore: number;
  averageScore: number | null;
  /** average / 5 * 100 */
  indexScore: number | null;
  favorableCount: number;
  favorableRate: number | null;
  neutralCount: number;
  neutralRate: number | null;
  unfavorableCount: number;
  unfavorableRate: number | null;
}

export function emptyMetrics(): ScoredMetrics {
  return {
    totalSubmittedAnswers: 0,
    validScoredAnswers: 0,
    notApplicableCount: 0,
    notApplicableRate: null,
    totalScore: 0,
    averageScore: null,
    indexScore: null,
    favorableCount: 0,
    favorableRate: null,
    neutralCount: 0,
    neutralRate: null,
    unfavorableCount: 0,
    unfavorableRate: null,
  };
}

/**
 * Aggregate scored answers (spec §5):
 *
 *   average        = total_score / valid_scored_answers
 *   index          = average / 5 * 100
 *   favourable     = (always + often) / valid * 100
 *   neutral        = sometimes / valid * 100
 *   unfavorable    = (rarely + never) / valid * 100
 *   not_applicable = excluded / submitted * 100
 */
export function computeScoredMetrics(
  rows: readonly AnswerRow[],
  sentimentByValue?: ReadonlyMap<string, OptionSentiment>
): ScoredMetrics {
  const metrics = emptyMetrics();
  metrics.totalSubmittedAnswers = rows.length;

  let totalScore = 0;
  let favorable = 0;
  let neutral = 0;
  let unfavorable = 0;
  let excluded = 0;

  for (const row of rows) {
    const sentiment = row.selectedValue
      ? sentimentByValue?.get(row.selectedValue)
      : undefined;
    const classified = classifyAnswer(row.selectedValue, row.selectedScore, sentiment);

    if (!classified.valid) {
      excluded++;
      continue;
    }
    metrics.validScoredAnswers++;
    totalScore += row.selectedScore as number;
    if (classified.favorable) favorable++;
    else if (classified.unfavorable) unfavorable++;
    else neutral++;
  }

  metrics.notApplicableCount = excluded;
  metrics.totalScore = totalScore;
  metrics.favorableCount = favorable;
  metrics.neutralCount = neutral;
  metrics.unfavorableCount = unfavorable;

  metrics.averageScore =
    metrics.validScoredAnswers > 0
      ? round2(totalScore / metrics.validScoredAnswers)
      : null;
  metrics.indexScore =
    metrics.averageScore === null ? null : round2((metrics.averageScore / 5) * 100);
  metrics.favorableRate = percent(favorable, metrics.validScoredAnswers);
  metrics.neutralRate = percent(neutral, metrics.validScoredAnswers);
  metrics.unfavorableRate = percent(unfavorable, metrics.validScoredAnswers);
  metrics.notApplicableRate = percent(excluded, metrics.totalSubmittedAnswers);

  return metrics;
}

/** Combine several metrics (e.g. every question of one category). */
export function combineMetrics(list: readonly ScoredMetrics[]): ScoredMetrics {
  const combined = emptyMetrics();
  for (const m of list) {
    combined.totalSubmittedAnswers += m.totalSubmittedAnswers;
    combined.validScoredAnswers += m.validScoredAnswers;
    combined.notApplicableCount += m.notApplicableCount;
    combined.totalScore += m.totalScore;
    combined.favorableCount += m.favorableCount;
    combined.neutralCount += m.neutralCount;
    combined.unfavorableCount += m.unfavorableCount;
  }
  if (combined.validScoredAnswers > 0) {
    combined.averageScore = round2(combined.totalScore / combined.validScoredAnswers);
    combined.indexScore = round2(((combined.averageScore as number) / 5) * 100);
    combined.favorableRate = percent(combined.favorableCount, combined.validScoredAnswers);
    combined.neutralRate = percent(combined.neutralCount, combined.validScoredAnswers);
    combined.unfavorableRate = percent(combined.unfavorableCount, combined.validScoredAnswers);
  }
  combined.notApplicableRate = percent(
    combined.notApplicableCount,
    combined.totalSubmittedAnswers
  );
  return combined;
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

export interface OptionDefinition {
  value: string;
  labelAr: string;
  displayOrder?: number;
  isFavorable?: number | boolean;
  isUnfavorable?: number | boolean;
  isExcludedFromCalculation?: number | boolean;
  score?: number | null;
}

export interface DistributionEntry {
  value: string;
  labelAr: string;
  count: number;
  /** % of valid answers (of submitted answers for the excluded option). */
  percentage: number;
}

/**
 * Option distribution keyed by machine value.
 * Percentages: valid options over `validScoredAnswers`, the excluded option
 * (`not_applicable`) over `totalSubmittedAnswers`.
 */
export function buildDistribution(
  options: readonly OptionDefinition[],
  rows: readonly AnswerRow[],
  metrics: ScoredMetrics,
  suppressed = false
): Record<string, DistributionEntry> {
  const counts = new Map<string, { count: number; labelAr: string }>();
  for (const row of rows) {
    const value = row.selectedValue ?? "";
    const cur = counts.get(value);
    if (cur) cur.count++;
    else counts.set(value, { count: 1, labelAr: value });
  }

  const result: Record<string, DistributionEntry> = {};
  const seen = new Set<string>();

  for (const option of options) {
    seen.add(option.value);
    const count = suppressed ? 0 : (counts.get(option.value)?.count ?? 0);
    const excluded =
      option.isExcludedFromCalculation === true ||
      option.isExcludedFromCalculation === 1 ||
      option.value === EXCLUDED_VALUE;
    const denominator = excluded
      ? metrics.totalSubmittedAnswers
      : metrics.validScoredAnswers;
    result[option.value] = {
      value: option.value,
      labelAr: option.labelAr,
      count,
      percentage: suppressed ? 0 : (percent(count, denominator) ?? 0),
    };
  }

  for (const [value, bucket] of counts) {
    if (seen.has(value)) continue;
    result[value] = {
      value,
      labelAr: bucket.labelAr,
      count: suppressed ? 0 : bucket.count,
      percentage: suppressed ? 0 : (percent(bucket.count, metrics.validScoredAnswers) ?? 0),
    };
  }

  return result;
}

/** Legacy array form consumed by the existing report views. */
export function buildDistributionList(
  options: readonly OptionDefinition[],
  rows: readonly AnswerRow[],
  suppressed = false
): Array<{ value: string; labelAr: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row.selectedValue ?? "";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const list = options.map((option) => ({
    value: option.value,
    labelAr: option.labelAr,
    count: suppressed ? 0 : (counts.get(option.value) ?? 0),
  }));
  const seen = new Set(options.map((o) => o.value));
  for (const [value, count] of counts) {
    if (seen.has(value)) continue;
    list.push({ value, labelAr: value, count: suppressed ? 0 : count });
  }
  return list;
}

// ---------------------------------------------------------------------------
// Interpretation & classification
// ---------------------------------------------------------------------------

/** Bands: 4.50 / 4.00 / 3.50 / 3.00 (admin-only interpretation). */
export function interpretationBandAr(
  averageScore: number | null | undefined
): string | null {
  if (averageScore === null || averageScore === undefined) return null;
  if (averageScore >= 4.5) return "مرتفع";
  if (averageScore >= 4.0) return "فوق المتوسط";
  if (averageScore >= 3.5) return "متوسط";
  if (averageScore >= 3.0) return "منخفض";
  return "منخفض جداً";
}

export interface ClassificationFlags {
  strength: boolean;
  development: boolean;
  priority: boolean;
}

/**
 * Category rules (spec §8):
 *   strength     : average >= 4.00 AND favourable >= 75%
 *   development  : average <  3.50 OR unfavorable >= 20%
 *   priority     : average <  3.00 OR unfavorable >= 30%
 * Rates are percentages (0-100). A category with no valid answers is never
 * classified.
 */
export function classifyCategory(input: {
  averageScore: number | null;
  favorableRate: number | null;
  unfavorableRate: number | null;
}): ClassificationFlags {
  const { averageScore, favorableRate, unfavorableRate } = input;
  if (averageScore === null) {
    return { strength: false, development: false, priority: false };
  }
  const favorable = favorableRate ?? 0;
  const unfavorable = unfavorableRate ?? 0;
  return {
    strength: averageScore >= 4.0 && favorable >= 75,
    development: averageScore < 3.5 || unfavorable >= 20,
    priority: averageScore < 3.0 || unfavorable >= 30,
  };
}

export interface RankedCategory {
  categoryCode: string;
  categoryAr: string;
  averageScore: number;
  indexScore: number | null;
  favorableRate: number | null;
  neutralRate: number | null;
  unfavorableRate: number | null;
  notApplicableRate: number | null;
  questionCount: number;
}

/** Strengths: highest average first, ties broken by favourable rate. */
export function rankStrengths(categories: readonly RankedCategory[]): RankedCategory[] {
  return categories
    .filter((c) => classifyCategory(c).strength)
    .sort(
      (a, b) =>
        b.averageScore - a.averageScore ||
        (b.favorableRate ?? 0) - (a.favorableRate ?? 0)
    )
    .slice(0, 3);
}

/** Development areas: lowest average first, ties broken by unfavourable rate. */
export function rankDevelopmentAreas(
  categories: readonly RankedCategory[]
): RankedCategory[] {
  return categories
    .filter((c) => classifyCategory(c).development)
    .sort(
      (a, b) =>
        a.averageScore - b.averageScore ||
        (b.unfavorableRate ?? 0) - (a.unfavorableRate ?? 0)
    )
    .slice(0, 3);
}

/** Development priorities: same ordering, priority rule only. */
export function rankDevelopmentPriorities(
  categories: readonly RankedCategory[]
): RankedCategory[] {
  return categories
    .filter((c) => classifyCategory(c).priority)
    .sort(
      (a, b) =>
        a.averageScore - b.averageScore ||
        (b.unfavorableRate ?? 0) - (a.unfavorableRate ?? 0)
    )
    .slice(0, 3);
}

/** Trend direction between two comparable question scores. */
export function trendLabelAr(scoreChange: number | null | undefined): string | null {
  if (scoreChange === null || scoreChange === undefined) return null;
  if (scoreChange > TREND_DELTA_THRESHOLD) return TREND_LABELS.improved;
  if (scoreChange < -TREND_DELTA_THRESHOLD) return TREND_LABELS.declined;
  return TREND_LABELS.stable;
}

// ---------------------------------------------------------------------------
// Privacy gate
// ---------------------------------------------------------------------------

export interface ReportGate {
  reportAvailable: boolean;
  reason?: typeof THRESHOLD_NOT_MET_REASON;
  messageAr?: string;
  threshold: number;
  respondentCount: number;
}

/**
 * Minimum reporting threshold (spec §8): below it, no scores, distributions
 * or labels may leave the server — only the gate itself.
 */
export function reportGate(
  respondentCount: number,
  threshold: number | null | undefined
): ReportGate {
  const effectiveThreshold =
    typeof threshold === "number" && threshold > 0
      ? threshold
      : DEFAULT_REPORTING_THRESHOLD;
  if (respondentCount >= effectiveThreshold) {
    return {
      reportAvailable: true,
      threshold: effectiveThreshold,
      respondentCount,
    };
  }
  return {
    reportAvailable: false,
    reason: THRESHOLD_NOT_MET_REASON,
    messageAr: BELOW_THRESHOLD_MESSAGE_AR,
    threshold: effectiveThreshold,
    respondentCount,
  };
}

/** Per-question suppression (same rule, applied to one question's answers). */
export function perQuestionSuppressed(
  answerCount: number,
  threshold: number | null | undefined
): boolean {
  const effectiveThreshold =
    typeof threshold === "number" && threshold > 0
      ? threshold
      : DEFAULT_REPORTING_THRESHOLD;
  return answerCount < effectiveThreshold;
}

// ---------------------------------------------------------------------------
// Future-priority reporting
// ---------------------------------------------------------------------------

export interface SelectionOption {
  value: string;
  labelAr: string;
  displayOrder: number;
  selectionCount: number;
  selectionRate: number | null;
  rank: number;
}

/**
 * `selection_rate = selection_count / unique respondent_groups * 100`,
 * ranked descending (ties keep the stored option order).
 */
export function buildSelectionReport(
  options: readonly OptionDefinition[],
  selectionCounts: ReadonlyMap<string, number>,
  uniqueRespondents: number,
  suppressed = false
): SelectionOption[] {
  const rows = options.map((option, index) => {
    const count = suppressed ? 0 : (selectionCounts.get(option.value) ?? 0);
    return {
      value: option.value,
      labelAr: option.labelAr,
      displayOrder: option.displayOrder ?? index,
      selectionCount: count,
      selectionRate: suppressed ? 0 : (percent(count, uniqueRespondents) ?? 0),
      rank: 0,
    };
  });

  const ranked = rows
    .slice()
    .sort(
      (a, b) =>
        b.selectionCount - a.selectionCount || a.displayOrder - b.displayOrder
    );
  ranked.forEach((row, index) => {
    row.rank = index + 1;
  });
  return rows.map((row) => ({ ...row, rank: ranked.findIndex((r) => r.value === row.value) + 1 }));
}

// ---------------------------------------------------------------------------
// Server-side selection validation
// ---------------------------------------------------------------------------

export interface SelectionValidation {
  ok: boolean;
  code?: "empty" | "too_many" | "duplicates" | "unknown" | "wrong_count";
  errorAr?: string;
}

export const SELECTION_ERROR_AR = {
  empty: "يرجى اختيار إجابة واحدة على الأقل.",
  tooMany: (max: number) =>
    `لا يمكن اختيار أكثر من ${max} خيارات. يرجى اختيار ما يصل إلى ${max} خيارات فقط.`,
  duplicates: "لا يمكن اختيار نفس الخيار أكثر من مرة.",
  unknown: "الخيار المحدد غير موجود في هذا السؤال.",
  wrongCount: "يرجى اختيار إجابة واحدة فقط لهذا السؤال.",
} as const;

/**
 * Multi/single choice validation (spec §9) — runs on the server regardless
 * of what the client already checked.
 */
export function validateSelections(input: {
  questionType: string;
  maxSelections?: number | null;
  selectedValues: readonly string[];
  allowedValues?: readonly string[];
  isRequired?: boolean;
}): SelectionValidation {
  const {
    questionType,
    maxSelections,
    selectedValues,
    allowedValues,
    isRequired = true,
  } = input;

  const values = [...selectedValues];

  if (allowedValues && allowedValues.length > 0) {
    if (values.some((v) => !allowedValues.includes(v))) {
      return { ok: false, code: "unknown", errorAr: SELECTION_ERROR_AR.unknown };
    }
  }

  if (values.length !== new Set(values).size) {
    return { ok: false, code: "duplicates", errorAr: SELECTION_ERROR_AR.duplicates };
  }

  if (questionType === "multi_choice") {
    const limit = typeof maxSelections === "number" && maxSelections > 0 ? maxSelections : 3;
    if (values.length > limit) {
      return { ok: false, code: "too_many", errorAr: SELECTION_ERROR_AR.tooMany(limit) };
    }
    if (values.length === 0) {
      if (isRequired === false) return { ok: true };
      return { ok: false, code: "empty", errorAr: SELECTION_ERROR_AR.empty };
    }
    return { ok: true };
  }

  if (questionType === "single_choice") {
    if (values.length === 0) {
      if (isRequired === false) return { ok: true };
      return { ok: false, code: "empty", errorAr: SELECTION_ERROR_AR.empty };
    }
    if (values.length !== 1) {
      return { ok: false, code: "wrong_count", errorAr: SELECTION_ERROR_AR.wrongCount };
    }
    return { ok: true };
  }

  return { ok: true };
}
