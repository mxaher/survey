import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { noStore, fail, apiHandler } from "@/lib/api";
import { getVerifiedEmployee, getEmployeeHmac } from "@/lib/identity";
import { MESSAGES } from "@/lib/messages";
import { isWithinActiveWindow, nowUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * GET /api/employee/executives/[executiveId]/questions
 *
 * Returns the leadership snapshots (`CampaignQuestionSnapshot` where
 * section='leadership' and campaignId=current active campaign) with their
 * option snapshots.
 *
 * Re-validates server-side:
 *   - Auth (401 if no verified employee).
 *   - There IS a currently-active campaign (else MESSAGES.noActiveCampaign /
 *     MESSAGES.campaignClosed).
 *   - The executive is assigned + enabled to the campaign AND active globally
 *     (else MESSAGES.unauthorized).
 *   - The employee has NOT already evaluated this executive (else 409 with
 *     MESSAGES.duplicateExecutive).
 *
 * NEVER returns `employeeHmac`. `Cache-Control: no-store` via `noStore()`.
 */
export const GET = apiHandler(
  async (
    _request: NextRequest,
    ctx: { params: Promise<{ executiveId: string }> }
  ) => {
    const employee = await getVerifiedEmployee();
    if (!employee) return fail(MESSAGES.unauthorized, 401);

    const employeeHmac = await getEmployeeHmac();
    if (!employeeHmac) return fail(MESSAGES.unauthorized, 401);

    const { executiveId } = await ctx.params;

    // Locate the currently-active campaign.
    const now = nowUtc();
    const candidates = await db.campaign.findMany({
      where: { status: "active" },
    });
    const active = candidates.find((c) =>
      isWithinActiveWindow(now, c.startsAt, c.endsAt).active
    );
    if (!active) {
      // Spec: if no active campaign exists, return MESSAGES.noActiveCampaign.
      return fail(MESSAGES.noActiveCampaign, 400);
    }

    // Re-validate: executive assigned + enabled + active.
    const assignment = await db.campaignExecutive.findUnique({
      where: {
        campaignId_executiveId: {
          campaignId: active.id,
          executiveId,
        },
      },
      include: { executive: true },
    });
    if (
      !assignment ||
      !assignment.isEnabled ||
      !assignment.executive ||
      !assignment.executive.isActive ||
      assignment.executive.deletedAt !== null
    ) {
      // Not assigned / disabled / soft-deleted → not authorized for this eval.
      return fail(MESSAGES.unauthorized, 403);
    }

    // Re-validate: employee hasn't already evaluated this executive.
    const existing = await db.participationLedger.findUnique({
      where: {
        campaignId_employeeHmac_participationType_scopeKey: {
          campaignId: active.id,
          employeeHmac,
          participationType: "executive",
          scopeKey: executiveId,
        },
      },
      select: { status: true, submittedAt: true },
    });
    if (existing && existing.status === "submitted") {
      return fail(MESSAGES.duplicateExecutive, 409);
    }

    // Serve frozen leadership snapshots only (immutable from activation).
    const snapshots = await db.campaignQuestionSnapshot.findMany({
      where: { campaignId: active.id, section: "leadership" },
      include: { options: true },
      orderBy: { displayOrder: "asc" },
    });

    const questions = snapshots.map((s) => ({
      snapshotId: s.id,
      originalQuestionId: s.originalQuestionId,
      questionCode: s.questionCode,
      questionAr: s.questionAr,
      questionType: s.questionType,
      section: s.section,
      dimension: s.dimension,
      isRequired: s.isRequired,
      displayOrder: s.displayOrder,
      maxSelections: s.maxSelections,
      options: s.options
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((o) => ({
          id: o.id,
          value: o.value,
          labelAr: o.labelAr,
          score: o.score,
          displayOrder: o.displayOrder,
        })),
    }));

    return noStore({
      campaign: {
        id: active.id,
        titleAr: active.titleAr,
      },
      executive: {
        id: assignment.executive.id,
        nameAr: assignment.executive.nameAr,
        titleAr: assignment.executive.titleAr,
        category: assignment.executive.category,
        departmentAr: assignment.executive.departmentAr,
        displayOrder: assignment.displayOrder,
      },
      questions,
    });
  }
);
