import { NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getDB } from "@/lib/db";
import { fail, noStore, apiHandler } from "@/lib/api";
import { getVerifiedEmployee, getEmployeeHmac } from "@/lib/identity";
import { MESSAGES } from "@/lib/messages";
import { isWithinActiveWindow, nowUtc } from "@/lib/time";
import {
  newResponseGroupId,
  isHmacSecretMissingInProduction,
} from "@/lib/employee-hmac";

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
 *   6. `db.batch`:
 *      - Insert ParticipationLedger (participationType='executive',
 *        scopeKey=executiveId, executiveId=executiveId, status='submitted').
 *        UNIQUE constraint → 409 with MESSAGES.duplicateExecutive.
 *      - Fresh responseGroupId.
 *      - Insert one Response row per answer with executiveId,
 *        responseType='executive'.
 *   7. Return MESSAGES.submissionSuccess. No internal tokens exposed.
 *
 * NEVER returns `employeeHmac`. `Cache-Control: no-store` on all paths.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const db = getDB();

  const employee = await getVerifiedEmployee();
  if (!employee) return fail(MESSAGES.unauthorized, 401);
  // Admin-preview identities may render the survey but must never write
  // participation data — each impersonated address would mint a fresh HMAC.
  if (employee.source === "dev") return fail(MESSAGES.previewBanner, 403);
  // Refuse rather than silently signing with the shared dev literal.
  if (isHmacSecretMissingInProduction()) {
    return fail(MESSAGES.serviceUnavailable, 503);
  }

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
    `SELECT id, status, startsAt, endsAt,
            allowMultipleExecutiveEvaluations, maxExecutives
     FROM Campaign WHERE id = ?`
  ).bind(body.campaignId).first<{
    id: string;
    status: string;
    startsAt: string;
    endsAt: string;
    allowMultipleExecutiveEvaluations: number;
    maxExecutives: number | null;
  }>();
  if (!campaign || campaign.status !== "active") {
    return fail(MESSAGES.campaignClosed, 400);
  }
  const now = nowUtc();
  const window = isWithinActiveWindow(now, campaign.startsAt, campaign.endsAt);
  if (!window.active) {
    return fail(MESSAGES.campaignClosed, 400);
  }

  // 3. Validate executive is assigned + enabled + active globally.
  const assignment = await db.prepare(
    `SELECT ce.isEnabled, e.isActive, e.deletedAt
     FROM CampaignExecutive ce
     JOIN Executive e ON e.id = ce.executiveId
     WHERE ce.campaignId = ? AND ce.executiveId = ?`
  ).bind(campaign.id, body.executiveId).first<{ isEnabled: number; isActive: number; deletedAt: string | null }>();
  if (
    !assignment ||
    !assignment.isEnabled ||
    !assignment.isActive ||
    assignment.deletedAt !== null
  ) {
    // Not authorized to evaluate this executive in this campaign.
    return fail(MESSAGES.unauthorized, 403);
  }

  // 3b. Enforce the campaign's executive limits. Previously these were only
  //     applied in the browser (survey-wizard / executive-picker), so a
  //     direct POST could exceed them. `minExecutives` is a floor, not a
  //     ceiling — it cannot reject a submission and is validated at config
  //     time instead.
  const priorCountRow = await db.prepare(
    `SELECT COUNT(*) AS c FROM ParticipationLedger
      WHERE campaignId = ? AND employeeHmac = ?
        AND participationType = 'executive'`
  ).bind(campaign.id, employeeHmac).first<{ c: number }>();
  const evaluatedCount = priorCountRow?.c ?? 0;

  if (campaign.allowMultipleExecutiveEvaluations !== 1 && evaluatedCount >= 1) {
    return fail(MESSAGES.duplicateCampaign, 409);
  }
  if (
    typeof campaign.maxExecutives === "number" &&
    campaign.maxExecutives > 0 &&
    evaluatedCount >= campaign.maxExecutives
  ) {
    return fail(MESSAGES.executiveLimitReached, 409);
  }

  // Load all leadership-section frozen snapshots for this campaign.
  const snapshotsRows = await db.prepare(
    `SELECT id, isRequired FROM CampaignQuestionSnapshot
     WHERE campaignId = ? AND section = 'leadership'`
  ).bind(campaign.id).all<{ id: string; isRequired: number }>();

  // Load options for each snapshot.
  const snapshotMap = new Map<string, { id: string; isRequired: number; options: { value: string; score: number | null }[] }>();
  for (const snap of snapshotsRows.results) {
    const opts = await db.prepare(
      "SELECT value, score FROM CampaignQuestionOptionSnapshot WHERE campaignQuestionSnapshotId = ?"
    ).bind(snap.id).all<{ value: string; score: number | null }>();
    snapshotMap.set(snap.id, { ...snap, options: opts.results });
  }

  // 4. Validate every required leadership snapshot has an answer.
  const answeredIds = new Set(body.answers.map((a) => a.questionSnapshotId));
  const snapshots = Array.from(snapshotMap.values());
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
  const responseGroupId = newResponseGroupId();
  try {
    // 6a. Build ledger insert statement. `id` is bound explicitly: without
    //     it SQLite leaves the TEXT primary key NULL on every row.
    const ledgerStmt = db.prepare(
      `INSERT INTO ParticipationLedger (id, campaignId, executiveId, employeeHmac, participationType, scopeKey, status, submittedAt)
       VALUES (?, ?, ?, ?, 'executive', ?, 'submitted', ?)`
    ).bind(randomUUID(), campaign.id, body.executiveId, employeeHmac, body.executiveId, now);

    // 6b. Build response insert statements — one per answer.
    //     Deliberately NOT bound to the ledger's `now`: sharing a timestamp
    //     would let `JOIN ... ON submittedAt` link employeeHmac to answers.
    const responseStmts = responseRows.map((r) =>
      db.prepare(
        `INSERT INTO Response (id, campaignId, executiveId, responseGroupId, questionSnapshotId, selectedValue, selectedScore, responseType)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'executive')`
      ).bind(randomUUID(), campaign.id, body.executiveId, responseGroupId, r.questionSnapshotId, r.selectedValue, r.selectedScore)
    );

    // 6c. Execute as a batch.
    await db.batch([ledgerStmt, ...responseStmts]);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message?.includes("UNIQUE constraint failed")
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
