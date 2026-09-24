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
 * GET /api/admin/questions
 * Lists all questions in the library with optional filters:
 *   - ?section=environment|leadership|future
 *   - ?isActive=true|false
 *   - ?search=<text>  (matches code or questionAr)
 * Each row includes a `campaignConfigCount` so the UI can show how many
 * campaigns use it. Ordered by `displayOrder asc`.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const db = getDB();
  const url = request.nextUrl;
  const section = url.searchParams.get("section") ?? undefined;
  const isActiveStr = url.searchParams.get("isActive");
  const search = url.searchParams.get("search") ?? undefined;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (section && QUESTION_SECTION_KEYS.includes(section as never)) {
    conditions.push("q.section = ?");
    params.push(section);
  }

  if (isActiveStr === "true") {
    conditions.push("q.isActive = 1");
  } else if (isActiveStr === "false") {
    conditions.push("q.isActive = 0");
  }

  if (search && search.trim() !== "") {
    const s = search.trim();
    conditions.push("(q.code LIKE ? OR q.questionAr LIKE ?)");
    params.push(`%${s}%`, `%${s}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { results: questions } = await db
    .prepare(
      `SELECT q.id, q.code, q.questionAr, q.questionType, q.section,
              q.dimension, q.isRequired, q.displayOrder, q.maxSelections,
              q.version, q.parentQuestionId, q.isCurrent, q.isActive,
              q.deletedAt, q.createdAt, q.updatedAt
       FROM Question q
       ${where}
       ORDER BY q.displayOrder ASC, q.code ASC`
    )
    .bind(...params)
    .all();

  const questionIds = questions.map((q: Record<string, unknown>) => q.id as string);

  let configCounts: Record<string, number> = {};
  if (questionIds.length > 0) {
    const placeholders = questionIds.map(() => "?").join(",");
    const { results: counts } = await db
      .prepare(
        `SELECT questionId, COUNT(*) as cnt
         FROM CampaignQuestionConfig
         WHERE questionId IN (${placeholders})
         GROUP BY questionId`
      )
      .bind(...questionIds)
      .all();

    for (const row of counts as Record<string, unknown>[]) {
      configCounts[row.questionId as string] = row.cnt as number;
    }
  }

  return ok(
    questions.map((q: Record<string, unknown>) => ({
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
      campaignConfigCount: configCounts[q.id as string] ?? 0,
    }))
  );
});

/**
 * Zod schema for an option inside a new question.
 */
const optionSchema = z.object({
  value: z.string().trim().min(1, "قيمة الخيار مطلوبة."),
  labelAr: z.string().trim().min(1, "نص الخيار مطلوب."),
  score: z.coerce.number().nullable().optional(),
  displayOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.coerce.boolean().default(true),
});

/**
 * POST /api/admin/questions
 * Create a new question in the library. Validation:
 *   - code: required, unique (returns Arabic error on collision)
 *   - questionAr: non-empty
 *   - questionType: must be in QUESTION_TYPES
 *   - section: must be in QUESTION_SECTIONS
 *   - options: array of { value, labelAr, score?, displayOrder? }
 * Audits `question.create`.
 */
const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "رمز السؤال مطلوب.")
    .max(32, "رمز السؤال طويل جداً."),
  questionAr: z
    .string()
    .trim()
    .min(1, "نص السؤال مطلوب."),
  questionType: z
    .string()
    .refine((v) => QUESTION_TYPE_KEYS.includes(v as never), {
      message: "نوع السؤال غير معروف.",
    }),
  section: z
    .string()
    .refine((v) => QUESTION_SECTION_KEYS.includes(v as never), {
      message: "قسم السؤال غير معروف.",
    }),
  dimension: z.string().trim().optional().nullable(),
  isRequired: z.coerce.boolean().default(true),
  displayOrder: z.coerce.number().int().min(0).default(0),
  maxSelections: z.coerce.number().int().min(1).optional().nullable(),
  isActive: z.coerce.boolean().default(true),
  options: z.array(optionSchema).default([]),
});

export const POST = apiHandler(async (request: NextRequest) => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const json = await request.json().catch(() => null);
  if (!json) return fail("صيغة الطلب غير صالحة.", 400);

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      parsed.error.issues?.[0]?.message ?? MESSAGES.configIncomplete,
      422
    );
  }
  const input = parsed.data;

  const db = getDB();

  // Uniqueness check on code.
  const existing = await db
    .prepare("SELECT id FROM Question WHERE code = ?")
    .bind(input.code)
    .first();
  if (existing) {
    return fail(
      "رمز السؤال مستخدم مسبقاً. يرجى اختيار رمز فريد.",
      409
    );
  }

  const questionId = crypto.randomUUID();
  const sortedOptions = [...input.options].sort(
    (a, b) => a.displayOrder - b.displayOrder
  );

  const statements: any[] = [
    db
      .prepare(
        `INSERT INTO Question (id, code, questionAr, questionType, section, dimension,
         isRequired, displayOrder, maxSelections, isActive, version, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
      )
      .bind(
        questionId,
        input.code,
        input.questionAr,
        input.questionType,
        input.section,
        input.dimension ?? null,
        input.isRequired ? 1 : 0,
        input.displayOrder,
        input.maxSelections ?? null,
        input.isActive ? 1 : 0
      ),
  ];

  for (const opt of sortedOptions) {
    statements.push(
      db
        .prepare(
          `INSERT INTO QuestionOption (id, questionId, value, labelAr, score, displayOrder, isActive)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          questionId,
          opt.value,
          opt.labelAr,
          opt.score ?? null,
          opt.displayOrder,
          opt.isActive ? 1 : 0
        )
    );
  }

  await db.batch(statements);

  // Re-fetch with options for the response.
  const q = await db
    .prepare("SELECT * FROM Question WHERE id = ?")
    .bind(questionId)
    .first();

  const { results: options } = await db
    .prepare(
      "SELECT id, value, labelAr, score, displayOrder, isActive FROM QuestionOption WHERE questionId = ? ORDER BY displayOrder ASC"
    )
    .bind(questionId)
    .all();

  const configCountRow = await db
    .prepare(
      "SELECT COUNT(*) as cnt FROM CampaignQuestionConfig WHERE questionId = ?"
    )
    .bind(questionId)
    .first();

  await writeAudit({
    adminUserId: admin.adminId,
    action: "question.create",
    entityType: "question",
    entityId: questionId,
    metadata: {
      code: input.code,
      questionType: input.questionType,
      section: input.section,
      optionsCount: options.length,
    },
  });

  return ok(
    {
      id: q!.id,
      code: q!.code,
      questionAr: q!.questionAr,
      questionType: q!.questionType,
      section: q!.section,
      dimension: q!.dimension,
      isRequired: q!.isRequired,
      displayOrder: q!.displayOrder,
      maxSelections: q!.maxSelections,
      version: q!.version,
      isActive: q!.isActive,
      createdAt: q!.createdAt,
      updatedAt: q!.updatedAt,
      options: options.map((o: Record<string, unknown>) => ({
        id: o.id,
        value: o.value,
        labelAr: o.labelAr,
        score: o.score,
        displayOrder: o.displayOrder,
        isActive: o.isActive,
      })),
      campaignConfigCount: (configCountRow?.cnt as number) ?? 0,
    },
    { status: 201 }
  );
});
