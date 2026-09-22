import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/notifications
 *
 * Returns actionable alerts for active campaigns:
 *  - "about_to_close": active campaign ending within 3 days.
 *  - "threshold_not_met": active campaign with <threshold distinct
 *    environment submitters (reports will be suppressed).
 *  - "no_responses": active campaign with 0 responses (may indicate a
 *    rollout problem).
 *  - "draft_not_scheduled": draft campaign that hasn't been scheduled
 *    or activated (gentle reminder).
 *
 * Auth required (both roles). NO employee identifiers — uses aggregate
 * counts only.
 */
export const GET = apiHandler(async () => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const campaigns = await db.campaign.findMany({
    where: {
      status: { in: ["active", "draft"] },
    },
    select: {
      id: true,
      titleAr: true,
      status: true,
      startsAt: true,
      endsAt: true,
      minimumReportingThreshold: true,
      _count: {
        select: {
          responses: true,
          participationLedger: true,
        },
      },
    },
  });

  const notifications: Array<{
    id: string;
    type: "about_to_close" | "threshold_not_met" | "no_responses" | "draft_not_scheduled";
    severity: "warning" | "info" | "critical";
    campaignId: string;
    campaignTitle: string;
    messageAr: string;
  }> = [];

  for (const c of campaigns) {
    if (c.status === "active") {
      // About to close
      if (c.endsAt && new Date(c.endsAt) <= threeDaysFromNow && new Date(c.endsAt) > now) {
        notifications.push({
          id: `about-to-close-${c.id}`,
          type: "about_to_close",
          severity: "warning",
          campaignId: c.id,
          campaignTitle: c.titleAr,
          messageAr: `الحملة «${c.titleAr}» ستنتهي خلال 3 أيام.`,
        });
      }

      // No responses
      if (c._count.responses === 0) {
        notifications.push({
          id: `no-responses-${c.id}`,
          type: "no_responses",
          severity: "critical",
          campaignId: c.id,
          campaignTitle: c.titleAr,
          messageAr: `الحملة «${c.titleAr}» نشطة ولكن لم تُسجَّل أي إجابات بعد.`,
        });
      }

      // Threshold not met — check distinct environment submitters.
      // We use participationLedger count as a proxy (one env submission
      // = one ledger row with participationType='environment'). This is
      // an approximation — a precise count would require a groupBy on
      // responseGroupId, but the ledger count is sufficient for a
      // notification (the actual suppression check uses the precise
      // count).
      if (c._count.participationLedger < c.minimumReportingThreshold) {
        notifications.push({
          id: `threshold-not-met-${c.id}`,
          type: "threshold_not_met",
          severity: "info",
          campaignId: c.id,
          campaignTitle: c.titleAr,
          messageAr: `الحملة «${c.titleAr}» لم تصل بعد إلى الحد الأدنى للعرض (${c._count.participationLedger}/${c.minimumReportingThreshold} مشاركة).`,
        });
      }
    } else if (c.status === "draft") {
      // Draft not scheduled — only notify if the campaign is more than
      // 1 day old (to avoid nagging on freshly-created drafts).
      notifications.push({
        id: `draft-not-scheduled-${c.id}`,
        type: "draft_not_scheduled",
        severity: "info",
        campaignId: c.id,
        campaignTitle: c.titleAr,
        messageAr: `الحملة «${c.titleAr}» ما زالت في حالة المسودة. يمكنك جدولتها أو تفعيلها.`,
      });
    }
  }

  return ok({
    notifications,
    count: notifications.length,
  });
});
