import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";
import { QUESTION_SCOPES } from "@/lib/constants";

export const dynamic = "force-dynamic";

const QUESTION_SCOPE_KEYS = QUESTION_SCOPES.map((s) => s.key);

function isEditable(status: string): boolean {
  return status === "draft" || status === "scheduled";
}

/**
 * GET /api/admin/campaigns/[campaignId]/questions
 * Lists all question assignments for a campaign, joined with the question and its options.
 */
export const GET = apiHandler(
  async (
    _request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id: campaignId } = await ctx.params;

    const campaign = await db.prepare(
      `SELECT id, status, titleAr FROM Campaign WHERE id = ?`
    ).bind(campaignId).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const configs = await db.prepare(
      `SELECT cqc.campaignId, cqc.questionId, cqc.scope, cqc.isRequired,
              cqc.displayOrder AS qcDisplayOrder, cqc.createdAt, cqc.updatedAt,
              q.id AS qId, q.code AS qCode, q.questionAr AS qQuestionAr,
              q.questionType AS qQuestionType, q.section AS qSection,
              q.dimension AS qDimension, q.isRequired AS qIsRequired,
              q.displayOrder AS qDisplayOrder, q.maxSelections AS qMaxSelections,
              q.version AS qVersion, q.isActive AS qIsActive, q.deletedAt AS qDeletedAt
       FROM CampaignQuestionConfig cqc
       JOIN Question q ON q.id = cqc.questionId
       WHERE cqc.campaignId = ?
       ORDER BY cqc.displayOrder ASC`
    ).bind(campaignId).all();

    // Fetch options for all questions
    const qIds = configs.results.map(
      (qc: Record<string, unknown>) => qc.qId as string
    );
    let allOptions: Record<string, unknown>[] = [];
    if (qIds.length > 0) {
      const ph = qIds.map(() => "?").join(",");
      allOptions = (await db.prepare(
        `SELECT * FROM QuestionOption WHERE questionId IN (${ph}) ORDER BY displayOrder ASC`
      ).bind(...qIds).all()).results as Record<string, unknown>[];
    }

    return ok({
      campaign: {
        id: campaign.id,
        titleAr: campaign.titleAr,
        status: campaign.status,
        editable: isEditable(campaign.status as string),
      },
      assignments: configs.results.map((c: Record<string, unknown>) => ({
        campaignId: c.campaignId,
        questionId: c.questionId,
        scope: c.scope,
        isRequired: c.isRequired,
        displayOrder: c.qcDisplayOrder,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        question: {
          id: c.qId,
          code: c.qCode,
          questionAr: c.qQuestionAr,
          questionType: c.qQuestionType,
          section: c.qSection,
          dimension: c.qDimension,
          isRequired: c.qIsRequired,
          displayOrder: c.qDisplayOrder,
          maxSelections: c.qMaxSelections,
          version: c.qVersion,
          isActive: c.qIsActive,
          deletedAt: c.qDeletedAt,
          options: allOptions
            .filter((o) => o.questionId === c.qId)
            .map((o) => ({
              id: o.id,
              value: o.value,
              labelAr: o.labelAr,
              score: o.score,
              displayOrder: o.displayOrder,
              isActive: o.isActive,
            })),
        },
      })),
    });
  }
);

/**
 * POST /api/admin/campaigns/[campaignId]/questions
 * Assigns one or more questions to a DRAFT or SCHEDULED campaign.
 */
const assignSchema = z.object({
  questionIds: z
    .array(z.string().min(1, "معرّف السؤال مطلوب."))
    .min(1, "يجب تحديد سؤال واحد على الأقل."),
  scope: z
    .string()
    .refine((v) => QUESTION_SCOPE_KEYS.includes(v as never), {
      message: "نطاق السؤال غير معروف.",
    })
    .optional(),
  isRequired: z.coerce.boolean().optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
});

export const POST = apiHandler(
  async (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id: campaignId } = await ctx.params;
    const json = await request.json().catch(() => null);
    if (!json) return fail("صيغة الطلب غير صالحة.", 400);

    const parsed = assignSchema.safeParse(json);
    if (!parsed.success) {
      return fail(
        parsed.error.issues?.[0]?.message ?? MESSAGES.configIncomplete,
        422
      );
    }
    const input = parsed.data;

    const campaign = await db.prepare(
      `SELECT id, status, titleAr FROM Campaign WHERE id = ?`
    ).bind(campaignId).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);
    if (!isEditable(campaign.status as string)) {
      return fail(MESSAGES.cannotEditActiveCampaign, 400, {
        status: campaign.status,
      });
    }

    const uniqueIds = Array.from(new Set(input.questionIds));

    // Validate every question exists and is not soft-deleted
    const ph = uniqueIds.map(() => "?").join(",");
    const validQuestions = await db.prepare(
      `SELECT id FROM Question WHERE id IN (${ph}) AND deletedAt IS NULL`
    ).bind(...uniqueIds).all();
    const validIds = new Set(validQuestions.results.map((q: Record<string, unknown>) => q.id));
    const invalid = uniqueIds.filter((qid) => !validIds.has(qid));
    if (invalid.length > 0) {
      return fail(
        "بعض الأسئلة المحددة غير موجودة أو محذوفة.",
        400,
        { invalidIds: invalid }
      );
    }

    // Find which ids are already assigned
    const existing = await db.prepare(
      `SELECT questionId FROM CampaignQuestionConfig WHERE campaignId = ? AND questionId IN (${ph})`
    ).bind(campaignId, ...uniqueIds).all();
    const existingIds = new Set(existing.results.map((e: Record<string, unknown>) => e.questionId));
    const toCreate = uniqueIds.filter((qid) => !existingIds.has(qid));

    if (toCreate.length === 0) {
      await writeAudit({
        adminUserId: admin.adminId,
        action: "campaign_question.assign",
        entityType: "campaign_question",
        campaignId,
        metadata: {
          requested: uniqueIds,
          created: [],
          skipped: uniqueIds,
          idempotent: true,
        },
      });
      return ok({
        campaignId,
        assigned: [],
        skipped: uniqueIds,
        created: 0,
      });
    }

    // Resolve displayOrder
    let baseOrder = input.displayOrder;
    if (baseOrder === undefined) {
      const maxRow = await db.prepare(
        `SELECT displayOrder FROM CampaignQuestionConfig WHERE campaignId = ? ORDER BY displayOrder DESC LIMIT 1`
      ).bind(campaignId).first() as Record<string, unknown> | null;
      baseOrder = ((maxRow?.displayOrder as number) ?? -1) + 1;
    }

    const now = new Date().toISOString();
    const statements: ReturnType<typeof db.prepare>[] = [];
    const rows: { questionId: string; scope: string; isRequired: boolean; displayOrder: number }[] = [];

    let i = 0;
    for (const qId of toCreate) {
      const scope = input.scope ?? "organization";
      const isReq = input.isRequired ?? true;
      rows.push({ questionId: qId, scope, isRequired: isReq, displayOrder: baseOrder + i });
      statements.push(
        db.prepare(
          `INSERT INTO CampaignQuestionConfig (campaignId, questionId, scope, isRequired, displayOrder, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(campaignId, qId, scope, isReq ? 1 : 0, baseOrder + i, now, now)
      );
      i++;
    }

    await db.batch(statements);

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_question.assign",
      entityType: "campaign_question",
      campaignId,
      metadata: {
        requested: uniqueIds,
        created: rows.map((r) => r.questionId),
        skipped: Array.from(existingIds),
      },
    });

    return ok(
      {
        campaignId,
        assigned: rows,
        skipped: Array.from(existingIds),
        created: rows.length,
      },
      { status: 201 }
    );
  }
);
