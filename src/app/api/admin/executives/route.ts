import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";
import { EXECUTIVE_CATEGORIES } from "@/lib/constants";

export const dynamic = "force-dynamic";

const EXECUTIVE_CATEGORY_KEYS = EXECUTIVE_CATEGORIES.map((c) => c.key);

/**
 * GET /api/admin/executives
 * Lists all executives with optional filters:
 *   - ?isActive=true|false
 *   - ?search=<text> (matches nameAr/titleAr/departmentAr)
 *   - ?category=ceo|executive|manager|department_head
 * Each row includes campaignCount so the UI can show usage.
 * Ordered by displayOrder asc, nameAr asc.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const db = getDB();
  const url = request.nextUrl;
  const isActiveStr = url.searchParams.get("isActive");
  const search = url.searchParams.get("search") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (isActiveStr === "true") {
    conditions.push("e.isActive = 1");
  } else if (isActiveStr === "false") {
    conditions.push("e.isActive = 0");
  }

  if (category && EXECUTIVE_CATEGORY_KEYS.includes(category as never)) {
    conditions.push("e.category = ?");
    params.push(category);
  }

  if (search && search.trim() !== "") {
    const s = search.trim();
    conditions.push("(e.nameAr LIKE ? OR e.titleAr LIKE ? OR e.departmentAr LIKE ?)");
    params.push(`%${s}%`, `%${s}%`, `%${s}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { results: executives } = await db
    .prepare(
      `SELECT e.id, e.nameAr, e.titleAr, e.category, e.departmentAr,
              e.displayOrder, e.isActive, e.deletedAt, e.createdAt, e.updatedAt
       FROM Executive e
       ${where}
       ORDER BY e.displayOrder ASC, e.nameAr ASC`
    )
    .bind(...params)
    .all();

  const executiveIds = executives.map((e: Record<string, unknown>) => e.id);

  let campaignCounts: Record<string, number> = {};
  if (executiveIds.length > 0) {
    const placeholders = executiveIds.map(() => "?").join(",");
    const { results: counts } = await db
      .prepare(
        `SELECT executiveId, COUNT(*) as cnt
         FROM CampaignExecutive
         WHERE executiveId IN (${placeholders})
         GROUP BY executiveId`
      )
      .bind(...executiveIds)
      .all();

    for (const row of counts as Record<string, unknown>[]) {
      campaignCounts[row.executiveId as string] = row.cnt as number;
    }
  }

  return ok(
    executives.map((e: Record<string, unknown>) => ({
      id: e.id,
      nameAr: e.nameAr,
      titleAr: e.titleAr,
      category: e.category,
      departmentAr: e.departmentAr,
      displayOrder: e.displayOrder,
      isActive: e.isActive,
      deletedAt: e.deletedAt,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      campaignCount: campaignCounts[e.id as string] ?? 0,
    }))
  );
});

/**
 * POST /api/admin/executives
 * Create a new executive.
 *   - nameAr: non-empty
 *   - titleAr: non-empty
 *   - category: must be in EXECUTIVE_CATEGORIES
 * Audits `executive.create`.
 */
const createSchema = z.object({
  nameAr: z
    .string()
    .trim()
    .min(1, "اسم المسؤول مطلوب."),
  titleAr: z
    .string()
    .trim()
    .min(1, "المسمى الوظيفي مطلوب."),
  category: z
    .string()
    .refine((v) => EXECUTIVE_CATEGORY_KEYS.includes(v as never), {
      message: "فئة المسؤول غير معروفة.",
    }),
  departmentAr: z.string().trim().optional().nullable(),
  displayOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.coerce.boolean().default(true),
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

  const { meta } = await db
    .prepare(
      `INSERT INTO Executive (id, nameAr, titleAr, category, departmentAr, displayOrder, isActive, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      crypto.randomUUID(),
      input.nameAr,
      input.titleAr,
      input.category,
      input.departmentAr ?? null,
      input.displayOrder,
      input.isActive ? 1 : 0
    )
    .run();

  const created = await db
    .prepare("SELECT * FROM Executive WHERE id = ?")
    .bind(meta.last_row_id as string)
    .first();

  await writeAudit({
    adminUserId: admin.adminId,
    action: "executive.create",
    entityType: "executive",
    entityId: created!.id as string,
    metadata: {
      nameAr: created!.nameAr,
      titleAr: created!.titleAr,
      category: created!.category,
    },
  });

  return ok(
    {
      id: created!.id,
      nameAr: created!.nameAr,
      titleAr: created!.titleAr,
      category: created!.category,
      departmentAr: created!.departmentAr,
      displayOrder: created!.displayOrder,
      isActive: created!.isActive,
      createdAt: created!.createdAt,
      updatedAt: created!.updatedAt,
    },
    { status: 201 }
  );
});
