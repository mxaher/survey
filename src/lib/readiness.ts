import { db } from "@/lib/db";
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
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      executives: { include: { executive: true } },
      questionConfig: {
        include: {
          question: { include: { options: true } },
        },
      },
    },
  });

  if (!campaign) {
    return {
      ready: false,
      issues: [{ key: "not_found", messageAr: "الحملة غير موجودة." }],
      campaign: null,
    };
  }

  const issues: ReadinessIssue[] = [];

  // 1. Title & instructions present
  if (!campaign.titleAr || campaign.titleAr.trim() === "") {
    issues.push({
      key: "title_missing",
      messageAr: "يجب إدخال عنوان للحملة.",
    });
  }
  if (!campaign.instructionsAr || campaign.instructionsAr.trim() === "") {
    issues.push({
      key: "instructions_missing",
      messageAr: "يجب إدخال تعليمات المشاركة قبل النشر.",
    });
  }

  // 2. ≥1 active assigned executive
  const activeExecutives = campaign.executives.filter(
    (ce) =>
      ce.isEnabled &&
      ce.executive?.isActive &&
      ce.executive?.deletedAt === null
  );
  if (activeExecutives.length === 0) {
    issues.push({
      key: "no_active_executives",
      messageAr: "يجب إسناد مسؤول واحد على الأقل للحملة قبل النشر.",
    });
  }

  // 3. ≥1 active assigned question
  const activeQuestions = campaign.questionConfig.filter(
    (qc) => qc.question?.isActive && qc.question?.deletedAt === null
  );
  if (activeQuestions.length === 0) {
    issues.push({
      key: "no_active_questions",
      messageAr: "يجب إسناد سؤال واحد على الأقل للحملة قبل النشر.",
    });
  }

  // 4. Every assigned active question has ≥1 active option
  for (const qc of activeQuestions) {
    const activeOptions = (qc.question.options || []).filter(
      (o) => o.isActive
    );
    if (activeOptions.length === 0) {
      issues.push({
        key: `question_${qc.question.code}_no_active_options`,
        messageAr: `السؤال "${qc.question.code}" لا يحتوي على أي خيار نشط.`,
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
  if (!Number.isFinite(campaign.minimumReportingThreshold) || campaign.minimumReportingThreshold < 1) {
    issues.push({
      key: "invalid_threshold",
      messageAr: "يجب أن يكون الحد الأدنى لعرض النتائج عدداً موجباً (1 على الأقل).",
    });
  }

  // 8. Duplicate executives (defensive — PK normally prevents this)
  const execIds = campaign.executives.map((ce) => ce.executiveId);
  const uniqueExecIds = new Set(execIds);
  if (uniqueExecIds.size !== execIds.length) {
    issues.push({
      key: "duplicate_executives",
      messageAr: "يوجد مسؤولون مكررون في إسناد الحملة.",
    });
  }

  // 8b. Duplicate questions (defensive)
  const qIds = campaign.questionConfig.map((qc) => qc.questionId);
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
    campaign.minExecutives > campaign.maxExecutives
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
      id: campaign.id,
      titleAr: campaign.titleAr,
      status: campaign.status,
    },
  };
}
