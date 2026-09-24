# Task 2-b — Admin Question Library, Executives & Campaign Assignments API Routes

**Agent:** full-stack-developer
**Task:** Build all admin question-library, executive-registry, and per-campaign question/executive assignment API route handlers under `src/app/api/admin/`.

## Files created (14 total)

### Question library
1. `src/app/api/admin/questions/route.ts` — `GET` (list with `?section=`, `?isActive=`, `?search=` filters; `_count.campaignConfig`; ordered by `displayOrder`) + `POST` (Zod-validated create with `code`-uniqueness check, `questionType` in QUESTION_TYPES, `section` in QUESTION_SECTIONS, options array). Audited `question.create`.
2. `src/app/api/admin/questions/[id]/route.ts` — `GET` (full detail with options + `structurallyLocked` flag), `PATCH` (with structural-edit blocking when referenced by a campaign that has responses — only `isActive`/`displayOrder` allowed; bumps `version` when `questionAr` or any option `value`/`labelAr`/`score` changes; full options replacement with hard-delete of missing ones + create/update of incoming ones), `DELETE` (hard-delete iff NOT referenced by ANY `CampaignQuestionConfig`; otherwise soft-delete with `isActive=false`, `deletedAt=now` and `MESSAGES.deleteQuestionBlocked` payload). Audited `question.update` / `question.delete`.
3. `src/app/api/admin/questions/[id]/activate/route.ts` — `POST`. Set `isActive=true`, `deletedAt=null`. Audited `question.activate`.
4. `src/app/api/admin/questions/[id]/deactivate/route.ts` — `POST`. Set `isActive=false`. Audited `question.deactivate`.

### Campaign question assignments (under `/api/admin/campaigns/[id]/questions/...`)
5. `src/app/api/admin/campaigns/[id]/questions/route.ts` — `GET` (assignments joined with question+options, ordered by displayOrder) + `POST` (assign to DRAFT/SCHEDULED only; rejects active/closed/archived with `MESSAGES.cannotEditActiveCampaign`; idempotent — skips existing; `db.$transaction`-wrapped; re-validates status inside tx). Audited `campaign_question.assign`.
6. `src/app/api/admin/campaigns/[id]/questions/[questionId]/route.ts` — `PATCH` (update `scope`/`isRequired`/`displayOrder` for draft/scheduled only) + `DELETE` (remove assignment from draft/scheduled only). Audited `campaign_question.update` / `campaign_question.remove`.
7. `src/app/api/admin/campaigns/[id]/questions/reorder/route.ts` — `POST`. Body `{ order: [{ questionId, displayOrder }] }`. Transactional. Audited `campaign_question.reorder`.

### Executive registry
8. `src/app/api/admin/executives/route.ts` — `GET` (list with `?isActive=`, `?search=`, `?category=` filters; `_count.campaigns`; ordered by `displayOrder asc`, `nameAr asc`) + `POST` (Zod-validated create; `category` in EXECUTIVE_CATEGORIES). Audited `executive.create`.
9. `src/app/api/admin/executives/[id]/route.ts` — `GET` (full detail), `PATCH` (full update of editable fields), `DELETE` (hard-delete iff NOT referenced by any `CampaignExecutive`; otherwise refuse with `MESSAGES.removeExecutiveFromActiveWithHistory`). Audited `executive.update`, `executive.delete`, `executive.delete_refused`.
10. `src/app/api/admin/executives/[id]/activate/route.ts` — `POST`. Set `isActive=true`, `deletedAt=null`. Audited `executive.activate`.
11. `src/app/api/admin/executives/[id]/deactivate/route.ts` — `POST`. Set `isActive=false`. Audited `executive.deactivate`.

### Campaign executive assignments (under `/api/admin/campaigns/[id]/executives/...`)
12. `src/app/api/admin/campaigns/[id]/executives/route.ts` — `GET` (assignments joined with executive, ordered by displayOrder) + `POST` (assign to DRAFT/SCHEDULED only; idempotent; transactional). Audited `campaign_executive.assign`.
13. `src/app/api/admin/campaigns/[id]/executives/[executiveId]/route.ts` — `PATCH` (draft/scheduled: full update; active: only `isEnabled`; closed/archived: refused entirely) + `DELETE` (draft/scheduled: hard-delete; active with responses: soft-disable + `MESSAGES.removeExecutiveFromActiveWithHistory`; active without responses: hard-delete; closed/archived: refused). Audited `campaign_executive.update`, `campaign_executive.remove`, `campaign_executive.disable_active`.
14. `src/app/api/admin/campaigns/[id]/executives/reorder/route.ts` — `POST`. Body `{ order: [{ executiveId, displayOrder }] }`. Transactional. Audited `campaign_executive.reorder`.

## Key decisions

### Next.js slug-name collision — directory rename
The task spec wrote the new nested routes as `/api/admin/campaigns/[campaignId]/...`. **However, Next.js App Router forbids sibling dynamic segments with different slug names at the same nesting level.** Task 2-a had already chosen `[id]` for `/api/admin/campaigns/[id]/route.ts`. Having both `[id]` and `[campaignId]` at position 3 caused:
```
Error: You cannot use different slug names for the same dynamic path ('id' !== 'campaignId').
```
This caused `unhandledRejection`s in the dev server log.

**Resolution:** Renamed my new route directories from `[campaignId]` → `[id]` to align with Task 2-a. The URL paths are UNCHANGED — the slug name only appears in the file path, not in the request URL. Inside each handler I destructure with rename: `const { id: campaignId } = await ctx.params;` so the local variable name keeps the spec's intent (`campaignId`) without breaking Next.js routing. The frontend continues to call `/api/admin/campaigns/{actualId}/questions` — nothing on the frontend changes.

### "Referenced by a campaign with responses" detection (question PATCH/DELETE)
Two helpers in `questions/[id]/route.ts`:
- `isReferencedByCampaignWithResponses(id)` — counts `CampaignQuestionConfig` rows whose `campaign.responses` is non-empty. This is the structural-lock trigger for PATCH (only `isActive`/`displayOrder` editable).
- `isReferencedByAnyCampaign(id)` — counts any `CampaignQuestionConfig` row regardless of campaign state. This is the hard-delete-block trigger for DELETE (soft-delete instead).

This distinction lets the admin freely edit a question that's only been added to DRAFT campaigns (no responses yet), while protecting the integrity of questions whose answer text has been "frozen" into actual response rows.

### Question PATCH — version-bump logic
`version` is incremented when:
- `questionAr` text changes, OR
- Any option's `value`/`labelAr`/`score` changes, OR
- Options are added or removed (structural change)

`displayOrder`, `isActive`, and option `displayOrder`/`isActive` changes do NOT bump version (cosmetic only).

### Question PATCH — options replacement strategy
When `options` is in the PATCH body, it's treated as the FULL set:
- Existing options NOT in the body are hard-deleted (cascade-safe because `Response` rows reference `CampaignQuestionSnapshot`/`CampaignQuestionOptionSnapshot`, not the live `QuestionOption`).
- Options WITH an `id` are updated (only fields that actually changed get written).
- Options WITHOUT an `id` are created fresh.
- If an `id` is supplied but doesn't belong to this question, the row is CREATED as a new option rather than silently stealing another question's option.

### Executive DELETE — soft-disable vs hard-delete
- Draft/scheduled: hard-delete the `CampaignExecutive` row (no historical impact).
- Active campaign:
  - If the executive has any `Response` rows for this campaign → refuse to hard-delete, set `isEnabled=false` instead, return `MESSAGES.removeExecutiveFromActiveWithHistory`. The Arabic message specifically says "preserving their previous results" — so this path only triggers when there ARE previous results.
  - If no responses exist → hard-delete (no history to preserve).
- Closed/archived: refused entirely (cannot edit historical campaigns).

### Executive PATCH — per-status field whitelisting
- Draft/scheduled: `isEnabled` and `displayOrder` both editable.
- Active: ONLY `isEnabled` (toggle participant visibility). `displayOrder` is refused with `MESSAGES.cannotEditActiveCampaign` + `blockedFields` (changing order mid-flight would alter the participant's view).
- Closed/archived: refused entirely.

### Idempotent assignment POSTs
Both `/campaigns/[id]/questions` POST and `/campaigns/[id]/executives` POST are idempotent: they look up existing assignments, skip the ones already present, and only insert the new ones. When the request contains only already-assigned ids, the endpoint returns `200` with `created: 0` and audits the no-op with `idempotent: true` metadata for traceability.

### DisplayOrder auto-increment
When the body doesn't supply `displayOrder`, new assignments are appended after the current max for that campaign (`max(displayOrder) + i`).

### Audit-log atomicity (consistent with Task 2-a)
Audit writes are best-effort AFTER the mutation transaction commits. If the audit write fails, the mutation has already succeeded — this matches Task 2-a's decision in the activate endpoint. If the orchestrator later prefers full atomicity, the `writeAudit` calls can be moved inside the `db.$transaction` callback using `tx.auditLog.create`.

### Structural-edit blocking — UI contract
The PATCH `/api/admin/questions/[id]` endpoint returns the list of `blockedFields` in the 400 error body when an unsafe edit is attempted on a question with historical responses. The GET endpoint also returns `structurallyLocked: boolean` so the frontend can proactively disable the structural-edit UI controls (and show the `MESSAGES.deleteQuestionBlocked` notice as an inline hint).

## Unresolved issues / follow-ups for other agents

### Frontend agent — important contract details
- **Question list response** includes `campaignConfigCount` per row — useful for "used by N campaigns" badges.
- **Question detail response** includes `structurallyLocked: boolean` — when true, the UI should disable code/questionAr/questionType/section/dimension/options editing and only allow `isActive`/`displayOrder` changes. The PATCH endpoint will refuse with `MESSAGES.deleteQuestionBlocked` (Arabic: "لا يمكن حذف هذا السؤال نهائياً...") and `blockedFields: string[]` listing the rejected field names.
- **Question DELETE response** is `{ ok: true, data: { deleted: true, mode: "hard"|"soft", message?: string } }`. The `mode: "soft"` path returns `MESSAGES.deleteQuestionBlocked` in the `message` field — the frontend should surface this as a friendly toast/notification, NOT as a red error.
- **Executive DELETE response** for the refused case is `{ ok: false, error: MESSAGES.removeExecutiveFromActiveWithHistory, mode: "refused", referenced: true }` (HTTP 400) — the frontend should display this Arabic message and recommend that the admin remove per-campaign assignments instead.
- **Campaign executive DELETE response** for the soft-disable case is `{ ok: true, data: { removed: false, mode: "soft", isEnabled: false, responsesCount: N, message: MESSAGES.removeExecutiveFromActiveWithHistory } }` (HTTP 200) — show the Arabic message as a notice.
- **Campaign assignment endpoints** return `editable: boolean` in the GET response wrapper — when false (active/closed/archived), the UI should hide/disable the "add/remove/reorder" controls and only show the assigned list.
- **PATCH on campaign executive for active campaigns** returns `blockedFields: ["displayOrder"]` in the 400 body if the admin tries to change `displayOrder` mid-flight. Only `isEnabled` toggles succeed for active campaigns.

### Campaign detail agent (Task 2-a) — consistency note
My GET `/campaigns/[id]/questions` and GET `/campaigns/[id]/executives` endpoints return the same assignment shape as Task 2-a's GET `/campaigns/[id]` detail endpoint's `questions[]` and `executives[]` sub-arrays — same field names, same option mapping, same `displayOrder` ordering. The Task 2-a detail endpoint includes both, mine focuses on one per call with extra assignment-metadata fields (`createdAt`/`updatedAt`/`scope`/`isRequired`/`isEnabled`). Frontend can use either endpoint — Task 2-a's detail for a single-page overview, mine for focused assignment-management screens.

### Slug-name conflict — orchestrator follow-up
The orchestrator should add a note to the worklog/conventions doc: **all sibling dynamic routes under `/api/admin/campaigns/X` must use `[id]` as the slug name** (not `[campaignId]`), to match Task 2-a's choice. Task 2-b's spec wrote `[campaignId]` literally but I had to rename for Next.js compatibility. Future agents writing under `campaigns/[id]/...` must keep the same slug.

### Pre-existing lint errors — unchanged
- `src/lib/admin-auth.ts`: 2 `@typescript-eslint/no-require-imports` errors (from `require("crypto")` × 2 in `makeSessionToken`/`parseSessionToken`). Pre-existing; not in my scope to fix.
- `prisma/seed.ts`: 1 unused eslint-disable warning. Pre-existing.

## Verification
- `bun run lint`: only pre-existing errors in `admin-auth.ts` (2 errors) + `prisma/seed.ts` (1 warning). Zero errors/warnings in any of my 14 files.
- `bunx tsc --noEmit`: zero type errors in any of my 14 files. The only TS errors are in `examples/`, `skills/`, and other agents' parallel work (`src/app/api/admin/audit/route.ts` — not in my scope).
- Dev server log: there were transient `unhandledRejection` errors during my directory-rename operation (from intermediate `[id.tmp]` state) — all resolved once the rename completed. The dev server may need a manual restart (per task rules I did NOT restart it).
