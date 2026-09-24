import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
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
 *   6. `db.batch`:
 *      - Insert ParticipationLedger row (participationType='environment',
 *        scopeKey='environment', status='submitted', submittedAt=now).
 *        If the unique constraint rejects the insert → 409 with
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
  const db = getDB();

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
  const campaign = await db.prepare(
    "SELECT id, status, startsAt, endsAt FROM Campaign WHERE id = ?"
  ).bind(body.campaignId).first<{ id: string; status: string; startsAt: string; endsAt: string }>();
  if (!campaign || campaign.status !== "active") {
    return fail(MESSAGES.campaignClosed, 400);
  }
  const now = nowUtc();
  const window = isWithinActiveWindow(now, campaign.startsAt, campaign.endsAt);
  if (!window.active) {
    return fail(MESSAGES.campaignClosed, 400);
  }

  // Load all environment-section frozen snapshots for this campaign.
  const snapshotsRows = await db.prepare(
    `SELECT id, isRequired FROM CampaignQuestionSnapshot
     WHERE campaignId = ? AND section = 'environment'`
  ).bind(campaign.id).all<{ id: string; isRequired: number }>();

  // Index snapshots by ID for O(1) lookup, loading options for each.
  const snapshotMap = new Map<string, { id: string; isRequired: number; options: { value: string; score: number | null }[] }>();
  for (const snap of snapshotsRows.results) {
    const opts = await db.prepare(
      "SELECT value, score FROM QuestionSnapshotOption WHERE snapshotId = ?"
    ).bind(snap.id).all<{ value: string; score: number | null }>();
    snapshotMap.set(snap.id, { ...snap, options: opts.results });
  }

  // 3. Validate every required environment snapshot has an answer.
  const answeredIds = new Set(body.answers.map((a) => a.questionSnapshotId));
  const snapshots = Array.from(snapshotMap.values());
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

  // 6. Atomic insert: ledger + responses inside a single batch.
  //    The unique index on ParticipationLedger is the race-condition safety
  //    net — if two submissions race for the same employee + campaign +
  //    'environment' scope, exactly one will succeed; the other receives
  //    a UNIQUE constraint error, which we surface as MESSAGES.duplicateCampaign.
  const responseGroupId = newResponseGroupId();
  try {
    // 6a. Build ledger insert statement.
    const ledgerStmt = db.prepare(
      `INSERT INTO ParticipationLedger (campaignId, employeeHmac, participationType, scopeKey, status, submittedAt)
       VALUES (?, ?, 'environment', 'environment', 'submitted', ?)`
    ).bind(campaign.id, employeeHmac, now);

    // 6b. Build response insert statements — one per answer.
    const responseStmts = responseRows.map((r) =>
      db.prepare(
        `INSERT INTO Response (campaignId, executiveId, responseGroupId, questionSnapshotId, selectedValue, selectedScore, responseType, submittedAt)
         VALUES (?, null, ?, ?, ?, ?, 'environment', ?)`
      ).bind(campaign.id, responseGroupId, r.questionSnapshotId, r.selectedValue, r.selectedScore, now)
    );

    // 6c. Execute as a batch.
    await db.batch([ledgerStmt, ...responseStmts]);
  } catch (err) {
    // UNIQUE constraint violation — duplicate submission.
    if (
      err instanceof Error &&
      err.message?.includes("UNIQUE constraint failed")
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
