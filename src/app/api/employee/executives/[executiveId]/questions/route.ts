import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { noStore, fail, apiHandler } from "@/lib/api";
import { getVerifiedEmployee, getEmployeeHmac } from "@/lib/identity";
import { MESSAGES } from "@/lib/messages";
import { isWithinActiveWindow, nowUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

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

    const db = getDB();

    const now = nowUtc();
    const { results: candidates } = await db
      .prepare("SELECT * FROM Campaign WHERE status = 'active'")
      .all();
    const active = candidates.find((c: any) =>
      isWithinActiveWindow(now, new Date(c.startsAt), new Date(c.endsAt)).active
    );
    if (!active) {
      return fail(MESSAGES.noActiveCampaign, 400);
    }

    const assignment = await db
      .prepare(
        `SELECT ce.id, ce.displayOrder, ce.isEnabled,
                e.id AS executiveId, e.nameAr, e.titleAr, e.category, e.departmentAr, e.isActive, e.deletedAt
         FROM CampaignExecutive ce
         JOIN Executive e ON e.id = ce.executiveId
         WHERE ce.campaignId = ? AND ce.executiveId = ?`
      )
      .bind(active.id, executiveId)
      .first();

    if (
      !assignment ||
      !assignment.isEnabled ||
      !assignment.isActive ||
      assignment.deletedAt !== null
    ) {
      return fail(MESSAGES.unauthorized, 403);
    }

    const existing = await db
      .prepare(
        "SELECT status, submittedAt FROM ParticipationLedger WHERE campaignId = ? AND employeeHmac = ? AND participationType = 'executive' AND scopeKey = ?"
      )
      .bind(active.id, employeeHmac, executiveId)
      .first();
    if (existing && existing.status === "submitted") {
      return fail(MESSAGES.duplicateExecutive, 409);
    }

    const { results: snapshots } = await db
      .prepare(
        "SELECT * FROM CampaignQuestionSnapshot WHERE campaignId = ? AND section = 'leadership' ORDER BY displayOrder ASC"
      )
      .bind(active.id)
      .all();

    const questions: any[] = [];
    for (const s of snapshots) {
      const { results: options } = await db
        .prepare(
          "SELECT * FROM CampaignQuestionOption WHERE snapshotId = ? ORDER BY displayOrder ASC"
        )
        .bind(s.id)
        .all();
      questions.push({
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
        options: options.map((o: any) => ({
          id: o.id,
          value: o.value,
          labelAr: o.labelAr,
          score: o.score,
          displayOrder: o.displayOrder,
        })),
      });
    }

    return noStore({
      campaign: {
        id: active.id,
        titleAr: active.titleAr,
      },
      executive: {
        id: assignment.executiveId,
        nameAr: assignment.nameAr,
        titleAr: assignment.titleAr,
        category: assignment.category,
        departmentAr: assignment.departmentAr,
        displayOrder: assignment.displayOrder,
      },
      questions,
    });
  }
);
