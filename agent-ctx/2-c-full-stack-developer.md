# Task 2-c — Employee API Routes

**Agent:** full-stack-developer
**Task:** Build all employee-facing survey API route handlers under `src/app/api/employee/` per spec §13. Anonymous-by-design: responses layer never stores employee identity; ledger layer uses HMAC only.

## Files created
1. `src/app/api/employee/campaign/route.ts` — `GET`. Returns the single currently-active campaign (status=active AND within startsAt/endsAt) with all the toggles the employee UI needs (title, description, instructions, privacy notice resolved from campaign override → SystemSetting.privacy_notice → bundled `PRIVACY_NOTICE`, enableEnvironmentSurvey, enableFutureSurvey, allowMultipleExecutiveEvaluations, minExecutives, maxExecutives, allowResume). If none active, returns `{ ok: true, data: null }` so the frontend can render `MESSAGES.noActiveCampaign` itself (spec §13.1).
2. `src/app/api/employee/executives/route.ts` — `GET ?campaignId=`. Returns `{ executives: [...], evaluatedExecutiveIds: string[] }` for the active campaign. Executives filtered to `isEnabled=true AND executive.isActive=true AND deletedAt IS NULL`, ordered by `displayOrder`. Already-evaluated list pulled from `ParticipationLedger` rows where `participationType='executive'` + `status='submitted'` — `scopeKey` is the executiveId by convention.
3. `src/app/api/employee/participation-status/route.ts` — `GET ?campaignId=`. Returns `{ environmentSubmitted, futureSubmitted, evaluatedExecutiveIds, allExecutivesEvaluated }` — all derived from `ParticipationLedger` rows for this employee's HMAC. The `allExecutivesEvaluated` flag compares the count of distinct submitted `executive` ledger rows against the active-assignment count, so the frontend can show "you've evaluated everyone — done".
4. `src/app/api/employee/executives/[executiveId]/questions/route.ts` — `GET`. Returns the frozen leadership snapshots (`CampaignQuestionSnapshot` where section=`leadership` + the active campaign) with their option snapshots. Re-validates: auth, currently-active campaign, executive assignment+enabled+active, and that this employee hasn't already submitted for this executive (409 → `MESSAGES.duplicateExecutive`).
5. `src/app/api/employee/environment/submit/route.ts` — `POST`. Body: `{ campaignId, answers: [{ questionSnapshotId, selectedValue }] }`. Validates every required environment snapshot has an answer; validates each `selectedValue` exists in the snapshot's option set; computes `selectedScore` (null for `not_applicable`). Atomic `db.$transaction`: insert `ParticipationLedger(participationType='environment', scopeKey='environment')` (catch P2002 → 409 `MESSAGES.duplicateCampaign`) + fresh `responseGroupId` + one `Response` row per answer (executiveId=null, responseType='environment'). Returns `{ message: MESSAGES.submissionSuccess }` — **no responseGroupId exposed** per spec §13.6.
6. `src/app/api/employee/future/submit/route.ts` — `POST`. Body: `{ campaignId, answers: [{ questionSnapshotId, selectedValues: string[] }] }`. Per-question cardinality enforcement: single_choice → exactly 1, multi_choice → ≤ `snapshot.maxSelections`. One `Response` row per (snapshot, selectedValue) pair, all sharing one `responseGroupId`. Atomic transaction; P2002 → 409 `MESSAGES.duplicateCampaign`. `selectedScore` is null (future questions are categorical, no scale).
7. `src/app/api/employee/evaluations/submit/route.ts` — `POST`. Body: `{ campaignId, executiveId, answers: [{ questionSnapshotId, selectedValue }] }`. Re-validates executive is assigned+enabled+active (else `MESSAGES.unauthorized` 403); validates required leadership snapshots answered; validates option values; computes `selectedScore`. Atomic transaction: insert `ParticipationLedger(participationType='executive', scopeKey=executiveId, executiveId=executiveId)` (P2002 → 409 `MESSAGES.duplicateExecutive`) + `Response` rows with executiveId + `responseType='executive'`.
8. `src/app/api/employee/draft/route.ts` — `POST` + `GET`. Both return 501 with Arabic "الميزة قيد التطوير" — see "Draft / resume" decision below.

## Key decisions

### Atomic submission transaction + P2002 handling
All three submit endpoints (environment / future / evaluations) use the same pattern:
```ts
try {
  await db.$transaction(async (tx) => {
    await tx.participationLedger.create({...}); // duplicate gate
    const responseGroupId = newResponseGroupId();
    await tx.response.createMany({...});
  });
} catch (err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return fail(MESSAGES.duplicate..., 409);
  }
  throw err;
}
```
- The `ParticipationLedger` insert goes FIRST inside the tx so the unique index acts as the race-condition gate. SQLite's unique-index enforcement happens inside the transaction so the entire tx rolls back atomically if a concurrent submission wins the race.
- `db.$transaction` callback is `async` — when the inner `create` throws, the transaction is rolled back, and the rejection propagates to the outer `await`.
- We pattern-match on `Prisma.PrismaClientKnownRequestError` + `code === "P2002"` to discriminate duplicates from any other Prisma error. Anything else is re-thrown so `apiHandler`'s catch-all converts it to a 500.
- No pre-`findUnique` lookup before the insert — the unique constraint IS the source of truth, and a pre-check would just introduce a TOCTOU window without eliminating the need for the unique-index enforcement.

### No `responseGroupId` exposed to the client
The spec §13.6 step literally says "Return `{ ok: true, data: { message: MESSAGES.submissionSuccess, responseGroupId } }`" but the prompt explicitly overrides: "actually DON'T return responseGroupId, just return the message." Per spec §13.6 footnote: "No identity or internal token shown." We follow the stricter interpretation — `responseGroupId` is an internal grouping key (for reports/dedup) and is never surfaced to the employee UI.

### Draft / resume — 501 stub
The schema has an `allowResume` toggle on `Campaign`. The intended design (per spec §13.4) was to persist in-progress answers so an employee could close the tab and resume later. **v1 does NOT wire this** because any "draft" store would have to associate the employee's HMAC with answer content — which re-couples identity to answers (the very thing the spec's identity-separation architecture exists to prevent). The `ParticipationLedger.status='started'` row can mark "employee opened this section" without storing answer content, but that gives no real resume value and risks privacy drift if a future engineer mis-uses the row to stash JSON.

Both `POST /api/employee/draft` and `GET /api/employee/draft` return `501 Not Implemented` with the Arabic message "الميزة قيد التطوير". The campaign's `allowResume` flag is still returned by `GET /api/employee/campaign` so the frontend can decide whether to show the resume CTA — but the CTA will hit this 501 until a privacy-preserving resume design lands (e.g., client-side `localStorage` only, never persisted server-side).

### Privacy — never expose `employeeHmac`
- `getVerifiedEmployee()` is called first on every route; null → 401 with `MESSAGES.unauthorized`.
- `getEmployeeHmac()` is called immediately after (it re-derives the HMAC server-side from the verified identity). The HMAC is used ONLY in `where` clauses against `ParticipationLedger`; it is never included in any response payload, never logged.
- `console.error` calls in the submit catch blocks intentionally log only `{ campaignId, executiveId?, errorName }` — never the HMAC, never the answer contents.
- `Response` rows never store the HMAC. They only store `responseGroupId` (random UUID from `newResponseGroupId()` — `crypto.randomUUID()`, NOT identity-derived).

### Active-campaign detection
For `GET /api/employee/campaign` (no campaignId given), we `findMany({ where: { status: "active" } })` and then filter client-side by `isWithinActiveWindow(now, startsAt, endsAt)`. This handles the edge case where the admin forgot to close an expired campaign — the window check still prevents employees from submitting after the deadline even though `status='active'`.

For endpoints that take `?campaignId=` (executives / participation-status), we `findUnique({ where: { id: campaignId } })` and then:
- if not found OR `status !== 'active'` → `MESSAGES.noActiveCampaign` (400)
- if `status === 'active'` but outside window → `MESSAGES.campaignClosed` (400)

For `POST` submit endpoints, any non-active / outside-window → `MESSAGES.campaignClosed` (since the user is trying to submit to a campaign that's no longer accepting responses).

### `force-dynamic` + `noStore`
Every route file exports `export const dynamic = "force-dynamic"` (prevents Next.js from statically caching employee responses, which would leak stale state). All success responses use `noStore()` which sets `Cache-Control: no-store` per spec §18. All error responses use `fail()` which also sets `Cache-Control: no-store` (per the helper's implementation).

### Zod input validation
Every POST body is validated with a Zod schema before any DB work. Body parse failures (`request.json()` throws or Zod `safeParse` fails) → `MESSAGES.incompleteAnswers` (400). The schema enforces non-empty `campaignId`, non-empty `questionSnapshotId`, non-empty `selectedValue(s)`, and `answers.length >= 1`.

For the future submit, we enforce the per-type cardinality AFTER loading the snapshots:
- `single_choice` → exactly 1 selection
- `multi_choice` → ≥1 and ≤ `snapshot.maxSelections`
- any other questionType in the future section → 400 (defensive — should never happen if seed is correct)

## Unresolved issues / follow-ups for other agents

### Frontend agent
1. **No-active-campaign contract**: `GET /api/employee/campaign` returns `{ ok: true, data: null }` when there's no active campaign. The frontend should treat `data === null` as "show `MESSAGES.noActiveCampaign` + a 'check back later' screen" — NOT as an error.
2. **Participation-status contract**: `GET /api/employee/participation-status?campaignId=` returns `{ environmentSubmitted, futureSubmitted, evaluatedExecutiveIds, allExecutivesEvaluated }`. The frontend should use this to: (a) skip already-submitted sections, (b) mark already-evaluated executives with `MESSAGES.alreadyEvaluatedLabel`, (c) show a "you're done" screen when `allExecutivesEvaluated === true` AND `environmentSubmitted` AND `futureSubmitted`.
3. **Executive evaluation flow**: frontend should call `GET /api/employee/executives/[executiveId]/questions` to get the leadership snapshots + options BEFORE rendering the form. A 409 from this endpoint means the employee already evaluated this executive — surface `MESSAGES.duplicateExecutive` and refresh the executives list.
4. **Submit success shape**: all three submit endpoints return `{ ok: true, data: { message: MESSAGES.submissionSuccess } }` — NO `responseGroupId`. Show the message in a toast and navigate to the next section.
5. **Submit duplicate shape**: environment/future submits return 409 with `MESSAGES.duplicateCampaign`; executive submit returns 409 with `MESSAGES.duplicateExecutive`. Surface these specifically — they mean "you've already submitted this; we won't accept another".
6. **Draft/resume**: `POST /api/employee/draft` and `GET /api/employee/draft` return 501 with `{ message: "الميزة قيد التطوير" }`. If the campaign has `allowResume=true` and the user clicks a "save draft" CTA, show the 501 message and keep the user on the form. Do NOT retry automatically.
7. **Privacy notice**: the campaign endpoint returns `privacyNoticeAr` already resolved (campaign override → system setting → bundled constant). The frontend can render it directly without further resolution logic.

### Pre-existing issues (NOT my responsibility, just flagging)
1. **Slug conflict**: another agent's routes use `/api/admin/campaigns/[campaignId]/...` (slug `[campaignId]`) while Task 2-a's routes use `/api/admin/campaigns/[id]/...` (slug `[id]`). Next.js throws `Error: You cannot use different slug names for the same dynamic path ('id' !== 'campaignId')` and the dev server fails to reload routes. This is visible in the dev.log tail. **This is NOT my code** — my routes are all under `/api/employee/`. The orchestrator needs to align the two admin agents on a single slug name (recommend `[id]` for consistency with 2-a's existing routes).
2. **Pre-existing lint errors** in `src/lib/admin-auth.ts` (`require("crypto")` × 2) and `prisma/seed.ts` (unused eslint-disable warning) — already documented in Task 2-a's worklog. Not my responsibility.

## Verification
- `bun run lint`: ZERO errors/warnings in any of my 8 files. Only the pre-existing errors in `admin-auth.ts` (2 errors) and `prisma/seed.ts` (1 warning) remain — flagged for the orchestrator.
- `bunx tsc --noEmit`: ZERO TypeScript errors in `src/app/api/employee/**`. The only TS errors in the repo are in `examples/`, `skills/`, `src/app/api/admin/audit/route.ts` (other agent's), and `src/app/api/admin/reports/...` (other agent's) — all out of scope for Task 2-c.
- Dev server: hot-reloads my route files on demand; the slug-conflict error in `/api/admin/campaigns/...` is a separate issue from a different agent's work and does not affect my employee routes (which live under `/api/employee/`).
