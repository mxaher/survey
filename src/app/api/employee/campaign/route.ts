import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { noStore, fail, apiHandler } from "@/lib/api";
import { getVerifiedEmployee } from "@/lib/identity";
import { MESSAGES, PRIVACY_NOTICE } from "@/lib/messages";
import { isWithinActiveWindow, nowUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (_request: NextRequest) => {
  const employee = await getVerifiedEmployee();
  if (!employee) return fail(MESSAGES.unauthorized, 401);

  const db = getDB();

  const now = nowUtc();
  const { results: candidates } = await db
    .prepare("SELECT * FROM Campaign WHERE status = 'active'")
    .all();

  const active = candidates.find((c: any) =>
    isWithinActiveWindow(now, new Date(c.startsAt), new Date(c.endsAt)).active
  );

  if (!active) {
    return noStore(null);
  }

  let privacyNoticeAr = active.privacyNoticeAr as string | null;
  if (!privacyNoticeAr || privacyNoticeAr.trim() === "") {
    const setting = await db
      .prepare("SELECT * FROM SystemSetting WHERE key = ?")
      .bind("privacy_notice")
      .first();
    privacyNoticeAr =
      (setting?.valueAr as string | null) ?? PRIVACY_NOTICE;
  }

  let envSnapshots: any[] = [];
  if (active.enableEnvironmentSurvey) {
    const { results: snaps } = await db
      .prepare(
        "SELECT * FROM CampaignQuestionSnapshot WHERE campaignId = ? AND section = 'environment' ORDER BY displayOrder ASC"
      )
      .bind(active.id)
      .all();
    for (const s of snaps) {
      const { results: opts } = await db
        .prepare(
          "SELECT * FROM CampaignQuestionOptionSnapshot WHERE campaignQuestionSnapshotId = ? ORDER BY displayOrder ASC"
        )
        .bind(s.id)
        .all();
      envSnapshots.push({ ...s, options: opts });
    }
  }

  let futureSnapshots: any[] = [];
  if (active.enableFutureSurvey) {
    const { results: snaps } = await db
      .prepare(
        "SELECT * FROM CampaignQuestionSnapshot WHERE campaignId = ? AND section = 'future' ORDER BY displayOrder ASC"
      )
      .bind(active.id)
      .all();
    for (const s of snaps) {
      const { results: opts } = await db
        .prepare(
          "SELECT * FROM CampaignQuestionOptionSnapshot WHERE campaignQuestionSnapshotId = ? ORDER BY displayOrder ASC"
        )
        .bind(s.id)
        .all();
      futureSnapshots.push({ ...s, options: opts });
    }
  }

  const environmentQuestions = envSnapshots.map((s: any) => ({
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
    options: (s.options as any[])
      .slice()
      .sort((a: any, b: any) => a.displayOrder - b.displayOrder)
      .map((o: any) => ({
        id: o.id,
        value: o.value,
        labelAr: o.labelAr,
        score: o.score,
        displayOrder: o.displayOrder,
      })),
  }));

  const futureQuestions = futureSnapshots.map((s: any) => ({
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
    options: (s.options as any[])
      .slice()
      .sort((a: any, b: any) => a.displayOrder - b.displayOrder)
      .map((o: any) => ({
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
