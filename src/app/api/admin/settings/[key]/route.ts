import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";
import {
  auditValueFor,
  toPublicSetting,
  validateSettingValue,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  valueAr: z.string().trim().min(1, "القيمة مطلوبة."),
});

/**
 * GET /api/admin/settings/[key]
 * Returns one system setting by key. Auth required (both roles).
 * Secret values are redacted — see `toPublicSetting`.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ key: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { key } = await ctx.params;
    const setting = await db
      .prepare("SELECT * FROM SystemSetting WHERE key = ?")
      .bind(key)
      .first();
    if (!setting) return fail("الإعداد غير موجود.", 404);

    return ok(toPublicSetting(setting));
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

    const db = getDB();
    const { key } = await ctx.params;
    const json = await request.json().catch(() => null);
    if (!json || typeof json !== "object") {
      return fail("صيغة الطلب غير صالحة.", 400);
    }

    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues?.[0]?.message ?? "صيغة الطلب غير صالحة.", 422);
    }

    const invalid = validateSettingValue(key, parsed.data.valueAr);
    if (invalid) return fail(invalid, 422);

    const existing = await db
      .prepare("SELECT * FROM SystemSetting WHERE key = ?")
      .bind(key)
      .first();
    if (!existing) return fail("الإعداد غير موجود.", 404);

    await db
      .prepare(
        "UPDATE SystemSetting SET valueAr = ?, updatedAt = datetime('now') WHERE key = ?"
      )
      .bind(parsed.data.valueAr, key)
      .run();

    const updated = await db
      .prepare("SELECT * FROM SystemSetting WHERE key = ?")
      .bind(key)
      .first();

    await writeAudit({
      adminUserId: admin.adminId,
      action: "settings.update",
      entityType: "system_setting",
      entityId: updated.id,
      metadata: {
        key,
        // Redacted for secret keys — the audit trail records *that* the key
        // changed, never the previous credential.
        previousValueAr: auditValueFor(key, existing.valueAr),
      },
    });

    return ok(toPublicSetting(updated));
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

    const db = getDB();
    const { key } = await ctx.params;
    const existing = await db
      .prepare("SELECT * FROM SystemSetting WHERE key = ?")
      .bind(key)
      .first();
    if (!existing) return fail("الإعداد غير موجود.", 404);

    await db.prepare("DELETE FROM SystemSetting WHERE key = ?").bind(key).run();

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
