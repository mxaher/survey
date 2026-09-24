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
 * Helper — returns true iff the executive is referenced by ANY
 * CampaignExecutive row (regardless of campaign status).
 */
async function isReferencedByAnyCampaign(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM CampaignExecutive WHERE executiveId = ?")
    .bind(id)
    .first<{ cnt: number }>();
  return (row?.cnt ?? 0) > 0;
}

/**
 * GET /api/admin/executives/[id]
 * Full detail of one executive.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id } = await ctx.params;

    const e = await db
      .prepare("SELECT * FROM Executive WHERE id = ?")
      .bind(id)
      .first();
    if (!e) return fail("المسؤول غير موجود.", 404);

    const countRow = await db
      .prepare("SELECT COUNT(*) as cnt FROM CampaignExecutive WHERE executiveId = ?")
      .bind(id)
      .first<{ cnt: number }>();

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
      campaignCount: countRow?.cnt ?? 0,
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
      .prepare("SELECT * FROM Executive WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return fail("المسؤول غير موجود.", 404);

    const fields: string[] = [];
    const values: unknown[] = [];
    for (const k of [
      "nameAr",
      "titleAr",
      "category",
      "departmentAr",
      "displayOrder",
      "isActive",
    ]) {
      if (input[k] !== undefined) {
        fields.push(`${k} = ?`);
        values.push(k === "isActive" ? (input[k] ? 1 : 0) : input[k]);
      }
    }

    let updated = existing;
    if (fields.length > 0) {
      values.push(id);
      await db
        .prepare(`UPDATE Executive SET ${fields.join(", ")} WHERE id = ?`)
        .bind(...values)
        .run();

      updated = await db
        .prepare("SELECT * FROM Executive WHERE id = ?")
        .bind(id)
        .first();
    }

    await writeAudit({
      adminUserId: admin.adminId,
      action: "executive.update",
      entityType: "executive",
      entityId: id,
      metadata: {
        fields,
        previous: {
          nameAr: existing.nameAr,
          titleAr: existing.titleAr,
          category: existing.category,
          departmentAr: existing.departmentAr,
          displayOrder: existing.displayOrder,
          isActive: existing.isActive,
        },
        new: {
          nameAr: updated!.nameAr,
          titleAr: updated!.titleAr,
          category: updated!.category,
          departmentAr: updated!.departmentAr,
          displayOrder: updated!.displayOrder,
          isActive: updated!.isActive,
        },
      },
    });

    return ok({
      id: updated!.id,
      nameAr: updated!.nameAr,
      titleAr: updated!.titleAr,
      category: updated!.category,
      departmentAr: updated!.departmentAr,
      displayOrder: updated!.displayOrder,
      isActive: updated!.isActive,
      updatedAt: updated!.updatedAt,
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

    const db = getDB();
    const { id } = await ctx.params;

    const existing = await db
      .prepare("SELECT id, nameAr, titleAr, isActive, deletedAt FROM Executive WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return fail("المسؤول غير موجود.", 404);

    const referenced = await isReferencedByAnyCampaign(db, id);

    if (referenced) {
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

    await db.prepare("DELETE FROM Executive WHERE id = ?").bind(id).run();

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
