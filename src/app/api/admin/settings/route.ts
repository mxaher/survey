import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/settings
 * Returns all SystemSetting rows. Auth required (both roles).
 */
export const GET = apiHandler(async () => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const db = getDB();

  const settings = await db
    .prepare("SELECT * FROM SystemSetting ORDER BY key ASC")
    .all();

  return ok({
    settings: (settings.results ?? []).map((s) => ({
      id: s.id,
      key: s.key,
      valueAr: s.valueAr,
      updatedAt: s.updatedAt,
    })),
  });
});

const upsertSchema = z.object({
  key: z.string().trim().min(1, "المفتاح مطلوب."),
  valueAr: z.string().trim().min(1, "القيمة مطلوبة."),
});

/**
 * POST /api/admin/settings
 * Upsert a system setting by key. Auth required (both roles).
 * Audited as `settings.update`.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const db = getDB();

  const json = await request.json().catch(() => null);
  if (!json || typeof json !== "object") {
    return fail("صيغة الطلب غير صالحة.", 400);
  }

  const parsed = upsertSchema.safeParse(json);
  if (!parsed.success) {
    return fail(parsed.error.issues?.[0]?.message ?? "صيغة الطلب غير صالحة.", 422);
  }
  const { key, valueAr } = parsed.data;

  const existing = await db
    .prepare("SELECT id FROM SystemSetting WHERE key = ?")
    .bind(key)
    .first();

  const id = existing?.id ?? crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO SystemSetting (id, key, valueAr, updatedAt) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET valueAr = ?, updatedAt = datetime('now')"
    )
    .bind(id, key, valueAr, valueAr)
    .run();

  const setting = await db
    .prepare("SELECT * FROM SystemSetting WHERE key = ?")
    .bind(key)
    .first();

  await writeAudit({
    adminUserId: admin.adminId,
    action: "settings.update",
    entityType: "system_setting",
    entityId: id,
    metadata: {
      key,
      created: !existing,
    },
  });

  return ok({
    id: setting.id,
    key: setting.key,
    valueAr: setting.valueAr,
    updatedAt: setting.updatedAt,
  });
});
