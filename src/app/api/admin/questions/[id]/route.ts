import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";
import {
  QUESTION_TYPES,
  QUESTION_SECTIONS,
} from "@/lib/constants";

export const dynamic = "force-dynamic";

const QUESTION_TYPE_KEYS = QUESTION_TYPES.map((t) => t.key);
const QUESTION_SECTION_KEYS = QUESTION_SECTIONS.map((s) => s.key);

/**
 * Helper — returns true iff the question with `id` is referenced by at
 * least one CampaignQuestionConfig whose campaign has any Response rows.
 *
 * This is the "structural edits blocked" trigger: a question that has been
 * answered by at least one participant (through any campaign) cannot have
 * its text / type / options changed, because doing so would invalidate the
 * historical record. The admin may only toggle `isActive` / `displayOrder`
 * in that case.
 */
async function isReferencedByCampaignWithResponses(id: string): Promise<boolean> {
  const count = await db.campaignQuestionConfig.count({
    where: {
      questionId: id,
      campaign: { responses: { some: {} } },
    },
  });
  return count > 0;
}

/**
 * Helper — returns true iff the question with `id` is referenced by ANY
 * CampaignQuestionConfig row (regardless of whether the campaign has
 * responses). This is the "hard-delete blocked" trigger.
 */
async function isReferencedByAnyCampaign(id: string): Promise<boolean> {
  const count = await db.campaignQuestionConfig.count({
    where: { questionId: id },
  });
  return count > 0;
}

/**
 * GET /api/admin/questions/[id]
 * Full detail of one question, including its options (ordered) and a
 * count of campaigns that reference it.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;
    const q = await db.question.findUnique({
      where: { id },
      include: {
        options: { orderBy: { displayOrder: "asc" } },
        _count: { select: { campaignConfig: true } },
      },
    });
    if (!q) return fail("السؤال غير موجود.", 404);

    // Useful for the admin UI: tell it whether structural edits are blocked.
    const structurallyLocked = await isReferencedByCampaignWithResponses(id);

    return ok({
      id: q.id,
      code: q.code,
      questionAr: q.questionAr,
      questionType: q.questionType,
      section: q.section,
      dimension: q.dimension,
      isRequired: q.isRequired,
      displayOrder: q.displayOrder,
      maxSelections: q.maxSelections,
      version: q.version,
      parentQuestionId: q.parentQuestionId,
      isCurrent: q.isCurrent,
      isActive: q.isActive,
      deletedAt: q.deletedAt,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
      options: q.options.map((o) => ({
        id: o.id,
        value: o.value,
        labelAr: o.labelAr,
        score: o.score,
        displayOrder: o.displayOrder,
        isActive: o.isActive,
      })),
      campaignConfigCount: q._count.campaignConfig,
      structurallyLocked,
    });
  }
);

/**
 * PATCH schema. Fields are all optional. The `options` array, if present,
 * is treated as the FULL set: existing options not in the array are
 * hard-deleted (cascade-safe: responses reference snapshots, not options);
 * options with an `id` are updated; options without an `id` are created.
 */
const optionInputSchema = z.object({
  id: z.string().optional(),
  value: z.string().trim().min(1, "قيمة الخيار مطلوبة."),
  labelAr: z.string().trim().min(1, "نص الخيار مطلوب."),
  score: z.coerce.number().nullable().optional(),
  displayOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.coerce.boolean().optional(),
});

const patchSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "رمز السؤال مطلوب.")
    .max(32, "رمز السؤال طويل جداً.")
    .optional(),
  questionAr: z.string().trim().min(1, "نص السؤال مطلوب.").optional(),
  questionType: z
    .string()
    .refine((v) => QUESTION_TYPE_KEYS.includes(v as never), {
      message: "نوع السؤال غير معروف.",
    })
    .optional(),
  section: z
    .string()
    .refine((v) => QUESTION_SECTION_KEYS.includes(v as never), {
      message: "قسم السؤال غير معروف.",
    })
    .optional(),
  dimension: z.string().trim().optional().nullable(),
  isRequired: z.coerce.boolean().optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  maxSelections: z.coerce.number().int().min(1).optional().nullable(),
  isActive: z.coerce.boolean().optional(),
  options: z.array(optionInputSchema).optional(),
});

/** Fields that count as "structural" — change requires no historical answers. */
const STRUCTURAL_FIELDS = new Set([
  "code",
  "questionAr",
  "questionType",
  "section",
  "dimension",
  "isRequired",
  "maxSelections",
  "options",
]);

/**
 * PATCH /api/admin/questions/[id]
 *
 * - If the question is referenced by ANY CampaignQuestionConfig whose
 *   campaign has responses: only `isActive` and `displayOrder` may be
 *   changed. Attempting any structural edit returns 400 with
 *   MESSAGES.deleteQuestionBlocked-style guidance.
 * - Otherwise: full edits allowed.
 * - Bump `version` if `questionAr` changes OR any option's
 *   `value`/`labelAr`/`score` changes, OR options are added/removed.
 */
export const PATCH = apiHandler(
  async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

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

    const existing = await db.question.findUnique({
      where: { id },
      include: { options: { orderBy: { displayOrder: "asc" } } },
    });
    if (!existing) return fail("السؤال غير موجود.", 404);

    // If the question has been answered by anyone (via any campaign with
    // responses), refuse structural edits.
    const structurallyLocked = await isReferencedByCampaignWithResponses(id);
    if (structurallyLocked) {
      const attemptedFields = Object.keys(input);
      const unsafe = attemptedFields.filter((k) => STRUCTURAL_FIELDS.has(k));
      if (unsafe.length > 0) {
        return fail(
          MESSAGES.deleteQuestionBlocked,
          400,
          { blockedFields: unsafe, structurallyLocked: true }
        );
      }
    }

    // Code uniqueness check (if changing code).
    if (input.code && input.code !== existing.code) {
      const clash = await db.question.findUnique({
        where: { code: input.code as string },
        select: { id: true },
      });
      if (clash && clash.id !== id) {
        return fail(
          "رمز السؤال مستخدم مسبقاً. يرجى اختيار رمز فريد.",
          409
        );
      }
    }

    // Decide whether to bump `version`: did the question text or any option
    // value/labelAr/score change (including additions/removals)?
    let bumpVersion = false;

    if (
      input.questionAr !== undefined &&
      (input.questionAr as string) !== existing.questionAr
    ) {
      bumpVersion = true;
    }

    // Build the question-level update payload.
    const questionUpdate: Record<string, unknown> = {};
    for (const k of [
      "code",
      "questionAr",
      "questionType",
      "section",
      "dimension",
      "isRequired",
      "displayOrder",
      "maxSelections",
      "isActive",
    ]) {
      if (input[k] !== undefined) {
        questionUpdate[k] = input[k];
      }
    }

    // If the question is being soft-deleted by setting isActive=false
    // explicitly, that's allowed (covered by the structurallyLocked check
    // passing through, since isActive isn't in STRUCTURAL_FIELDS).

    // Options handling (only if the body explicitly includes `options`).
    let optionsChanged = false;
    if (Array.isArray(input.options)) {
      const incoming = input.options as Array<{
        id?: string;
        value: string;
        labelAr: string;
        score?: number | null;
        displayOrder: number;
        isActive?: boolean;
      }>;

      const incomingIds = new Set(
        incoming.filter((o) => typeof o.id === "string").map((o) => o.id!)
      );

      // Hard-delete options not present in the incoming array (cascade-safe
      // because responses reference snapshots, not options).
      const removed = existing.options.filter((o) => !incomingIds.has(o.id));
      if (removed.length > 0) {
        optionsChanged = true;
        await db.questionOption.deleteMany({
          where: { id: { in: removed.map((o) => o.id) } },
        });
      }

      // Update existing options + create new ones. Detect any value/labelAr/score change.
      for (const inc of incoming) {
        if (inc.id) {
          const cur = existing.options.find((o) => o.id === inc.id);
          if (!cur) {
            // ID supplied but doesn't belong to this question — refuse to
            // silently steal it. Treat as a new option instead.
            await db.questionOption.create({
              data: {
                questionId: id,
                value: inc.value,
                labelAr: inc.labelAr,
                score: inc.score ?? null,
                displayOrder: inc.displayOrder,
                isActive: inc.isActive ?? true,
              },
            });
            optionsChanged = true;
            continue;
          }
          const data: Record<string, unknown> = {};
          if (cur.value !== inc.value) {
            data.value = inc.value;
            optionsChanged = true;
          }
          if (cur.labelAr !== inc.labelAr) {
            data.labelAr = inc.labelAr;
            optionsChanged = true;
          }
          // `score` change counts as structural too — historical averages
          // computed from the OLD score would now differ.
          if (inc.score !== undefined) {
            const newScore = inc.score ?? null;
            if ((cur.score ?? null) !== newScore) {
              data.score = newScore;
              optionsChanged = true;
            }
          }
          if (cur.displayOrder !== inc.displayOrder) {
            data.displayOrder = inc.displayOrder;
          }
          if (inc.isActive !== undefined && cur.isActive !== inc.isActive) {
            data.isActive = inc.isActive;
          }
          if (Object.keys(data).length > 0) {
            await db.questionOption.update({ where: { id: inc.id }, data });
          }
        } else {
          // Brand-new option.
          await db.questionOption.create({
            data: {
              questionId: id,
              value: inc.value,
              labelAr: inc.labelAr,
              score: inc.score ?? null,
              displayOrder: inc.displayOrder,
              isActive: inc.isActive ?? true,
            },
          });
          optionsChanged = true;
        }
      }
    }

    if (optionsChanged) bumpVersion = true;
    if (bumpVersion) questionUpdate.version = (existing.version ?? 1) + 1;

    const updated =
      Object.keys(questionUpdate).length > 0
        ? await db.question.update({
            where: { id },
            data: questionUpdate as Parameters<typeof db.question.update>[0]["data"],
          })
        : existing;

    await writeAudit({
      adminUserId: admin.adminId,
      action: "question.update",
      entityType: "question",
      entityId: id,
      metadata: {
        fields: Object.keys(questionUpdate),
        structurallyLocked,
        versionBumped: bumpVersion,
        previousVersion: existing.version,
        newVersion: updated.version,
      },
    });

    // Re-fetch the latest state with options for the response.
    const refreshed = await db.question.findUnique({
      where: { id },
      include: {
        options: { orderBy: { displayOrder: "asc" } },
        _count: { select: { campaignConfig: true } },
      },
    });

    return ok({
      id: refreshed?.id,
      code: refreshed?.code,
      questionAr: refreshed?.questionAr,
      questionType: refreshed?.questionType,
      section: refreshed?.section,
      dimension: refreshed?.dimension,
      isRequired: refreshed?.isRequired,
      displayOrder: refreshed?.displayOrder,
      maxSelections: refreshed?.maxSelections,
      version: refreshed?.version,
      isActive: refreshed?.isActive,
      deletedAt: refreshed?.deletedAt,
      updatedAt: refreshed?.updatedAt,
      options: refreshed?.options.map((o) => ({
        id: o.id,
        value: o.value,
        labelAr: o.labelAr,
        score: o.score,
        displayOrder: o.displayOrder,
        isActive: o.isActive,
      })),
      campaignConfigCount: refreshed?._count.campaignConfig ?? 0,
      structurallyLocked,
    });
  }
);

/**
 * DELETE /api/admin/questions/[id]
 *
 * - Hard delete IF the question is NOT referenced by any CampaignQuestionConfig.
 * - Otherwise soft-delete: set isActive=false, deletedAt=now, and return
 *   MESSAGES.deleteQuestionBlocked so the UI can tell the admin what
 *   happened.
 */
export const DELETE = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;
    const existing = await db.question.findUnique({
      where: { id },
      select: { id: true, code: true, isActive: true, deletedAt: true },
    });
    if (!existing) return fail("السؤال غير موجود.", 404);

    const referenced = await isReferencedByAnyCampaign(id);

    if (!referenced) {
      // Hard delete. Cascade will drop its QuestionOption rows.
      await db.question.delete({ where: { id } });
      await writeAudit({
        adminUserId: admin.adminId,
        action: "question.delete",
        entityType: "question",
        entityId: id,
        metadata: {
          code: existing.code,
          mode: "hard",
        },
      });
      return ok({ id, deleted: true, mode: "hard" });
    }

    // Soft-delete: keep the row for historical integrity, just hide it.
    const updated = await db.question.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "question.delete",
      entityType: "question",
      entityId: id,
      metadata: {
        code: existing.code,
        mode: "soft",
        reason: "referenced_by_campaign_config",
      },
    });

    // Return 200 with the Arabic guidance message so the UI can surface it
    // as a friendly notice rather than a failure. The envelope is `ok: true`
    // because the operation (soft-delete) actually succeeded; the `message`
    // field explains to the admin what happened.
    return ok({
      id: updated.id,
      deleted: true,
      mode: "soft",
      isActive: updated.isActive,
      deletedAt: updated.deletedAt,
      message: MESSAGES.deleteQuestionBlocked,
    });
  }
);
