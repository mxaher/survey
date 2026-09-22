import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { noStore, fail, apiHandler } from "@/lib/api";
import { getVerifiedEmployee } from "@/lib/identity";
import { MESSAGES, PRIVACY_NOTICE } from "@/lib/messages";
import { isWithinActiveWindow, nowUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * GET /api/employee/campaign
 *
 * Returns the single currently-active campaign (status='active' AND within
 * startsAt/endsAt window) along with the fields the employee UI needs:
 *   title, description, instructions, privacy notice, toggles, min/max
 *   executives, allowResume.
 *
 * If no active campaign exists, returns `{ ok: true, data: null }` — the
 * frontend handles the null gracefully and shows MESSAGES.noActiveCampaign
 * (spec §4 / §13.1).
 *
 * Auth: must call `getVerifiedEmployee()` first; 401 with MESSAGES.unauthorized
 * if null. `Cache-Control: no-store` enforced via `noStore()`.
 *
 * NEVER returns `employeeHmac`.
 */
export const GET = apiHandler(async (_request: NextRequest) => {
  const employee = await getVerifiedEmployee();
  if (!employee) return fail(MESSAGES.unauthorized, 401);

  // A campaign is "currently active" iff status='active' AND now is inside
  // [startsAt, endsAt]. The status flip is admin-driven; the window check
  // additionally protects against the case where the admin forgot to close
  // an expired campaign.
  const now = nowUtc();
  const candidates = await db.campaign.findMany({
    where: { status: "active" },
  });

  const active = candidates.find((c) =>
    isWithinActiveWindow(now, c.startsAt, c.endsAt).active
  );

  if (!active) {
    // Spec §13.1 — frontend renders MESSAGES.noActiveCampaign from this null.
    return noStore(null);
  }

  // Resolve privacy notice: campaign override > system setting > bundled constant.
  let privacyNoticeAr = active.privacyNoticeAr;
  if (!privacyNoticeAr || privacyNoticeAr.trim() === "") {
    const setting = await db.systemSetting.findUnique({
      where: { key: "privacy_notice" },
    });
    privacyNoticeAr = setting?.valueAr ?? PRIVACY_NOTICE;
  }

  // Bundle the environment + future frozen question snapshots so the employee
  // wizard can render steps 1 + 3 from a single round-trip (Task 3-a UX).
  // Leadership snapshots are still loaded per-executive via the existing
  // `/api/employee/executives/[executiveId]/questions` endpoint (one
  // executive at a time in step 2). Each snapshot item carries the option
  // snapshots too — same shape the leadership questions endpoint returns,
  // so the UI can use a single shared QuestionCard component.
  const envSnapshots = active.enableEnvironmentSurvey
    ? await db.campaignQuestionSnapshot.findMany({
        where: { campaignId: active.id, section: "environment" },
        include: { options: true },
        orderBy: { displayOrder: "asc" },
      })
    : [];

  const futureSnapshots = active.enableFutureSurvey
    ? await db.campaignQuestionSnapshot.findMany({
        where: { campaignId: active.id, section: "future" },
        include: { options: true },
        orderBy: { displayOrder: "asc" },
      })
    : [];

  const environmentQuestions = envSnapshots.map((s) => ({
    id: s.id,
    originalQuestionId: s.originalQuestionId,
    questionCode: s.questionCode,
    questionAr: s.questionAr,
    questionType: s.questionType,
    section: s.section,
    dimension: s.dimension,
    isRequired: s.isRequired,
    displayOrder: s.displayOrder,
    maxSelections: s.maxSelections,
    options: s.options
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((o) => ({
        id: o.id,
        value: o.value,
        labelAr: o.labelAr,
        score: o.score,
        displayOrder: o.displayOrder,
      })),
  }));

  const futureQuestions = futureSnapshots.map((s) => ({
    id: s.id,
    originalQuestionId: s.originalQuestionId,
    questionCode: s.questionCode,
    questionAr: s.questionAr,
    questionType: s.questionType,
    section: s.section,
    dimension: s.dimension,
    isRequired: s.isRequired,
    displayOrder: s.displayOrder,
    maxSelections: s.maxSelections,
    options: s.options
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((o) => ({
        id: o.id,
        value: o.value,
        labelAr: o.labelAr,
        score: o.score,
        displayOrder: o.displayOrder,
      })),
  }));

  return noStore({
    id: active.id,
    titleAr: active.titleAr,
    descriptionAr: active.descriptionAr,
    instructionsAr: active.instructionsAr,
    privacyNoticeAr,
    startsAt: active.startsAt,
    endsAt: active.endsAt,
    timezone: active.timezone,
    minimumReportingThreshold: active.minimumReportingThreshold,
    enableEnvironmentSurvey: active.enableEnvironmentSurvey,
    enableFutureSurvey: active.enableFutureSurvey,
    allowMultipleExecutiveEvaluations:
      active.allowMultipleExecutiveEvaluations,
    minExecutives: active.minExecutives,
    maxExecutives: active.maxExecutives,
    allowResume: active.allowResume,
    status: active.status,
    environmentQuestions,
    futureQuestions,
  });
});
