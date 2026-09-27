import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { fail, noStore, apiHandler } from "@/lib/api";
import { getVerifiedEmployee, getEmployeeHmac } from "@/lib/identity";
import { MESSAGES } from "@/lib/messages";
import { isWithinActiveWindow, nowUtc } from "@/lib/time";
import { newResponseGroupId } from "@/lib/employee-hmac";
import { validateSelections } from "@/lib/scoring";

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
 *   6. `db.batch`:
 *      - Insert ParticipationLedger (participationType='future',
 *        scopeKey='future', status='submitted').
 *        UNIQUE constraint → 409 with MESSAGES.duplicateCampaign.
 *      - Fresh responseGroupId.
 *      - Insert one Response row per (snapshot, selectedValue) pair.
 *   7. Return MESSAGES.submissionSuccess. No internal tokens exposed.
 *
 * NEVER returns `employeeHmac`. `Cache-Control: no-store` on all paths.
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

  // Load all future-section frozen snapshots.
  const snapshotsRows = await db.prepare(
    `SELECT id, isRequired, questionType, maxSelections FROM CampaignQuestionSnapshot
     WHERE campaignId = ? AND section = 'future'`
  ).bind(campaign.id).all<{ id: string; isRequired: number; questionType: string; maxSelections: number | null }>();

  // Load options for each snapshot.
  const snapshotMap = new Map<string, { id: string; isRequired: number; questionType: string; maxSelections: number | null; options: { value: string }[] }>();
  for (const snap of snapshotsRows.results) {
    const opts = await db.prepare(
      "SELECT value FROM CampaignQuestionOptionSnapshot WHERE campaignQuestionSnapshotId = ?"
    ).bind(snap.id).all<{ value: string }>();
    snapshotMap.set(snap.id, { ...snap, options: opts.results });
  }

  // 3. Validate every required future snapshot has at least one selected value.
  const answeredIds = new Set(body.answers.map((a) => a.questionSnapshotId));
  const snapshots = Array.from(snapshotMap.values());
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

    // Cardinality + option-set enforcement (spec §9) — server side, using
    // the shared validation so the limits can never be bypassed.
    if (
      snapshot.questionType !== "single_choice" &&
      snapshot.questionType !== "multi_choice"
    ) {
      return fail(MESSAGES.incompleteAnswers, 400);
    }
    const allowedValues = snapshot.options.map((o) => o.value);
    const validation = validateSelections({
      questionType: snapshot.questionType,
      maxSelections: snapshot.maxSelections,
      selectedValues: ans.selectedValues,
      allowedValues,
      isRequired: snapshot.isRequired === 1,
    });
    if (!validation.ok) {
      return fail(validation.errorAr ?? MESSAGES.incompleteAnswers, 400);
    }

    for (const sel of ans.selectedValues) {
      responseRows.push({
        questionSnapshotId: snapshot.id,
        selectedValue: sel,
      });
    }
  }

  // 6. Atomic insert.
  const responseGroupId = newResponseGroupId();
  try {
    // 6a. Build ledger insert statement.
    const ledgerStmt = db.prepare(
      `INSERT INTO ParticipationLedger (campaignId, employeeHmac, participationType, scopeKey, status, submittedAt)
       VALUES (?, ?, 'future', 'future', 'submitted', ?)`
    ).bind(campaign.id, employeeHmac, now);

    // 6b. Build response insert statements — one per (snapshot, selectedValue) pair.
    //     selectedScore is null — future questions are categorical.
    const responseStmts = responseRows.map((r) =>
      db.prepare(
        `INSERT INTO Response (campaignId, executiveId, responseGroupId, questionSnapshotId, selectedValue, selectedScore, responseType, submittedAt)
         VALUES (?, null, ?, ?, ?, null, 'future', ?)`
      ).bind(campaign.id, responseGroupId, r.questionSnapshotId, r.selectedValue, now)
    );

    // 6c. Execute as a batch.
    await db.batch([ledgerStmt, ...responseStmts]);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message?.includes("UNIQUE constraint failed")
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
