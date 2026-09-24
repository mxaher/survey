import { getDB } from "@/lib/db";

/**
 * Append a safe audit log entry. NEVER include employee answers or any
 * employee identifier in `metadataJson` — only admin-action context.
 */
export async function writeAudit(params: {
  adminUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  campaignId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const meta =
    params.metadata && Object.keys(params.metadata).length > 0
      ? JSON.stringify(params.metadata)
      : null;

  const db = getDB();
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO AuditLog (id, adminUserId, action, entityType, entityId, campaignId, metadataJson, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(
    id,
    params.adminUserId ?? null,
    params.action,
    params.entityType,
    params.entityId ?? null,
    params.campaignId ?? null,
    meta
  ).run();
}
