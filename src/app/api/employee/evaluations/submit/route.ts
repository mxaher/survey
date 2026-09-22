import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, noStore, apiHandler } from "@/lib/api";
import { getVerifiedEmployee, getEmployeeHmac } from "@/lib/identity";
import { MESSAGES } from "@/lib/messages";
import { isWithinActiveWindow, nowUtc } from "@/lib/time";
import { newResponseGroupId } from "@/lib/employee-hmac";

export const dynamic = "force-dynamic";

const AnswerSchema = z.object({
  questionSnapshotId: z.string().min(1),
  selectedValue: z.string().min(1),
});

const BodySchema = z.object({
  campaignId: z.string().min(1),
  executiveId: z.string().min(1),
  answers: z.array(AnswerSchema).min(1),
});

/**
 * POST /api/employee/evaluations/submit
 *
 * Body: `{ campaignId, executiveId, answers: [{ questionSnapshotId, selectedValue }] }`
 *
 * Flow (spec §13):
 *   1. Auth.
 *   2. Load campaign; reject if not active / outside window →
 *      MESSAGES.campaignClosed.
 *   3. Validate executive is assigned+enabled to the campaign; reject with
 *      MESSAGES.unauthorized if not.
 *   4. Validate every required leadership snapshot has an answer →
 *      MESSAGES.incompleteAnswers.
 *   5. Validate each `selectedValue` exists in the snapshot's option set;
 *      compute `selectedScore` (null for not_applicable).
 *   6. `db.$transaction`:
 *      - Insert ParticipationLedger (participationType='executive',
 *        scopeKey=executiveId, executiveId=executiveId, status='submitted').
 *        P2002 → 409 with MESSAGES.duplicateExecutive.
 *      - Fresh responseGroupId.
 *      - Insert one Response row per answer with executiveId,
 *        responseType='executive'.
 *   7. Return MESSAGES.submissionSuccess. No internal tokens exposed.
 *
 * NEVER returns `employeeHmac`. `Cache-Control: no-store` on all paths.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const employee = await getVerifiedEmployee();
  if (!employee) return fail(MESSAGES.unauthorized, 401);

  const employeeHmac = await getEmployeeHmac();
  if (!employeeHmac) return fail(MESSAGES.unauthorized, 401);

  // Parse + validate body shape.
  let body: z.infer<typeof BodySchema>;
  try {
    const json = await request.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return fail(MESSAGES.incompleteAnswers, 400);
    }
    body = parsed.data;
  } catch {
    return fail(MESSAGES.incompleteAnswers, 400);
  }

  // Load campaign.
  const campaign = await db.campaign.findUnique({
    where: { id: body.campaignId },
    select: { id: true, status: true, startsAt: true, endsAt: true },
  });
  if (!campaign || campaign.status !== "active") {
    return fail(MESSAGES.campaignClosed, 400);
  }
  const now = nowUtc();
  const window = isWithinActiveWindow(now, campaign.startsAt, campaign.endsAt);
  if (!window.active) {
    return fail(MESSAGES.campaignClosed, 400);
  }

  // 3. Validate executive is assigned + enabled + active globally.
  const assignment = await db.campaignExecutive.findUnique({
    where: {
      campaignId_executiveId: {
        campaignId: campaign.id,
        executiveId: body.executiveId,
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
    // Not authorized to evaluate this executive in this campaign.
    return fail(MESSAGES.unauthorized, 403);
  }

  // Load all leadership-section frozen snapshots for this campaign.
  const snapshots = await db.campaignQuestionSnapshot.findMany({
    where: { campaignId: campaign.id, section: "leadership" },
    include: { options: true },
  });
  const snapshotMap = new Map(snapshots.map((s) => [s.id, s]));

  // 4. Validate every required leadership snapshot has an answer.
  const answeredIds = new Set(body.answers.map((a) => a.questionSnapshotId));
  const missingRequired = snapshots.filter(
    (s) => s.isRequired && !answeredIds.has(s.id)
  );
  if (missingRequired.length > 0) {
    return fail(MESSAGES.incompleteAnswers, 400);
  }

  // 5. Validate each answer's selectedValue + compute selectedScore.
  type ResponseRow = {
    questionSnapshotId: string;
    selectedValue: string;
    selectedScore: number | null;
  };
  const responseRows: ResponseRow[] = [];

  for (const ans of body.answers) {
    const snapshot = snapshotMap.get(ans.questionSnapshotId);
    if (!snapshot) {
      // References a snapshot that doesn't belong to this campaign's
      // leadership section — treat as incomplete.
      return fail(MESSAGES.incompleteAnswers, 400);
    }
    const matched = snapshot.options.find((o) => o.value === ans.selectedValue);
    if (!matched) {
      return fail(MESSAGES.incompleteAnswers, 400);
    }
    responseRows.push({
      questionSnapshotId: snapshot.id,
      selectedValue: ans.selectedValue,
      selectedScore:
        matched.score === null || matched.score === undefined
          ? null
          : Number(matched.score),
    });
  }

  // 6. Atomic insert.
  try {
    await db.$transaction(async (tx) => {
      // 6a. Insert ledger row first — duplicate gate.
      //     scopeKey = executiveId (per schema comment).
      await tx.participationLedger.create({
        data: {
          campaignId: campaign.id,
          executiveId: body.executiveId,
          employeeHmac,
          participationType: "executive",
          scopeKey: body.executiveId,
          status: "submitted",
          submittedAt: now,
        },
      });

      // 6b. Fresh responseGroupId — random, not identity-derived.
      const responseGroupId = newResponseGroupId();

      // 6c. Insert one Response row per answer (with executiveId +
      //     responseType='executive'). NO employeeHmac on responses.
      await tx.response.createMany({
        data: responseRows.map((r) => ({
          campaignId: campaign.id,
          executiveId: body.executiveId,
          responseGroupId,
          questionSnapshotId: r.questionSnapshotId,
          selectedValue: r.selectedValue,
          selectedScore: r.selectedScore,
          responseType: "executive",
          submittedAt: now,
        })),
      });

      return responseGroupId;
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return fail(MESSAGES.duplicateExecutive, 409);
    }
    console.error(
      "[employee/evaluations] submit failed",
      {
        campaignId: campaign.id,
        executiveId: body.executiveId,
        errorName: (err as Error)?.name,
      }
    );
    throw err;
  }

  // 7. Success — message only, no internal tokens.
  return noStore({ message: MESSAGES.submissionSuccess });
});
