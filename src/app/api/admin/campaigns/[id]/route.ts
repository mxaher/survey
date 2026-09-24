import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/campaigns/[id]
 * Full campaign detail: campaign fields + counts + (limited) assignment info.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id } = await ctx.params;

    // 1. Campaign row
    const campaign = await db.prepare(
      `SELECT * FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown> | null;

    if (!campaign) return fail("الحملة غير موجودة.", 404);

    // 2. Executives with joined executive data
    const executives = await db.prepare(
      `SELECT ce.campaignId, ce.executiveId, ce.displayOrder, ce.isEnabled,
              ce.createdAt AS ceCreatedAt, ce.updatedAt AS ceUpdatedAt,
              e.nameAr, e.titleAr, e.category, e.departmentAr, e.isActive
       FROM CampaignExecutive ce
       JOIN Executive e ON e.id = ce.executiveId
       WHERE ce.campaignId = ?
       ORDER BY ce.displayOrder ASC`
    ).bind(id).all();

    // 3. Question configs with joined question + options
    const questionConfigs = await db.prepare(
      `SELECT cqc.campaignId, cqc.questionId, cqc.scope, cqc.isRequired,
              cqc.displayOrder AS qcDisplayOrder,
              cqc.createdAt AS qcCreatedAt, cqc.updatedAt AS qcUpdatedAt,
              q.id AS qId, q.code AS qCode, q.questionAr AS qQuestionAr,
              q.questionType AS qQuestionType, q.section AS qSection,
              q.dimension AS qDimension, q.isRequired AS qIsRequired,
              q.isActive AS qIsActive, q.maxSelections AS qMaxSelections
       FROM CampaignQuestionConfig cqc
       JOIN Question q ON q.id = cqc.questionId
       WHERE cqc.campaignId = ?
       ORDER BY cqc.displayOrder ASC`
    ).bind(id).all();

    // 4. Fetch options for all questions
    const questionIds = questionConfigs.results.map(
      (qc: Record<string, unknown>) => qc.qId as string
    );
    let allOptions: Record<string, unknown>[] = [];
    if (questionIds.length > 0) {
      const placeholders = questionIds.map(() => "?").join(",");
      allOptions = (await db.prepare(
        `SELECT * FROM QuestionOption WHERE questionId IN (${placeholders})`
      ).bind(...questionIds).all()).results as Record<string, unknown>[];
    }

    // 5. Count subqueries
    const responseCount = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM Response WHERE campaignId = ?`
    ).bind(id).first() as Record<string, unknown>;
    const ledgerCount = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM ParticipationLedger WHERE campaignId = ?`
    ).bind(id).first() as Record<string, unknown>;
    const snapshotCount = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM CampaignQuestionSnapshot WHERE campaignId = ?`
    ).bind(id).first() as Record<string, unknown>;

    // Assemble executives
    const execList = executives.results.map((ce: Record<string, unknown>) => ({
      executiveId: ce.executiveId,
      displayOrder: ce.displayOrder,
      isEnabled: ce.isEnabled,
      executive: {
        id: ce.executiveId,
        nameAr: ce.nameAr,
        titleAr: ce.titleAr,
        category: ce.category,
        departmentAr: ce.departmentAr,
        isActive: ce.isActive,
      },
    }));

    // Assemble questions
    const questionList = questionConfigs.results.map((qc: Record<string, unknown>) => {
      const qOptions = allOptions
        .filter((o) => o.questionId === qc.qId && o.isActive)
        .sort((a, b) => (a.displayOrder as number) - (b.displayOrder as number))
        .map((o) => ({
          id: o.id,
          value: o.value,
          labelAr: o.labelAr,
          score: o.score,
          displayOrder: o.displayOrder,
        }));

      return {
        questionId: qc.questionId,
        scope: qc.scope,
        isRequired: qc.isRequired,
        displayOrder: qc.qcDisplayOrder,
        question: {
          id: qc.qId,
          code: qc.qCode,
          questionAr: qc.qQuestionAr,
          questionType: qc.qQuestionType,
          section: qc.qSection,
          dimension: qc.qDimension,
          isRequired: qc.qIsRequired,
          isActive: qc.qIsActive,
          maxSelections: qc.qMaxSelections,
          options: qOptions,
        },
      };
    });

    return ok({
      id: campaign.id,
      titleAr: campaign.titleAr,
      descriptionAr: campaign.descriptionAr,
      instructionsAr: campaign.instructionsAr,
      status: campaign.status,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      timezone: campaign.timezone,
      minimumReportingThreshold: campaign.minimumReportingThreshold,
      enableEnvironmentSurvey: campaign.enableEnvironmentSurvey,
      enableFutureSurvey: campaign.enableFutureSurvey,
      allowMultipleExecutiveEvaluations:
        campaign.allowMultipleExecutiveEvaluations,
      minExecutives: campaign.minExecutives,
      maxExecutives: campaign.maxExecutives,
      allowResume: campaign.allowResume,
      privacyNoticeAr: campaign.privacyNoticeAr,
      activatedAt: campaign.activatedAt,
      closedAt: campaign.closedAt,
      createdBy: campaign.createdBy,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      executives: execList,
      questions: questionList,
      counts: {
        responses: responseCount.cnt,
        participationLedger: ledgerCount.cnt,
        questionSnapshots: snapshotCount.cnt,
        executives: execList.length,
        questions: questionList.length,
      },
    });
  }
);

/**
 * PATCH /api/admin/campaigns/[id]
 * Update fields with active-campaign restrictions.
 */
const patchSchema = z
  .object({
    titleAr: z.string().trim().min(1).optional(),
    descriptionAr: z.string().trim().optional().nullable(),
    instructionsAr: z.string().trim().optional().nullable(),
    startsAt: z.coerce.date().optional().nullable(),
    endsAt: z.coerce.date().optional().nullable(),
    timezone: z.string().trim().optional(),
    minimumReportingThreshold: z.coerce.number().int().min(1).optional(),
    enableEnvironmentSurvey: z.coerce.boolean().optional(),
    enableFutureSurvey: z.coerce.boolean().optional(),
    allowMultipleExecutiveEvaluations: z.coerce.boolean().optional(),
    minExecutives: z.coerce.number().int().min(1).optional().nullable(),
    maxExecutives: z.coerce.number().int().min(1).optional().nullable(),
    allowResume: z.coerce.boolean().optional(),
    privacyNoticeAr: z.string().trim().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.startsAt && data.endsAt) {
        return data.endsAt > data.startsAt;
      }
      return true;
    },
    {
      message: "يجب أن يكون تاريخ انتهاء الحملة بعد تاريخ بدئها.",
      path: ["endsAt"],
    }
  )
  .refine(
    (data) => {
      if (
        data.minExecutives !== null &&
        data.minExecutives !== undefined &&
        data.maxExecutives !== null &&
        data.maxExecutives !== undefined
      ) {
        return data.minExecutives <= data.maxExecutives;
      }
      return true;
    },
    {
      message: "الحد الأدنى لعدد المسؤولين أكبر من الحد الأقصى.",
      path: ["maxExecutives"],
    }
  );

const SAFE_ACTIVE_FIELDS = new Set([
  "descriptionAr",
  "endsAt",
  "minimumReportingThreshold",
]);

function changedFields(input: Record<string, unknown>): string[] {
  return Object.keys(input);
}

export const PATCH = apiHandler(
  async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    if (!json || typeof json !== "object") {
      return fail("صيغة الطلب غير صالحة.", 400);
    }

    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return fail(
        parsed.error.issues?.[0]?.message ?? MESSAGES.configIncomplete,
        422
      );
    }
    const input = parsed.data as Record<string, unknown>;

    const campaign = await db.prepare(
      `SELECT * FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    if (campaign.status === "closed" || campaign.status === "archived") {
      return fail(
        "لا يمكن تعديل حملة مغلقة أو مؤرشفة حفاظاً على سلامة النتائج.",
        400
      );
    }

    if (campaign.status === "active") {
      const changed = changedFields(input);
      const unsafe = changed.filter((k) => !SAFE_ACTIVE_FIELDS.has(k));
      if (unsafe.length > 0) {
        return fail(MESSAGES.cannotEditActiveCampaign, 400, {
          blockedFields: unsafe,
        });
      }
      if (
        input.endsAt !== undefined &&
        campaign.endsAt &&
        input.endsAt &&
        new Date(input.endsAt as Date).getTime() <
          new Date(campaign.endsAt as string).getTime()
      ) {
        return fail(
          "لا يمكن تقصير تاريخ انتهاء حملة نشطة، فقط تمديده.",
          400
        );
      }
    }

    // Build SET clause dynamically
    const allowed = [
      "titleAr", "descriptionAr", "instructionsAr", "startsAt", "endsAt",
      "timezone", "minimumReportingThreshold", "enableEnvironmentSurvey",
      "enableFutureSurvey", "allowMultipleExecutiveEvaluations",
      "minExecutives", "maxExecutives", "allowResume", "privacyNoticeAr",
    ];
    const setParts: string[] = [];
    const bindValues: unknown[] = [];
    for (const k of allowed) {
      if (input[k] !== undefined) {
        let val = input[k];
        if (val instanceof Date) val = val.toISOString();
        if (typeof val === "boolean") val = val ? 1 : 0;
        setParts.push(`${k} = ?`);
        bindValues.push(val);
      }
    }
    if (setParts.length === 0) {
      return ok({
        id: campaign.id,
        titleAr: campaign.titleAr,
        status: campaign.status,
        updatedAt: campaign.updatedAt,
      });
    }
    setParts.push("updatedAt = datetime('now')");
    bindValues.push(id);

    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE Campaign SET ${setParts.join(", ")} WHERE id = ?`
    ).bind(...bindValues).run();

    const updated = await db.prepare(
      `SELECT id, titleAr, status, updatedAt FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown>;

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign.update",
      entityType: "campaign",
      entityId: updated.id as string,
      campaignId: updated.id as string,
      metadata: {
        fields: Object.keys(input),
        status: campaign.status,
      },
    });

    return ok({
      id: updated.id,
      titleAr: updated.titleAr,
      status: updated.status,
      updatedAt: updated.updatedAt,
    });
  }
);

/**
 * DELETE /api/admin/campaigns/[id]
 * Only allowed when status='draft' AND no participation ledger rows AND
 * no responses.
 */
export const DELETE = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id } = await ctx.params;

    const campaign = await db.prepare(
      `SELECT * FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const respCount = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM Response WHERE campaignId = ?`
    ).bind(id).first() as Record<string, unknown>;
    const ledgCount = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM ParticipationLedger WHERE campaignId = ?`
    ).bind(id).first() as Record<string, unknown>;

    if (campaign.status !== "draft") {
      return fail(
        "لا يمكن حذف حملة بدأت المشاركة فيها. يمكنك أرشفتها بدلاً من ذلك.",
        400
      );
    }
    if ((respCount.cnt as number) > 0 || (ledgCount.cnt as number) > 0) {
      return fail(
        "لا يمكن حذف حملة لديها مشاركات مسجلة. يمكنك أرشفتها بدلاً من ذلك.",
        400
      );
    }

    // Manual cascade deletes (D1 has no foreign key cascade by default)
    await db.batch([
      db.prepare(`DELETE FROM CampaignQuestionOptionSnapshot WHERE campaignQuestionSnapshotId IN (SELECT id FROM CampaignQuestionSnapshot WHERE campaignId = ?)`).bind(id),
      db.prepare(`DELETE FROM CampaignQuestionSnapshot WHERE campaignId = ?`).bind(id),
      db.prepare(`DELETE FROM CampaignQuestionConfig WHERE campaignId = ?`).bind(id),
      db.prepare(`DELETE FROM CampaignExecutive WHERE campaignId = ?`).bind(id),
      db.prepare(`DELETE FROM Campaign WHERE id = ?`).bind(id),
    ]);

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign.delete",
      entityType: "campaign",
      entityId: id,
      campaignId: id,
      metadata: {
        titleAr: campaign.titleAr,
        previousStatus: campaign.status,
      },
    });

    return ok({ id, deleted: true });
  }
);
