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
 * Helper — returns true iff the executive is referenced by ANY
 * CampaignExecutive row (regardless of campaign status).
 */
async function isReferencedByAnyCampaign(id: string): Promise<boolean> {
  const count = await db.campaignExecutive.count({
    where: { executiveId: id },
  });
  return count > 0;
}

/**
 * GET /api/admin/executives/[id]
 * Full detail of one executive.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;
    const e = await db.executive.findUnique({
      where: { id },
      include: { _count: { select: { campaigns: true } } },
    });
    if (!e) return fail("المسؤول غير موجود.", 404);

    return ok({
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
    });
  }
);

/**
 * PATCH /api/admin/executives/[id]
 * Update editable fields. Audits `executive.update`.
 *
 * There is no structural lock here (executive identity does not impact
 * historical responses — responses reference the executiveId directly,
 * which is immutable once created).
 */
const patchSchema = z.object({
  nameAr: z.string().trim().min(1, "اسم المسؤول مطلوب.").optional(),
  titleAr: z.string().trim().min(1, "المسمى الوظيفي مطلوب.").optional(),
  category: z
    .string()
    .refine((v) => EXECUTIVE_CATEGORY_KEYS.includes(v as never), {
      message: "فئة المسؤول غير معروفة.",
    })
    .optional(),
  departmentAr: z.string().trim().optional().nullable(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  isActive: z.coerce.boolean().optional(),
});

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

    const existing = await db.executive.findUnique({ where: { id } });
    if (!existing) return fail("المسؤول غير موجود.", 404);

    const data: Record<string, unknown> = {};
    for (const k of [
      "nameAr",
      "titleAr",
      "category",
      "departmentAr",
      "displayOrder",
      "isActive",
    ]) {
      if (input[k] !== undefined) data[k] = input[k];
    }

    const updated =
      Object.keys(data).length > 0
        ? await db.executive.update({
            where: { id },
            data: data as Parameters<typeof db.executive.update>[0]["data"],
          })
        : existing;

    await writeAudit({
      adminUserId: admin.adminId,
      action: "executive.update",
      entityType: "executive",
      entityId: id,
      metadata: {
        fields: Object.keys(data),
        previous: {
          nameAr: existing.nameAr,
          titleAr: existing.titleAr,
          category: existing.category,
          departmentAr: existing.departmentAr,
          displayOrder: existing.displayOrder,
          isActive: existing.isActive,
        },
        new: {
          nameAr: updated.nameAr,
          titleAr: updated.titleAr,
          category: updated.category,
          departmentAr: updated.departmentAr,
          displayOrder: updated.displayOrder,
          isActive: updated.isActive,
        },
      },
    });

    return ok({
      id: updated.id,
      nameAr: updated.nameAr,
      titleAr: updated.titleAr,
      category: updated.category,
      departmentAr: updated.departmentAr,
      displayOrder: updated.displayOrder,
      isActive: updated.isActive,
      updatedAt: updated.updatedAt,
    });
  }
);

/**
 * DELETE /api/admin/executives/[id]
 *
 * - Hard delete IF the executive is NOT referenced by any CampaignExecutive.
 * - Otherwise: refuse with MESSAGES.removeExecutiveFromActiveWithHistory
 *   (do NOT auto-soft-delete the global executive registry — the spec
 *   expects the admin to remove per-campaign assignments instead).
 *
 * Audits `executive.delete` for hard deletes; for the refused case, audits
 * `executive.delete_refused` for traceability.
 */
export const DELETE = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;
    const existing = await db.executive.findUnique({
      where: { id },
      select: { id: true, nameAr: true, titleAr: true, isActive: true, deletedAt: true },
    });
    if (!existing) return fail("المسؤول غير موجود.", 404);

    const referenced = await isReferencedByAnyCampaign(id);

    if (referenced) {
      // Refuse to hard-delete because removing the global row would orphan
      // historical CampaignExecutive references (and possibly Response rows
      // whose `executiveId` points to this executive). The admin should
      // instead remove/disable the per-campaign assignment.
      await writeAudit({
        adminUserId: admin.adminId,
        action: "executive.delete_refused",
        entityType: "executive",
        entityId: id,
        metadata: {
          nameAr: existing.nameAr,
          reason: "referenced_by_campaign_executive",
        },
      });
      return fail(
        MESSAGES.removeExecutiveFromActiveWithHistory,
        400,
        { mode: "refused", referenced: true }
      );
    }

    await db.executive.delete({ where: { id } });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "executive.delete",
      entityType: "executive",
      entityId: id,
      metadata: {
        nameAr: existing.nameAr,
        titleAr: existing.titleAr,
        mode: "hard",
      },
    });

    return ok({ id, deleted: true, mode: "hard" });
  }
);
