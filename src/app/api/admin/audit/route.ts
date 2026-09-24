import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

const listSchema = z.object({
  campaignId: z.string().trim().optional(),
  action: z.string().trim().optional(),
  entityType: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/admin/audit
 *
 * Paginated audit log (latest first). Auth required (both roles).
 *
 * Query params:
 *   - campaignId (optional filter)
 *   - action     (optional filter — exact match)
 *   - entityType (optional filter — exact match)
 *   - page       (default 1)
 *   - pageSize   (default 50, max 200)
 *
 * Each row is enriched with the actor's `displayName` (or `externalId`
 * when displayName is null) by joining `AdminUser` in JS — the
 * `AuditLog.adminUserId` column is a plain string FK with no Prisma
 * relation defined, so we collect distinct adminUserIds from the page
 * and look them up in a single query. `metadataJson` is parsed and
 * returned as `metadata` (object|null) — the writer convention (see
 * `src/lib/audit.ts`) guarantees this never contains employee data, so
 * it's safe to expose.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const parsed = listSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return fail(parsed.error.issues?.[0]?.message ?? "صيغة الطلب غير صالحة.", 422);
  }
  const { campaignId, action, entityType, page, pageSize } = parsed.data;

  const db = getDB();

  // Build WHERE clause dynamically
  const conditions: string[] = [];
  const bindValues: unknown[] = [];
  if (campaignId) {
    conditions.push("campaignId = ?");
    bindValues.push(campaignId);
  }
  if (action) {
    conditions.push("action = ?");
    bindValues.push(action);
  }
  if (entityType) {
    conditions.push("entityType = ?");
    bindValues.push(entityType);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count total
  const totalRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM AuditLog ${whereClause}`)
    .bind(...bindValues)
    .first();
  const total = (totalRow?.cnt as number) ?? 0;

  // Paginated entries
  const offset = (page - 1) * pageSize;
  const entries = await db
    .prepare(
      `SELECT * FROM AuditLog ${whereClause} ORDER BY createdAt DESC LIMIT ? OFFSET ?`
    )
    .bind(...bindValues, pageSize, offset)
    .all();

  // Lookup admin users in one query (no Prisma relation between
  // AuditLog and AdminUser — adminUserId is a plain string FK).
  const adminIds = Array.from(
    new Set(
      (entries.results ?? [])
        .map((e) => e.adminUserId)
        .filter(Boolean) as string[]
    )
  );
  let adminUserById = new Map<string, Record<string, unknown>>();
  if (adminIds.length > 0) {
    const placeholders = adminIds.map(() => "?").join(", ");
    const adminUsers = await db
      .prepare(
        `SELECT id, displayName, externalId, role FROM AdminUser WHERE id IN (${placeholders})`
      )
      .bind(...adminIds)
      .all();
    adminUserById = new Map(
      (adminUsers.results ?? []).map((u) => [u.id as string, u])
    );
  }

  const items = (entries.results ?? []).map((e) => {
    let metadata: unknown = null;
    if (e.metadataJson) {
      try {
        metadata = JSON.parse(e.metadataJson as string);
      } catch {
        metadata = e.metadataJson; // fall back to raw string
      }
    }
    const adminUser = e.adminUserId
      ? (adminUserById.get(e.adminUserId as string) ?? null)
      : null;
    return {
      id: e.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      campaignId: e.campaignId,
      metadata,
      createdAt: e.createdAt,
      adminUser: adminUser
        ? {
            id: adminUser.id,
            displayName: adminUser.displayName ?? adminUser.externalId,
            externalId: adminUser.externalId,
            role: adminUser.role,
          }
        : null,
    };
  });

  return ok({
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});
