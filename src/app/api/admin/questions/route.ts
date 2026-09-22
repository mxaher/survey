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
 * GET /api/admin/questions
 * Lists all questions in the library with optional filters:
 *   - ?section=environment|leadership|future
 *   - ?isActive=true|false
 *   - ?search=<text>  (matches code or questionAr)
 * Each row includes a `_count.campaignConfig` so the UI can show how many
 * campaigns use it. Ordered by `displayOrder asc`.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const url = request.nextUrl;
  const section = url.searchParams.get("section") ?? undefined;
  const isActiveStr = url.searchParams.get("isActive");
  const search = url.searchParams.get("search") ?? undefined;

  const where: {
    section?: string;
    isActive?: boolean;
    OR?: Array<Record<string, unknown>>;
  } = {};

  if (section && QUESTION_SECTION_KEYS.includes(section as never)) {
    where.section = section;
  }
  if (isActiveStr === "true") where.isActive = true;
  else if (isActiveStr === "false") where.isActive = false;

  if (search && search.trim() !== "") {
    const s = search.trim();
    where.OR = [
      { code: { contains: s } },
      { questionAr: { contains: s } },
    ];
  }

  const questions = await db.question.findMany({
    where,
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    include: {
      _count: { select: { campaignConfig: true } },
    },
  });

  return ok(
    questions.map((q) => ({
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
      campaignConfigCount: q._count.campaignConfig,
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

  // Uniqueness check on code.
  const existing = await db.question.findUnique({
    where: { code: input.code },
    select: { id: true, deletedAt: true },
  });
  if (existing) {
    return fail(
      "رمز السؤال مستخدم مسبقاً. يرجى اختيار رمز فريد.",
      409
    );
  }

  const created = await db.$transaction(async (tx) => {
    const q = await tx.question.create({
      data: {
        code: input.code,
        questionAr: input.questionAr,
        questionType: input.questionType,
        section: input.section,
        dimension: input.dimension ?? null,
        isRequired: input.isRequired,
        displayOrder: input.displayOrder,
        maxSelections: input.maxSelections ?? null,
        isActive: input.isActive,
        version: 1,
      },
    });

    if (input.options.length > 0) {
      // Insert all options in displayOrder for stability.
      const sorted = [...input.options].sort(
        (a, b) => a.displayOrder - b.displayOrder
      );
      for (const opt of sorted) {
        await tx.questionOption.create({
          data: {
            questionId: q.id,
            value: opt.value,
            labelAr: opt.labelAr,
            score: opt.score ?? null,
            displayOrder: opt.displayOrder,
            isActive: opt.isActive,
          },
        });
      }
    }

    return q;
  });

  // Re-fetch with options for the response.
  const withOptions = await db.question.findUnique({
    where: { id: created.id },
    include: {
      options: { orderBy: { displayOrder: "asc" } },
      _count: { select: { campaignConfig: true } },
    },
  });

  await writeAudit({
    adminUserId: admin.adminId,
    action: "question.create",
    entityType: "question",
    entityId: created.id,
    metadata: {
      code: created.code,
      questionType: created.questionType,
      section: created.section,
      optionsCount: withOptions?.options.length ?? 0,
    },
  });

  return ok(
    {
      id: withOptions?.id,
      code: withOptions?.code,
      questionAr: withOptions?.questionAr,
      questionType: withOptions?.questionType,
      section: withOptions?.section,
      dimension: withOptions?.dimension,
      isRequired: withOptions?.isRequired,
      displayOrder: withOptions?.displayOrder,
      maxSelections: withOptions?.maxSelections,
      version: withOptions?.version,
      isActive: withOptions?.isActive,
      createdAt: withOptions?.createdAt,
      updatedAt: withOptions?.updatedAt,
      options: withOptions?.options.map((o) => ({
        id: o.id,
        value: o.value,
        labelAr: o.labelAr,
        score: o.score,
        displayOrder: o.displayOrder,
        isActive: o.isActive,
      })),
      campaignConfigCount: withOptions?._count.campaignConfig ?? 0,
    },
    { status: 201 }
  );
});
