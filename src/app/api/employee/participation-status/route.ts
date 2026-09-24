import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { noStore, fail, apiHandler } from "@/lib/api";
import { getVerifiedEmployee, getEmployeeHmac } from "@/lib/identity";
import { MESSAGES } from "@/lib/messages";
import { isWithinActiveWindow, nowUtc } from "@/lib/time";

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

  const { results: rows } = await db
    .prepare(
      "SELECT participationType, scopeKey FROM ParticipationLedger WHERE campaignId = ? AND employeeHmac = ? AND status = 'submitted'"
    )
    .bind(campaignId, employeeHmac)
    .all();

  const environmentSubmitted = rows.some(
    (r: any) =>
      r.participationType === "environment" && r.scopeKey === "environment"
  );
  const futureSubmitted = rows.some(
    (r: any) => r.participationType === "future" && r.scopeKey === "future"
  );
  const evaluatedExecutiveIds = rows
    .filter(
      (r: any) => r.participationType === "executive" && Boolean(r.scopeKey)
    )
    .map((r: any) => r.scopeKey as string);

  const { totalExecutives } = (await db
    .prepare(
      `SELECT COUNT(*) AS totalExecutives
       FROM CampaignExecutive ce
       JOIN Executive e ON e.id = ce.executiveId
       WHERE ce.campaignId = ? AND ce.isEnabled = 1 AND e.isActive = 1 AND e.deletedAt IS NULL`
    )
    .bind(campaignId)
    .first()) as any;

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
