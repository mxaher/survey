import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
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
async function isReferencedByCampaignWithResponses(
  db: any,
  id: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM CampaignQuestionConfig cqc
       JOIN Campaign c ON c.id = cqc.campaignId
       WHERE cqc.questionId = ?
         AND EXISTS (SELECT 1 FROM Response r WHERE r.campaignId = c.id)`
    )
    .bind(id)
    .first();
  return ((row?.cnt as number) ?? 0) > 0;
}

/**
 * Helper — returns true iff the question with `id` is referenced by ANY
 * CampaignQuestionConfig row (regardless of whether the campaign has
 * responses). This is the "hard-delete blocked" trigger.
 */
async function isReferencedByAnyCampaign(
  db: any,
  id: string
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) as cnt FROM CampaignQuestionConfig WHERE questionId = ?"
    )
    .bind(id)
    .first();
  return ((row?.cnt as number) ?? 0) > 0;
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

    const db = getDB();
    const { id } = await ctx.params;

    const q = await db
      .prepare("SELECT * FROM Question WHERE id = ?")
      .bind(id)
      .first();
    if (!q) return fail("السؤال غير موجود.", 404);

    const { results: options } = await db
      .prepare(
        "SELECT id, value, labelAr, score, displayOrder, isActive FROM QuestionOption WHERE questionId = ? ORDER BY displayOrder ASC"
      )
      .bind(id)
      .all();

    const configCountRow = await db
      .prepare(
        "SELECT COUNT(*) as cnt FROM CampaignQuestionConfig WHERE questionId = ?"
      )
      .bind(id)
      .first();

    const structurallyLocked = await isReferencedByCampaignWithResponses(
      db,
      id
    );

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
      options: options.map((o: Record<string, unknown>) => ({
        id: o.id,
        value: o.value,
        labelAr: o.labelAr,
        score: o.score,
        displayOrder: o.displayOrder,
        isActive: o.isActive,
      })),
      campaignConfigCount: (configCountRow?.cnt as number) ?? 0,
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

    const existing = await db
      .prepare("SELECT * FROM Question WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return fail("السؤال غير موجود.", 404);

    const { results: existingOptions } = await db
      .prepare(
        "SELECT id, value, labelAr, score, displayOrder, isActive FROM QuestionOption WHERE questionId = ? ORDER BY displayOrder ASC"
      )
      .bind(id)
      .all();

    // If the question has been answered by anyone (via any campaign with
    // responses), refuse structural edits.
    const structurallyLocked = await isReferencedByCampaignWithResponses(
      db,
      id
    );
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
      const clash = await db
        .prepare("SELECT id FROM Question WHERE code = ?")
        .bind(input.code as string)
        .first();
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

    // Build the question-level update SET clauses.
    const setClauses: string[] = [];
    const updateParams: unknown[] = [];

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
        let val = input[k];
        if (k === "isRequired" || k === "isActive") {
          val = val ? 1 : 0;
        }
        setClauses.push(`${k} = ?`);
        updateParams.push(val);
      }
    }

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

      // Hard-delete options not present in the incoming array.
      const removed = existingOptions.filter(
        (o: Record<string, unknown>) => !incomingIds.has(o.id as string)
      );
      if (removed.length > 0) {
        optionsChanged = true;
        const delPlaceholders = removed.map(() => "?").join(",");
        await db
          .prepare(
            `DELETE FROM QuestionOption WHERE id IN (${delPlaceholders})`
          )
          .bind(...removed.map((o: Record<string, unknown>) => o.id))
          .run();
      }

      // Update existing options + create new ones.
      const batchStatements: any[] = [];

      for (const inc of incoming) {
        if (inc.id) {
          const cur = existingOptions.find(
            (o: Record<string, unknown>) => o.id === inc.id
          );
          if (!cur) {
            // ID supplied but doesn't belong to this question — treat as new.
            batchStatements.push(
              db
                .prepare(
                  `INSERT INTO QuestionOption (id, questionId, value, labelAr, score, displayOrder, isActive)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                  crypto.randomUUID(),
                  id,
                  inc.value,
                  inc.labelAr,
                  inc.score ?? null,
                  inc.displayOrder,
                  inc.isActive !== undefined ? (inc.isActive ? 1 : 0) : 1
                )
            );
            optionsChanged = true;
            continue;
          }

          const optSetClauses: string[] = [];
          const optParams: unknown[] = [];

          if ((cur.value as string) !== inc.value) {
            optSetClauses.push("value = ?");
            optParams.push(inc.value);
            optionsChanged = true;
          }
          if ((cur.labelAr as string) !== inc.labelAr) {
            optSetClauses.push("labelAr = ?");
            optParams.push(inc.labelAr);
            optionsChanged = true;
          }
          if (inc.score !== undefined) {
            const newScore = inc.score ?? null;
            if ((cur.score ?? null) !== newScore) {
              optSetClauses.push("score = ?");
              optParams.push(newScore);
              optionsChanged = true;
            }
          }
          if ((cur.displayOrder as number) !== inc.displayOrder) {
            optSetClauses.push("displayOrder = ?");
            optParams.push(inc.displayOrder);
          }
          if (
            inc.isActive !== undefined &&
            (cur.isActive as number) !== (inc.isActive ? 1 : 0)
          ) {
            optSetClauses.push("isActive = ?");
            optParams.push(inc.isActive ? 1 : 0);
          }

          if (optSetClauses.length > 0) {
            optParams.push(inc.id);
            batchStatements.push(
              db
                .prepare(
                  `UPDATE QuestionOption SET ${optSetClauses.join(", ")} WHERE id = ?`
                )
                .bind(...optParams)
            );
          }
        } else {
          // Brand-new option.
          batchStatements.push(
            db
              .prepare(
                `INSERT INTO QuestionOption (id, questionId, value, labelAr, score, displayOrder, isActive)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
              )
              .bind(
                crypto.randomUUID(),
                id,
                inc.value,
                inc.labelAr,
                inc.score ?? null,
                inc.displayOrder,
                inc.isActive !== undefined ? (inc.isActive ? 1 : 0) : 1
              )
          );
          optionsChanged = true;
        }
      }

      if (batchStatements.length > 0) {
        await db.batch(batchStatements);
      }
    }

    if (optionsChanged) bumpVersion = true;
    if (bumpVersion) {
      const currentVersion = (existing.version as number) ?? 1;
      setClauses.push("version = ?");
      updateParams.push(currentVersion + 1);
    }

    let updated = existing;
    if (setClauses.length > 0) {
      setClauses.push("updatedAt = datetime('now')");
      updateParams.push(id);
      await db
        .prepare(`UPDATE Question SET ${setClauses.join(", ")} WHERE id = ?`)
        .bind(...updateParams)
        .run();
      updated = await db
        .prepare("SELECT * FROM Question WHERE id = ?")
        .bind(id)
        .first();
    }

    await writeAudit({
      adminUserId: admin.adminId,
      action: "question.update",
      entityType: "question",
      entityId: id,
      metadata: {
        fields: Object.keys(input),
        structurallyLocked,
        versionBumped: bumpVersion,
        previousVersion: existing.version,
        newVersion: updated.version,
      },
    });

    // Re-fetch the latest state with options for the response.
    const { results: refreshedOptions } = await db
      .prepare(
        "SELECT id, value, labelAr, score, displayOrder, isActive FROM QuestionOption WHERE questionId = ? ORDER BY displayOrder ASC"
      )
      .bind(id)
      .all();

    const configCountRow = await db
      .prepare(
        "SELECT COUNT(*) as cnt FROM CampaignQuestionConfig WHERE questionId = ?"
      )
      .bind(id)
      .first();

    return ok({
      id: updated.id,
      code: updated.code,
      questionAr: updated.questionAr,
      questionType: updated.questionType,
      section: updated.section,
      dimension: updated.dimension,
      isRequired: updated.isRequired,
      displayOrder: updated.displayOrder,
      maxSelections: updated.maxSelections,
      version: updated.version,
      isActive: updated.isActive,
      deletedAt: updated.deletedAt,
      updatedAt: updated.updatedAt,
      options: refreshedOptions.map((o: Record<string, unknown>) => ({
        id: o.id,
        value: o.value,
        labelAr: o.labelAr,
        score: o.score,
        displayOrder: o.displayOrder,
        isActive: o.isActive,
      })),
      campaignConfigCount: (configCountRow?.cnt as number) ?? 0,
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

    const db = getDB();
    const { id } = await ctx.params;

    const existing = await db
      .prepare(
        "SELECT id, code, isActive, deletedAt FROM Question WHERE id = ?"
      )
      .bind(id)
      .first();
    if (!existing) return fail("السؤال غير موجود.", 404);

    const referenced = await isReferencedByAnyCampaign(db, id);

    if (!referenced) {
      // Hard delete. Also delete its QuestionOption rows.
      await db
        .prepare("DELETE FROM QuestionOption WHERE questionId = ?")
        .bind(id)
        .run();
      await db
        .prepare("DELETE FROM Question WHERE id = ?")
        .bind(id)
        .run();

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
    await db
      .prepare(
        "UPDATE Question SET isActive = 0, deletedAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?"
      )
      .bind(id)
      .run();

    const updated = await db
      .prepare("SELECT * FROM Question WHERE id = ?")
      .bind(id)
      .first();

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
      id: updated!.id,
      deleted: true,
      mode: "soft",
      isActive: updated!.isActive,
      deletedAt: updated!.deletedAt,
      message: MESSAGES.deleteQuestionBlocked,
    });
  }
);
