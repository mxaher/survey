import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";
import { QUESTION_SCOPES } from "@/lib/constants";

export const dynamic = "force-dynamic";

const QUESTION_SCOPE_KEYS = QUESTION_SCOPES.map((s) => s.key);

/** Returns true iff the campaign status allows structural edits to its
 *  question assignments (i.e. it hasn't been activated yet). */
function isEditable(status: string): boolean {
  return status === "draft" || status === "scheduled";
}

/**
 * GET /api/admin/campaigns/[campaignId]/questions
 * Lists all question assignments for a campaign, joined with the question
 * and its options. Ordered by displayOrder.
 */
export const GET = apiHandler(
  async (
    _request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id: campaignId } = await ctx.params;
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, titleAr: true },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const configs = await db.campaignQuestionConfig.findMany({
      where: { campaignId },
      orderBy: { displayOrder: "asc" },
      include: {
        question: {
          include: {
            options: { orderBy: { displayOrder: "asc" } },
          },
        },
      },
    });

    return ok({
      campaign: {
        id: campaign.id,
        titleAr: campaign.titleAr,
        status: campaign.status,
        editable: isEditable(campaign.status),
      },
      assignments: configs.map((c) => ({
        campaignId: c.campaignId,
        questionId: c.questionId,
        scope: c.scope,
        isRequired: c.isRequired,
        displayOrder: c.displayOrder,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        question: c.question
          ? {
              id: c.question.id,
              code: c.question.code,
              questionAr: c.question.questionAr,
              questionType: c.question.questionType,
              section: c.question.section,
              dimension: c.question.dimension,
              isRequired: c.question.isRequired,
              displayOrder: c.question.displayOrder,
              maxSelections: c.question.maxSelections,
              version: c.question.version,
              isActive: c.question.isActive,
              deletedAt: c.question.deletedAt,
              options: c.question.options.map((o) => ({
                id: o.id,
                value: o.value,
                labelAr: o.labelAr,
                score: o.score,
                displayOrder: o.displayOrder,
                isActive: o.isActive,
              })),
            }
          : null,
      })),
    });
  }
);

/**
 * POST /api/admin/campaigns/[campaignId]/questions
 * Assigns one or more questions to a DRAFT or SCHEDULED campaign.
 *
 * Body:
 *   { questionIds: string[], scope?, isRequired?, displayOrder? }
 *
 * - Rejects for active/closed/archived campaigns with MESSAGES.cannotEditActiveCampaign.
 * - Idempotent: existing assignments are skipped.
 * - Each new assignment gets the supplied `scope`/`isRequired`/`displayOrder`
 *   (or sensible defaults).
 * - Wrapped in db.$transaction.
 * - Audits `campaign_question.assign` with the list of newly-assigned ids.
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

    // Re-validate campaign status from the DB (never trust the client).
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, titleAr: true },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);
    if (!isEditable(campaign.status)) {
      return fail(MESSAGES.cannotEditActiveCampaign, 400, {
        status: campaign.status,
      });
    }

    // De-duplicate the incoming ids defensively.
    const uniqueIds = Array.from(new Set(input.questionIds));

    // Validate that every question exists and is not soft-deleted.
    const validQuestions = await db.question.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      select: { id: true, code: true, isActive: true },
    });
    const validIds = new Set(validQuestions.map((q) => q.id));
    const invalid = uniqueIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      return fail(
        "بعض الأسئلة المحددة غير موجودة أو محذوفة.",
        400,
        { invalidIds: invalid }
      );
    }

    // Find which ids are already assigned (skip those — idempotent).
    const existing = await db.campaignQuestionConfig.findMany({
      where: { campaignId, questionId: { in: uniqueIds } },
      select: { questionId: true },
    });
    const existingIds = new Set(existing.map((e) => e.questionId));
    const toCreate = uniqueIds.filter((id) => !existingIds.has(id));

    if (toCreate.length === 0) {
      // Nothing to do — still audit the idempotent no-op for traceability.
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

    // Resolve a sensible displayOrder: if the body supplied one, use it for
    // every new row; otherwise append after the current max.
    let baseOrder = input.displayOrder;
    if (baseOrder === undefined) {
      const maxRow = await db.campaignQuestionConfig.findFirst({
        where: { campaignId },
        orderBy: { displayOrder: "desc" },
        select: { displayOrder: true },
      });
      baseOrder = (maxRow?.displayOrder ?? -1) + 1;
    }

    const created = await db.$transaction(async (tx) => {
      // Re-read campaign status inside the tx to be race-condition-safe.
      const c = await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });
      if (!c) throw new Error("campaign_not_found");
      if (!isEditable(c.status)) throw new Error("invalid_status");

      const rows: { questionId: string; scope: string; isRequired: boolean; displayOrder: number }[] = [];
      let i = 0;
      for (const qId of toCreate) {
        const row = await tx.campaignQuestionConfig.create({
          data: {
            campaignId,
            questionId: qId,
            scope: input.scope ?? "organization",
            isRequired: input.isRequired ?? true,
            displayOrder: baseOrder + i,
          },
        });
        rows.push({
          questionId: row.questionId,
          scope: row.scope,
          isRequired: row.isRequired,
          displayOrder: row.displayOrder,
        });
        i++;
      }
      return rows;
    });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_question.assign",
      entityType: "campaign_question",
      campaignId,
      metadata: {
        requested: uniqueIds,
        created: created.map((c) => c.questionId),
        skipped: Array.from(existingIds),
      },
    });

    return ok(
      {
        campaignId,
        assigned: created,
        skipped: Array.from(existingIds),
        created: created.length,
      },
      { status: 201 }
    );
  }
);
