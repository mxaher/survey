import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/system-stats
 *
 * Lightweight system-health snapshot for the dashboard widget.
 * Auth required (both roles). Returns:
 *   - dbSizeBytes: size of the SQLite database file (from Prisma's url).
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

  // DB file size — read from the DATABASE_URL env (file: path).
  // Fall back to 0 if we can't resolve the path (e.g., in-memory).
  let dbSizeBytes = 0;
  const dbUrl = process.env.DATABASE_URL ?? "";
  const match = dbUrl.match(/file:(.+)/);
  if (match) {
    try {
      const fs = await import("fs");
      const stat = await fs.promises.stat(match[1]);
      dbSizeBytes = stat.size;
    } catch {
      // File not found or not accessible — leave at 0.
    }
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
    db.campaign.count(),
    db.executive.count(),
    db.question.count(),
    db.response.count(),
    db.participationLedger.count(),
    db.auditLog.count(),
    db.adminUser.count(),
    db.systemSetting.count(),
    db.campaignQuestionSnapshot.count(),
  ]);

  // Last audit entry timestamp.
  const lastAudit = await db.auditLog.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  return ok({
    dbSizeBytes,
    dbSizeLabel,
    tableCounts: {
      campaigns,
      executives,
      questions,
      responses,
      participationLedger,
      auditLogs,
      adminUsers,
      systemSettings,
      snapshots,
    },
    lastAuditAt: lastAudit?.createdAt ?? null,
    serverTime: new Date().toISOString(),
  });
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${units[i]}`;
}
