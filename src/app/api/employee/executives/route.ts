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
 * GET /api/employee/executives?campaignId=...
 *
 * Returns the list of executives assigned+enabled to this campaign
 * (`CampaignExecutive` where `isEnabled=true` AND `executive.isActive=true`,
 * ordered by displayOrder) with fields: id, nameAr, titleAr, category,
 * departmentAr.
 *
 * ALSO returns `evaluatedExecutiveIds: string[]` — the executive IDs this
 * employee has already evaluated (ParticipationLedger rows for
 * campaignId + employeeHmac + participationType='executive' + status='submitted').
 *
 * Auth: 401 with MESSAGES.unauthorized if no verified employee.
 * If the campaign isn't active / is outside its window: 400 with
 * MESSAGES.noActiveCampaign or MESSAGES.campaignClosed.
 *
 * NEVER returns `employeeHmac`. `Cache-Control: no-store` via `noStore()`.
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

  // Assigned + enabled + active executives.
  const assignments = await db.campaignExecutive.findMany({
    where: {
      campaignId,
      isEnabled: true,
      executive: { isActive: true, deletedAt: null },
    },
    include: { executive: true },
    orderBy: { displayOrder: "asc" },
  });

  const executives = assignments.map((a) => ({
    id: a.executive.id,
    nameAr: a.executive.nameAr,
    titleAr: a.executive.titleAr,
    category: a.executive.category,
    departmentAr: a.executive.departmentAr,
    displayOrder: a.displayOrder,
  }));

  // Already-evaluated executive IDs for this employee.
  const evaluated = await db.participationLedger.findMany({
    where: {
      campaignId,
      employeeHmac,
      participationType: "executive",
      status: "submitted",
    },
    select: { scopeKey: true },
  });
  const evaluatedExecutiveIds = evaluated
    .map((r) => r.scopeKey)
    // Defensive: scopeKey is the executiveId for participationType='executive'.
    .filter((id): id is string => Boolean(id));

  return noStore({
    executives,
    evaluatedExecutiveIds,
  });
});
