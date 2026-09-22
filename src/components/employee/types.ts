/**
 * Shared TypeScript types for the employee survey UX (Task 3-a).
 *
 * These mirror the API response shapes returned by the employee endpoints
 * under `/api/employee/*`. See `src/app/api/employee/campaign/route.ts` for
 * the canonical `Campaign` shape (extended by Task 3-a to bundle the
 * environment + future question snapshots in a single round-trip), and
 * `src/app/api/employee/executives/[executiveId]/questions/route.ts` for the
 * leadership question shape.
 */

export interface QuestionOptionSnapshot {
  id: string;
  value: string;
  labelAr: string;
  score: number | null;
  displayOrder: number;
}

export interface QuestionSnapshot {
  id: string;
  originalQuestionId: string;
  questionCode: string;
  questionAr: string;
  questionType: string; // scale | yes_no | single_choice | multi_choice
  section: string; // environment | leadership | future
  dimension: string | null;
  isRequired: boolean;
  displayOrder: number;
  maxSelections: number | null;
  options: QuestionOptionSnapshot[];
}

/** `GET /api/employee/campaign` — `data` field. */
export interface ActiveCampaign {
  id: string;
  titleAr: string;
  descriptionAr: string | null;
  instructionsAr: string | null;
  privacyNoticeAr: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  minimumReportingThreshold: number;
  enableEnvironmentSurvey: boolean;
  enableFutureSurvey: boolean;
  allowMultipleExecutiveEvaluations: boolean;
  minExecutives: number | null;
  maxExecutives: number | null;
  allowResume: boolean;
  status: string;
  environmentQuestions: QuestionSnapshot[];
  futureQuestions: QuestionSnapshot[];
}

/** One row in the executives list returned by `GET /api/employee/executives`. */
export interface ExecutiveRow {
  id: string;
  nameAr: string;
  titleAr: string;
  category: string;
  departmentAr: string | null;
  displayOrder: number;
}

export interface ExecutivesResponse {
  executives: ExecutiveRow[];
  evaluatedExecutiveIds: string[];
}

export interface ParticipationStatus {
  environmentSubmitted: boolean;
  futureSubmitted: boolean;
  evaluatedExecutiveIds: string[];
  allExecutivesEvaluated: boolean;
}

/** `GET /api/employee/executives/[executiveId]/questions` — `data` field. */
export interface ExecutiveQuestionsResponse {
  campaign: {
    id: string;
    titleAr: string;
  };
  executive: {
    id: string;
    nameAr: string;
    titleAr: string;
    category: string;
    departmentAr: string | null;
    displayOrder: number;
  };
  questions: QuestionSnapshot[];
}

/** Envelope returned by every employee JSON endpoint. */
export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Custom error thrown by `fetchEmployeeApi` when the server returns a non-2xx
 * status or `{ ok: false }` envelope. Carries the HTTP status (so the wizard
 * can detect 401 = not impersonated yet, 409 = duplicate submission, etc.) and
 * the Arabic error message returned by the API.
 */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
