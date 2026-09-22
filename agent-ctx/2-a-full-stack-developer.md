# Task 2-a — Admin Campaign API Routes

**Agent:** full-stack-developer
**Task:** Build all admin campaign management API route handlers under `src/app/api/admin/` + the shared `src/lib/readiness.ts` helper.

## Files created
1. `src/lib/readiness.ts` — `checkReadiness(campaignId)` per spec §11.7.
2. `src/app/api/admin/campaigns/route.ts` — `GET` (list with counts) + `POST` (create draft, Zod-validated, audited `campaign.create`).
3. `src/app/api/admin/campaigns/[id]/route.ts` — `GET` (full detail), `PATCH` (with active-status unsafe-edit blocking per §7), `DELETE` (only if draft + zero participation/responses), audited `campaign.update` / `campaign.delete`.
4. `src/app/api/admin/campaigns/[id]/activate/route.ts` — `POST`. Pre-flight readiness, then `db.$transaction` that (re)reads inside tx, clears stale snapshots, freezes immutable `CampaignQuestionSnapshot` + `CampaignQuestionOptionSnapshot` rows, sets status=`active` + `activatedAt=now`. Audited `campaign.activate` (outside tx so audit failure doesn't roll back the mutation).
5. `src/app/api/admin/campaigns/[id]/close/route.ts` — `POST`. Only from `active` → `closed`, sets `closedAt`. Audited `campaign.close`.
6. `src/app/api/admin/campaigns/[id]/archive/route.ts` — `POST`. Only from `closed` → `archived`. Audited `campaign.archive`.
7. `src/app/api/admin/campaigns/[id]/schedule/route.ts` — `POST`. Only from `draft` → `scheduled`; requires `startsAt` in the future. Audited `campaign.schedule`.
8. `src/app/api/admin/campaigns/[id]/readiness/route.ts` — `GET`. Returns the readiness check result.
9. `src/app/api/admin/campaigns/[id]/preview/route.ts` — `GET`. Returns the exact employee-UI shape (campaign + privacy notice + environment/leadership/future questions with options + active executives). For active/closed/archived campaigns, serves frozen snapshots; for draft/scheduled, serves the live question library. Read-only, `Cache-Control: no-store`.
10. `src/app/api/admin/campaigns/[id]/copy/route.ts` — `POST`. Creates a draft copy with title suffix ` (نسخة)`, copies all toggles + privacy notice + executive assignments + question configs (inside `db.$transaction`). Skips status/dates/activatedAt/closedAt. Audited `campaign.copy`.

## Key decisions
- **`apiHandler` wrapping**: every exported route fn is wrapped so any unhandled throw becomes a 500 with a generic Arabic message. None of the route files use `'use server'` (route handlers don't need it).
- **`dynamic = "force-dynamic"`** exported on every file to prevent Next.js from statically caching admin responses (which would leak stale state).
- **Audit logs are best-effort, NOT inside the activation `$transaction`**: the activate endpoint does the snapshot-freeze + status-flip atomically inside a tx, then writes the audit log AFTER the tx commits. This means an audit-write failure won't roll back the activation. If the orchestrator prefers audit atomicity we can move it inside the tx — flag this in review.
- **Re-validation inside transactions**: the activate endpoint re-fetches the campaign with all related rows INSIDE the `db.$transaction` callback and re-checks the status (`draft`/`scheduled`) before freezing — race-condition-safe. The copy endpoint similarly re-uses the source snapshot loaded before the tx (acceptable since copies are idempotent).
- **PATCH unsafe-edit blocking (spec §7)**:
  - `status=closed|archived` → reject entirely (400).
  - `status=active` → whitelist of allowed fields: `descriptionAr`, `endsAt`, `minimumReportingThreshold`. Any other field in the payload → 400 with `MESSAGES.cannotEditActiveCampaign` + `blockedFields` array.
  - `endsAt` extension-only: new value must be `>=` the old `endsAt` (cannot shorten an active campaign window).
  - `status=draft|scheduled` → all fields editable (still Zod-validated).
  - Executive-removal and question-structure changes for active campaigns are NOT handled in this route (those are separate routes owned by another agent).
- **DELETE only-if-safe**: blocked unless `status='draft'` AND zero `participation_ledger` rows AND zero `responses` rows. Otherwise 400 with Arabic message recommending archive instead. Cascade deletes from the schema will clean up `CampaignExecutive`, `CampaignQuestionConfig`, `CampaignQuestionSnapshot`, `CampaignQuestionOptionSnapshot` automatically.
- **Preview endpoint serves snapshots when frozen**: for `active|closed|archived` campaigns the preview pulls from `CampaignQuestionSnapshot` + `CampaignQuestionOptionSnapshot` so it shows the EXACT thing the employee UI will render. For `draft|scheduled` it pulls from the live `Question` + `QuestionOption` library filtered by `CampaignQuestionConfig` (and filters out inactive questions/options). Privacy notice is resolved: campaign override → `SystemSetting.privacy_notice` → bundled `PRIVACY_NOTICE` constant.
- **Readiness helper covers spec §11.7 exactly**: title, instructions, ≥1 active exec, ≥1 active question, every active question has ≥1 active option, start set, end set + strictly after start, threshold ≥ 1, no duplicate executives/questions (defensive — PK already enforces), minExecutives ≤ maxExecutives when both set.
- **No 'use server' directives**: route handlers are normal TS exports per the task's hard rule.
- **GET list includes count of `participationLedger`, `questionSnapshots`, `responses`** in addition to `executives` + `questionConfig` — admin UI can use these to show "active / frozen / has participation" badges.

## Unresolved issues / follow-ups for other agents
- **Frontend agent**: the preview response uses two distinct shapes (`source: "snapshots"` vs `source: "library"`). Snapshot rows use `snapshotId` / `originalQuestionId` / `questionCode`; library rows use `questionId` / `code`. The frontend should normalize these — recommended approach: render by `questionAr` + `options[*].{value,labelAr}` and ignore the ID field differences. Or, the frontend can branch on `data.source`.
- **Frontend agent**: the PATCH endpoint returns the list of `blockedFields` in the error body when an unsafe edit is attempted on an active campaign — surface this in the UI as a per-field validation hint.
- **Frontend agent**: the activate endpoint returns `ready: false` + `issues: [{ key, messageAr }]` in the 400 body when the readiness check fails — the readiness panel should render these issues directly. The same shape is also returned by `GET /api/admin/campaigns/[id]/readiness` (without the error envelope).
- **Executive/Question agents**: my GET detail endpoint already exposes `executives[]` and `questions[]` in the campaign detail payload. If the executive-management agent or question-management agent re-shape `CampaignExecutive`/`CampaignQuestionConfig` they should keep their own routes consistent.
- **Reports agent**: counts in the list endpoint are raw `_count.responses` (NOT distinct by `responseGroupId`). For a true participant count, the reports agent should query `participationLedger` instead. This is documented in the work log.
- **Pre-existing lint errors**: `src/lib/admin-auth.ts` has 2 `@typescript-eslint/no-require-imports` errors (from `require("crypto")` calls in `makeSessionToken`/`parseSessionToken`). These were pre-existing and I was instructed NOT to modify lib files except `src/lib/readiness.ts`. They will not block the dev server. Recommend a follow-up to refactor those to `import { createHmac } from "crypto"` at the top of the file.
- **Audit-log atomicity**: see "Key decisions" above — if the orchestrator wants the audit write to be transactional with the activate mutation, move the `writeAudit` call inside the `db.$transaction` callback using `tx.auditLog.create`.

## Verification
- `bun run lint`: only pre-existing errors in `admin-auth.ts` (2 errors) + `prisma/seed.ts` (1 warning). Zero errors/warnings in any of the 10 files I created.
- `bunx tsc --noEmit`: zero type errors in any of my files. The only TS errors are in `examples/` and `skills/` (out of scope).
- Dev server log shows clean GETs on `/` with no compile errors for my new routes (Next.js 16 hot-reloads route files on demand).
