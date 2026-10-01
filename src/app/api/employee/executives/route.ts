import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { noStore, fail, apiHandler } from "@/lib/api";
import { getVerifiedEmployee, getEmployeeHmac } from "@/lib/identity";
import { MESSAGES } from "@/lib/messages";
import { isWithinActiveWindow, nowUtc } from "@/lib/time";
import { ASSIGNED_EXECUTIVES_SQL } from "@/lib/employee-queries";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  campaignId: z.string().min(1),
});

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

  const db = getDB();

  const campaign = await db
    .prepare(
      "SELECT id, status, startsAt, endsAt FROM Campaign WHERE id = ?"
    )
    .bind(campaignId)
    .first();

  if (!campaign || campaign.status !== "active") {
    return fail(MESSAGES.noActiveCampaign, 400);
  }
  const now = nowUtc();
  const window = isWithinActiveWindow(
    now,
    new Date(campaign.startsAt as string),
    new Date(campaign.endsAt as string)
  );
  if (!window.active) {
    return fail(MESSAGES.campaignClosed, 400);
  }

  const { results: assignments } = await db
    .prepare(ASSIGNED_EXECUTIVES_SQL)
    .bind(campaignId)
    .all();

  const executives = assignments.map((a: any) => ({
    id: a.executiveId,
    nameAr: a.nameAr,
    titleAr: a.titleAr,
    category: a.category,
    departmentAr: a.departmentAr,
    displayOrder: a.displayOrder,
  }));

  const { results: evaluated } = await db
    .prepare(
      "SELECT scopeKey FROM ParticipationLedger WHERE campaignId = ? AND employeeHmac = ? AND participationType = 'executive' AND status = 'submitted'"
    )
    .bind(campaignId, employeeHmac)
    .all();

  const evaluatedExecutiveIds = evaluated
    .map((r: any) => r.scopeKey)
    .filter((id: any): id is string => Boolean(id));

  return noStore({
    executives,
    evaluatedExecutiveIds,
  });
});
