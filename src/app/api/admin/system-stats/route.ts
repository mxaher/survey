import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { isHmacSecretConfigured } from "@/lib/employee-hmac";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/system-stats
 *
 * Lightweight system-health snapshot for the dashboard widget.
 * Auth required (both roles). Returns:
 *   - dbSizeBytes: size of the D1 database (approximate from pragma).
 *   - dbSizeLabel: human-readable size (KB / MB).
 *   - tableCounts: row counts for each major table.
 *   - lastAuditAt: ISO timestamp of the most recent audit log entry.
 *   - serverTime: current server time (UTC ISO).
 *
 * NO employee identifiers — `participationLedger` is only a count.
 */
export const GET = apiHandler(async () => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const db = getDB();

  // DB size — D1 exposes page_count and page_size via pragma.
  let dbSizeBytes = 0;
  try {
    const row = await db
      .prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()")
      .first<{ size: number }>();
    dbSizeBytes = row?.size ?? 0;
  } catch {
    // Pragma not available — leave at 0.
  }

  const dbSizeLabel = formatBytes(dbSizeBytes);

  // Table counts — batch via Promise.all for speed.
  const [
    campaigns,
    executives,
    questions,
    responses,
    participationLedger,
    auditLogs,
    adminUsers,
    systemSettings,
    snapshots,
  ] = await Promise.all([
    db.prepare("SELECT COUNT(*) as cnt FROM Campaign").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM Executive").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM Question").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM Response").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM ParticipationLedger").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM AuditLog").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM AdminUser").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM SystemSetting").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM CampaignQuestionSnapshot").first<{ cnt: number }>(),
  ]);

  // Last audit entry timestamp.
  const lastAudit = await db
    .prepare("SELECT createdAt FROM AuditLog ORDER BY createdAt DESC LIMIT 1")
    .first<{ createdAt: string }>();

  return ok({
    dbSizeBytes,
    dbSizeLabel,
    tableCounts: {
      campaigns: campaigns?.cnt ?? 0,
      executives: executives?.cnt ?? 0,
      questions: questions?.cnt ?? 0,
      responses: responses?.cnt ?? 0,
      participationLedger: participationLedger?.cnt ?? 0,
      auditLogs: auditLogs?.cnt ?? 0,
      adminUsers: adminUsers?.cnt ?? 0,
      systemSettings: systemSettings?.cnt ?? 0,
      snapshots: snapshots?.cnt ?? 0,
    },
    lastAuditAt: lastAudit?.createdAt ?? null,
    // Whether the real `EMPLOYEE_HMAC_SECRET` worker secret is set (the
    // response only reports its presence, never the value).
    hmacSecretConfigured: isHmacSecretConfigured(),
    serverTime: new Date().toISOString(),
  });
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${units[i]}`;
}
