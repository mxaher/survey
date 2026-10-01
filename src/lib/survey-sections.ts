/**
 * Section-presence helpers shared by the employee survey (intro, wizard,
 * review) and anything else that needs to know whether a campaign section
 * actually has content.
 *
 * A section is *visible* only when it is both toggled on AND has at least one
 * question. Migration `0009_question_bank_v2` left the question library with
 * leadership questions only, so a campaign can easily have
 * `enableEnvironmentSurvey = 1` with zero environment questions — rendering an
 * empty step the employee can never meaningfully answer.
 */

export interface SectionPresence {
  enableEnvironmentSurvey?: number | boolean | null;
  enableFutureSurvey?: number | boolean | null;
  environmentQuestions?: readonly unknown[] | null;
  futureQuestions?: readonly unknown[] | null;
}

export function envSectionEnabled(campaign: SectionPresence): boolean {
  return (
    Boolean(campaign.enableEnvironmentSurvey) &&
    (campaign.environmentQuestions?.length ?? 0) > 0
  );
}

export function futureSectionEnabled(campaign: SectionPresence): boolean {
  return (
    Boolean(campaign.enableFutureSurvey) &&
    (campaign.futureQuestions?.length ?? 0) > 0
  );
}
