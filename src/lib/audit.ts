import { db } from "@/lib/db";

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

  await db.auditLog.create({
    data: {
      adminUserId: params.adminUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      campaignId: params.campaignId ?? null,
      metadataJson: meta,
    },
  });
}
