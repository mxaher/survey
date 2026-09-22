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
  // Always an array — multi_choice can hold many; single_choice holds
  // exactly one. The handler enforces the per-type cardinality.
  selectedValues: z.array(z.string().min(1)).min(1),
});

const BodySchema = z.object({
  campaignId: z.string().min(1),
  answers: z.array(AnswerSchema).min(1),
});

/**
 * POST /api/employee/future/submit
 *
 * Body: `{ campaignId, answers: [{ questionSnapshotId, selectedValues: string[] }] }`
 *   - `multi_choice` → array (length 1..snapshot.maxSelections)
 *   - `single_choice` → array of length 1
 *
 * Flow (mirrors the environment submit, with `participationType='future'`):
 *   1. Auth.
 *   2. Load campaign; reject if status≠active or outside window →
 *      MESSAGES.campaignClosed.
 *   3. Validate every required future snapshot has an answer →
 *      MESSAGES.incompleteAnswers.
 *   4. Validate each `selectedValue` exists in the snapshot's option set;
 *      validate `multi_choice` selections count ≤ snapshot.maxSelections.
 *   5. (selectedScore is null for future — no numeric scale.)
 *   6. `db.$transaction`:
 *      - Insert ParticipationLedger (participationType='future',
 *        scopeKey='future', status='submitted').
 *        P2002 → 409 with MESSAGES.duplicateCampaign.
 *      - Fresh responseGroupId.
 *      - Insert one Response row per (snapshot, selectedValue) pair.
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

  // Load all future-section frozen snapshots.
  const snapshots = await db.campaignQuestionSnapshot.findMany({
    where: { campaignId: campaign.id, section: "future" },
    include: { options: true },
  });
  const snapshotMap = new Map(snapshots.map((s) => [s.id, s]));

  // 3. Validate every required future snapshot has at least one selected value.
  const answeredIds = new Set(body.answers.map((a) => a.questionSnapshotId));
  const missingRequired = snapshots.filter(
    (s) => s.isRequired && !answeredIds.has(s.id)
  );
  if (missingRequired.length > 0) {
    return fail(MESSAGES.incompleteAnswers, 400);
  }

  // 4-5. Validate each answer against its snapshot's option set + cardinality.
  type ResponseRow = {
    questionSnapshotId: string;
    selectedValue: string;
  };
  const responseRows: ResponseRow[] = [];

  for (const ans of body.answers) {
    const snapshot = snapshotMap.get(ans.questionSnapshotId);
    if (!snapshot) {
      // References a snapshot that doesn't belong to this campaign's future
      // section — treat as incomplete.
      return fail(MESSAGES.incompleteAnswers, 400);
    }

    // Cardinality enforcement per question type.
    if (snapshot.questionType === "single_choice") {
      if (ans.selectedValues.length !== 1) {
        return fail(MESSAGES.incompleteAnswers, 400);
      }
    } else if (snapshot.questionType === "multi_choice") {
      const max = snapshot.maxSelections;
      if (max !== null && max !== undefined && ans.selectedValues.length > max) {
        return fail(MESSAGES.incompleteAnswers, 400);
      }
    } else {
      // Future section should only contain single_choice / multi_choice —
      // any other type is a config error; reject as incomplete.
      return fail(MESSAGES.incompleteAnswers, 400);
    }

    // Validate each selectedValue exists in the option set.
    const validValues = new Set(snapshot.options.map((o) => o.value));
    for (const sel of ans.selectedValues) {
      if (!validValues.has(sel)) {
        return fail(MESSAGES.incompleteAnswers, 400);
      }
      responseRows.push({
        questionSnapshotId: snapshot.id,
        selectedValue: sel,
      });
    }
  }

  // 6. Atomic insert.
  try {
    await db.$transaction(async (tx) => {
      // 6a. Insert ledger row first — duplicate gate (P2002 on race).
      await tx.participationLedger.create({
        data: {
          campaignId: campaign.id,
          employeeHmac,
          participationType: "future",
          scopeKey: "future",
          status: "submitted",
          submittedAt: now,
        },
      });

      // 6b. Fresh responseGroupId — random, not identity-derived.
      const responseGroupId = newResponseGroupId();

      // 6c. One Response row per (snapshot, selectedValue) pair.
      //     selectedScore is null — future questions are categorical.
      await tx.response.createMany({
        data: responseRows.map((r) => ({
          campaignId: campaign.id,
          executiveId: null,
          responseGroupId,
          questionSnapshotId: r.questionSnapshotId,
          selectedValue: r.selectedValue,
          selectedScore: null,
          responseType: "future",
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
      return fail(MESSAGES.duplicateCampaign, 409);
    }
    console.error(
      "[employee/future] submit failed",
      { campaignId: campaign.id, errorName: (err as Error)?.name }
    );
    throw err;
  }

  // 7. Success — message only, no internal tokens.
  return noStore({ message: MESSAGES.submissionSuccess });
});
