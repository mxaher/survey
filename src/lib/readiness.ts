import { getDB } from "@/lib/db";
import { MESSAGES } from "@/lib/messages";

/**
 * Campaign readiness checker (spec §11.7).
 *
 * Runs the full pre-activation readiness validation against the live
 * Campaign + assignments. Used by:
 *   - GET /api/admin/campaigns/[id]/readiness  (admin Readiness panel)
 *   - POST /api/admin/campaigns/[id]/activate (pre-flight, then freeze)
 *
 * Returns a list of Arabic issues. `ready` is true iff `issues` is empty.
 *
 * The checks mirror spec §11.7:
 *   1. Title & instructions present.
 *   2. ≥1 active assigned executive.
 *   3. ≥1 active assigned question.
 *   4. Every assigned active question has ≥1 active option.
 *   5. Start date is set.
 *   6. End date is set AND strictly after start.
 *   7. Reporting threshold ≥ 1.
 *   8. No duplicate executives / questions in the assignment (defensive —
 *      the PK on CampaignExecutive/CampaignQuestionConfig already enforces
 *      uniqueness, but a future schema change could regress this).
 *   9. minExecutives ≤ maxExecutives when both are set.
 */
export interface ReadinessIssue {
  key: string;
  messageAr: string;
}

export interface ReadinessResult {
  ready: boolean;
  issues: ReadinessIssue[];
  campaign: {
    id: string;
    titleAr: string;
    status: string;
  } | null;
}

export async function checkReadiness(
  campaignId: string
): Promise<ReadinessResult> {
  const db = getDB();

  const campaign = await db.prepare(
    `SELECT * FROM Campaign WHERE id = ?`
  ).bind(campaignId).first() as Record<string, unknown> | null;

  if (!campaign) {
    return {
      ready: false,
      issues: [{ key: "not_found", messageAr: "الحملة غير موجودة." }],
      campaign: null,
    };
  }

  // Load related data separately (D1 doesn't support Prisma-style includes)
  const executives = await db.prepare(
    `SELECT ce.*, e.nameAr, e.titleAr, e.category, e.departmentAr, e.isActive AS execIsActive, e.deletedAt AS execDeletedAt
     FROM CampaignExecutive ce
     JOIN Executive e ON e.id = ce.executiveId
     WHERE ce.campaignId = ?`
  ).bind(campaignId).all();

  const questionConfig = await db.prepare(
    `SELECT cqc.*, q.id AS qId, q.code AS qCode, q.questionAr AS qQuestionAr, q.questionType AS qQuestionType,
            q.section AS qSection, q.dimension AS qDimension, q.isRequired AS qIsRequired,
            q.displayOrder AS qDisplayOrder, q.isActive AS qIsActive, q.deletedAt AS qDeletedAt
     FROM CampaignQuestionConfig cqc
     JOIN Question q ON q.id = cqc.questionId
     WHERE cqc.campaignId = ?`
  ).bind(campaignId).all();

  // Load options for each question
  const questionIds = questionConfig.results.map((qc: Record<string, unknown>) => qc.qId as string);
  let options: Record<string, unknown>[] = [];
  if (questionIds.length > 0) {
    const placeholders = questionIds.map(() => "?").join(",");
    options = (await db.prepare(
      `SELECT * FROM QuestionOption WHERE questionId IN (${placeholders}) ORDER BY displayOrder`
    ).bind(...questionIds).all()).results as Record<string, unknown>[];
  }

  const issues: ReadinessIssue[] = [];

  // 1. Title & instructions present
  if (!campaign.titleAr || (campaign.titleAr as string).trim() === "") {
    issues.push({
      key: "title_missing",
      messageAr: "يجب إدخال عنوان للحملة.",
    });
  }
  if (!campaign.instructionsAr || (campaign.instructionsAr as string).trim() === "") {
    issues.push({
      key: "instructions_missing",
      messageAr: "يجب إدخال تعليمات المشاركة قبل النشر.",
    });
  }

  // 2. ≥1 active assigned executive
  const activeExecutives = executives.results.filter(
    (ce: Record<string, unknown>) =>
      ce.isEnabled &&
      ce.execIsActive &&
      ce.execDeletedAt === null
  );
  if (activeExecutives.length === 0) {
    issues.push({
      key: "no_active_executives",
      messageAr: "يجب إسناد مسؤول واحد على الأقل للحملة قبل النشر.",
    });
  }

  // 3. ≥1 active assigned question
  const activeQuestions = questionConfig.results.filter(
    (qc: Record<string, unknown>) => qc.qIsActive && qc.qDeletedAt === null
  );
  if (activeQuestions.length === 0) {
    issues.push({
      key: "no_active_questions",
      messageAr: "يجب إسناد سؤال واحد على الأقل للحملة قبل النشر.",
    });
  }

  // 4. Every assigned active question has ≥1 active option
  for (const qc of activeQuestions) {
    const qOptions = options.filter((o) => o.questionId === qc.qId && o.isActive);
    if (qOptions.length === 0) {
      issues.push({
        key: `question_${qc.qCode}_no_active_options`,
        messageAr: `السؤال "${qc.qCode}" لا يحتوي على أي خيار نشط.`,
      });
    }
  }

  // 5. Start date is set
  if (!campaign.startsAt) {
    issues.push({
      key: "no_start_date",
      messageAr: "يجب تحديد تاريخ بدء الحملة.",
    });
  }

  // 6. End date is set AND strictly after start
  if (!campaign.endsAt) {
    issues.push({
      key: "no_end_date",
      messageAr: "يجب تحديد تاريخ انتهاء الحملة.",
    });
  } else if (campaign.startsAt && campaign.endsAt <= campaign.startsAt) {
    issues.push({
      key: "end_before_start",
      messageAr: "يجب أن يكون تاريخ انتهاء الحملة بعد تاريخ بدئها.",
    });
  }

  // 7. Reporting threshold ≥ 1
  if (!Number.isFinite(campaign.minimumReportingThreshold as number) || (campaign.minimumReportingThreshold as number) < 1) {
    issues.push({
      key: "invalid_threshold",
      messageAr: "يجب أن يكون الحد الأدنى لعرض النتائج عدداً موجباً (1 على الأقل).",
    });
  }

  // 8. Duplicate executives (defensive — PK normally prevents this)
  const execIds = executives.results.map((ce: Record<string, unknown>) => ce.executiveId as string);
  const uniqueExecIds = new Set(execIds);
  if (uniqueExecIds.size !== execIds.length) {
    issues.push({
      key: "duplicate_executives",
      messageAr: "يوجد مسؤولون مكررون في إسناد الحملة.",
    });
  }

  // 8b. Duplicate questions (defensive)
  const qIds = questionConfig.results.map((qc: Record<string, unknown>) => qc.questionId as string);
  const uniqueQIds = new Set(qIds);
  if (uniqueQIds.size !== qIds.length) {
    issues.push({
      key: "duplicate_questions",
      messageAr: "يوجد أسئلة مكررة في إسناد الحملة.",
    });
  }

  // 9. minExecutives ≤ maxExecutives when both are set
  if (
    campaign.minExecutives !== null &&
    campaign.maxExecutives !== null &&
    (campaign.minExecutives as number) > (campaign.maxExecutives as number)
  ) {
    issues.push({
      key: "min_gt_max",
      messageAr: "الحد الأدنى لعدد المسؤولين أكبر من الحد الأقصى.",
    });
  }

  return {
    ready: issues.length === 0,
    issues,
    campaign: {
      id: campaign.id as string,
      titleAr: campaign.titleAr as string,
      status: campaign.status as string,
    },
  };
}
