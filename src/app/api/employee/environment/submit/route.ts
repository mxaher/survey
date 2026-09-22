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
  answers: z.array(AnswerSchema).min(1),
});

/**
 * POST /api/employee/environment/submit
 *
 * Body: `{ campaignId, answers: [{ questionSnapshotId, selectedValue }] }`
 *
 * Flow (spec §13):
 *   1. Auth (`getVerifiedEmployee` + `getEmployeeHmac`); 401 if null.
 *   2. Load campaign; reject if status≠active or outside window →
 *      MESSAGES.campaignClosed.
 *   3. Validate every required environment snapshot has an answer →
 *      MESSAGES.incompleteAnswers.
 *   4. Validate each `selectedValue` exists in the snapshot's option set.
 *   5. Compute `selectedScore` from the matched option (null for
 *      not_applicable).
 *   6. `db.$transaction`:
 *      - Insert ParticipationLedger row (participationType='environment',
 *        scopeKey='environment', status='submitted', submittedAt=now).
 *        If the unique constraint rejects the insert (P2002) → 409 with
 *        MESSAGES.duplicateCampaign.
 *      - Generate responseGroupId = newResponseGroupId().
 *      - Insert one Response row per answer (no employeeHmac, no executiveId,
 *        responseType='environment').
 *   7. Return MESSAGES.submissionSuccess. No internal tokens exposed.
 *
 * Auth: 401 if no verified employee. `Cache-Control: no-store` via `noStore()`
 * on success and via `fail()` on error.
 *
 * NEVER returns `employeeHmac`. Server-side errors are logged without
 * exposing employee identity.
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

  // Load all environment-section frozen snapshots for this campaign.
  const snapshots = await db.campaignQuestionSnapshot.findMany({
    where: { campaignId: campaign.id, section: "environment" },
    include: { options: true },
  });

  // Index snapshots by ID for O(1) lookup.
  const snapshotMap = new Map(
    snapshots.map((s) => [s.id, s])
  );

  // 3. Validate every required environment snapshot has an answer.
  const answeredIds = new Set(body.answers.map((a) => a.questionSnapshotId));
  const missingRequired = snapshots.filter(
    (s) => s.isRequired && !answeredIds.has(s.id)
  );
  if (missingRequired.length > 0) {
    return fail(MESSAGES.incompleteAnswers, 400);
  }

  // 4-5. Validate each answer's selectedValue + compute selectedScore.
  // Build per-answer response rows; reject on any invalid value.
  type ResponseRow = {
    questionSnapshotId: string;
    selectedValue: string;
    selectedScore: number | null;
  };
  const responseRows: ResponseRow[] = [];

  for (const ans of body.answers) {
    const snapshot = snapshotMap.get(ans.questionSnapshotId);
    if (!snapshot) {
      // Answer references a snapshot that doesn't belong to this campaign's
      // environment section — treat as incomplete.
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

  // 6. Atomic insert: ledger + responses inside a single transaction.
  //    The unique index on ParticipationLedger is the race-condition safety
  //    net — if two submissions race for the same employee + campaign +
  //    'environment' scope, exactly one will succeed; the other receives
  //    P2002 from SQLite's unique-index enforcement, which we surface as
  //    MESSAGES.duplicateCampaign.
  try {
    await db.$transaction(async (tx) => {
      // 6a. Insert the ledger row first — this is the duplicate gate.
      //     We use create() (not upsert) so the unique constraint can reject
      //     a concurrent submission.
      await tx.participationLedger.create({
        data: {
          campaignId: campaign.id,
          employeeHmac,
          participationType: "environment",
          scopeKey: "environment",
          status: "submitted",
          submittedAt: now,
        },
      });

      // 6b. Generate fresh responseGroupId (random UUID — not derived from
      //     identity).
      const responseGroupId = newResponseGroupId();

      // 6c. Insert one Response row per answer (no employeeHmac, no
      //     executiveId — null for environment).
      await tx.response.createMany({
        data: responseRows.map((r) => ({
          campaignId: campaign.id,
          executiveId: null,
          responseGroupId,
          questionSnapshotId: r.questionSnapshotId,
          selectedValue: r.selectedValue,
          selectedScore: r.selectedScore,
          responseType: "environment",
          submittedAt: now,
        })),
      });

      return responseGroupId;
    });
  } catch (err) {
    // P2002 = unique constraint violation — duplicate submission.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return fail(MESSAGES.duplicateCampaign, 409);
    }
    // Anything else is unexpected — log without identity + bubble to
    // apiHandler's 500 fallback.
    console.error(
      "[employee/environment] submit failed",
      // Intentionally NOT logging employeeHmac or answer contents.
      { campaignId: campaign.id, errorName: (err as Error)?.name }
    );
    throw err;
  }

  // 7. Success — return message only, no internal tokens.
  return noStore({ message: MESSAGES.submissionSuccess });
});
