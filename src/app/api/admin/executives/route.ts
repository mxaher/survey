import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
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
 * Each row includes `_count.campaigns` so the UI can show usage.
 * Ordered by displayOrder asc, nameAr asc.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const url = request.nextUrl;
  const isActiveStr = url.searchParams.get("isActive");
  const search = url.searchParams.get("search") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;

  const where: {
    isActive?: boolean;
    category?: string;
    OR?: Array<Record<string, unknown>>;
  } = {};

  if (isActiveStr === "true") where.isActive = true;
  else if (isActiveStr === "false") where.isActive = false;

  if (category && EXECUTIVE_CATEGORY_KEYS.includes(category as never)) {
    where.category = category;
  }

  if (search && search.trim() !== "") {
    const s = search.trim();
    where.OR = [
      { nameAr: { contains: s } },
      { titleAr: { contains: s } },
      { departmentAr: { contains: s } },
    ];
  }

  const executives = await db.executive.findMany({
    where,
    orderBy: [{ displayOrder: "asc" }, { nameAr: "asc" }],
    include: {
      _count: { select: { campaigns: true } },
    },
  });

  return ok(
    executives.map((e) => ({
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
      campaignCount: e._count.campaigns,
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

  const created = await db.executive.create({
    data: {
      nameAr: input.nameAr,
      titleAr: input.titleAr,
      category: input.category,
      departmentAr: input.departmentAr ?? null,
      displayOrder: input.displayOrder,
      isActive: input.isActive,
    },
  });

  await writeAudit({
    adminUserId: admin.adminId,
    action: "executive.create",
    entityType: "executive",
    entityId: created.id,
    metadata: {
      nameAr: created.nameAr,
      titleAr: created.titleAr,
      category: created.category,
    },
  });

  return ok(
    {
      id: created.id,
      nameAr: created.nameAr,
      titleAr: created.titleAr,
      category: created.category,
      departmentAr: created.departmentAr,
      displayOrder: created.displayOrder,
      isActive: created.isActive,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    },
    { status: 201 }
  );
});
