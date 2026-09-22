import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  valueAr: z.string().trim().min(1, "القيمة مطلوبة."),
});

/**
 * GET /api/admin/settings/[key]
 * Returns one system setting by key. Auth required (both roles).
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ key: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { key } = await ctx.params;
    const setting = await db.systemSetting.findUnique({ where: { key } });
    if (!setting) return fail("الإعداد غير موجود.", 404);

    return ok({
      id: setting.id,
      key: setting.key,
      valueAr: setting.valueAr,
      updatedAt: setting.updatedAt,
    });
  }
);

/**
 * PATCH /api/admin/settings/[key]
 * Update valueAr for an existing setting. Auth + audit `settings.update`.
 */
export const PATCH = apiHandler(
  async (request: NextRequest, ctx: { params: Promise<{ key: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { key } = await ctx.params;
    const json = await request.json().catch(() => null);
    if (!json || typeof json !== "object") {
      return fail("صيغة الطلب غير صالحة.", 400);
    }

    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues?.[0]?.message ?? "صيغة الطلب غير صالحة.", 422);
    }

    const existing = await db.systemSetting.findUnique({ where: { key } });
    if (!existing) return fail("الإعداد غير موجود.", 404);

    const updated = await db.systemSetting.update({
      where: { key },
      data: { valueAr: parsed.data.valueAr },
    });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "settings.update",
      entityType: "system_setting",
      entityId: updated.id,
      metadata: {
        key,
        previousValueAr: existing.valueAr,
      },
    });

    return ok({
      id: updated.id,
      key: updated.key,
      valueAr: updated.valueAr,
      updatedAt: updated.updatedAt,
    });
  }
);

/**
 * DELETE /api/admin/settings/[key]
 * Remove a system setting. Auth + audit `settings.delete`.
 */
export const DELETE = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ key: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { key } = await ctx.params;
    const existing = await db.systemSetting.findUnique({ where: { key } });
    if (!existing) return fail("الإعداد غير موجود.", 404);

    await db.systemSetting.delete({ where: { key } });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "settings.delete",
      entityType: "system_setting",
      entityId: existing.id,
      metadata: { key },
    });

    return ok({ id: existing.id, key, deleted: true });
  }
);
