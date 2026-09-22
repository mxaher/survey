import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { noStore, fail, apiHandler } from "@/lib/api";
import { getVerifiedEmployee, getEmployeeHmac } from "@/lib/identity";
import { MESSAGES } from "@/lib/messages";
import { isWithinActiveWindow, nowUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  campaignId: z.string().min(1),
});

/**
 * GET /api/employee/participation-status?campaignId=...
 *
 * Returns:
 *   {
 *     environmentSubmitted: boolean,
 *     futureSubmitted: boolean,
 *     evaluatedExecutiveIds: string[],
 *     allExecutivesEvaluated: boolean
 *   }
 *
 * Computed entirely from the ParticipationLedger rows for the current
 * employee's HMAC (NEVER returned in the response).
 *
 * Auth: 401 if no verified employee. `Cache-Control: no-store` via `noStore()`.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const employee = await getVerifiedEmployee();
  if (!employee) return fail(MESSAGES.unauthorized, 401);

  const employeeHmac = await getEmployeeHmac();
  if (!employeeHmac) return fail(MESSAGES.unauthorized, 401);

  const url = request.nextUrl;
  const parsed = QuerySchema.safeParse({
    campaignId: url.searchParams.get("campaignId") ?? "",
  });
  if (!parsed.success) {
    return fail(MESSAGES.noActiveCampaign, 400);
  }
  const { campaignId } = parsed.data;

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
    },
  });

  if (!campaign || campaign.status !== "active") {
    return fail(MESSAGES.noActiveCampaign, 400);
  }
  const now = nowUtc();
  const window = isWithinActiveWindow(now, campaign.startsAt, campaign.endsAt);
  if (!window.active) {
    return fail(MESSAGES.campaignClosed, 400);
  }

  // All submitted ledger rows for this employee in this campaign.
  const rows = await db.participationLedger.findMany({
    where: {
      campaignId,
      employeeHmac,
      status: "submitted",
    },
    select: {
      participationType: true,
      scopeKey: true,
    },
  });

  const environmentSubmitted = rows.some(
    (r) =>
      r.participationType === "environment" && r.scopeKey === "environment"
  );
  const futureSubmitted = rows.some(
    (r) => r.participationType === "future" && r.scopeKey === "future"
  );
  const evaluatedExecutiveIds = rows
    .filter((r) => r.participationType === "executive" && Boolean(r.scopeKey))
    .map((r) => r.scopeKey as string);

  // Total active executives available for this campaign — used to compute
  // the "all evaluated" flag for the UI's "you're done" hint.
  const totalExecutives = await db.campaignExecutive.count({
    where: {
      campaignId,
      isEnabled: true,
      executive: { isActive: true, deletedAt: null },
    },
  });

  // De-dupe (defensive — same scopeKey shouldn't appear twice due to the
  // unique constraint, but be defensive).
  const evaluatedSet = new Set(evaluatedExecutiveIds);
  const allExecutivesEvaluated =
    totalExecutives > 0 && evaluatedSet.size >= totalExecutives;

  return noStore({
    environmentSubmitted,
    futureSubmitted,
    evaluatedExecutiveIds,
    allExecutivesEvaluated,
  });
});
