# Task 2-d — Admin Reports + Audit Log + Export + Settings + User Management API Routes

**Agent:** full-stack-developer
**Task:** Build admin-side reporting/audit/settings/user-management API routes under `src/app/api/admin/` (sub-tasks 1–6 of the brief).

## Files created

### 1. Dashboard
- `src/app/api/admin/dashboard/route.ts` — `GET`. Admin dashboard summary: campaigns grouped by status, totals (activeExecutives, activeQuestions, totalResponses, campaigns), and `latestCampaign` snapshot (id, titleAr, status, responseCount). Both roles can read.

### 2. Reports
- `src/app/api/admin/reports/[campaignId]/route.ts` — `GET`. Campaign overview: campaign info, `sectionTotals` (environment/future/executive with `count` + `suppressed` flag), `executives` list (with `evaluationCount` = distinct responseGroupId, `suppressed` flag). NEVER exposes raw Response rows.
- `src/app/api/admin/reports/[campaignId]/environment/route.ts` — `GET`. Per-environment-question aggregates: `count`, `validCount` (selectedScore !== null), `averageScore`, `distribution: { value, labelAr, count }[]`, `favorableRate` (FAVORABLE_VALUES count / validCount), `notApplicableCount`. Whole-section suppression: `{ suppressed: true, message: MESSAGES.belowThreshold, threshold, totalResponses, questions: [] }` if total env responses < threshold.
- `src/app/api/admin/reports/[campaignId]/future/route.ts` — `GET`. Per-future-question distribution: `{ value, labelAr, count, percentage }[]`. Same threshold suppression envelope.
- `src/app/api/admin/reports/[campaignId]/executive/[executiveId]/route.ts` — `GET`. Per-exec aggregated report: `evaluationCount` (distinct responseGroupId for campaign+exec), per-question aggregates (same as env), per-dimension rollups (group by snapshot.dimension, average of per-question averages), `strength` (highest dimension), `improvement` (lowest dimension), `orgWideComparison` (org-wide dimension averages across all execs in campaign). Suppression envelope if evaluationCount < threshold.

### 3. Export
- `src/app/api/admin/reports/[campaignId]/export/route.ts` — `GET?format=csv`. Returns UTF-8-BOM CSV (`\uFEFF` prefix, CRLF line endings — Excel-compatible). Headers: `اسم الحملة,اسم المسؤول,الإدارة,المحور,نص السؤال,عدد الإجابات,المتوسط,نسبة الإجابات الإيجابية,دائماً,غالباً,أحياناً,نادراً,أبداً,لا ينطبق`. One row per (executive × leadership snapshot). Skips execs whose evaluationCount < threshold. `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="report.csv"`. Audits `report.export`. Raw text body (not JSON) — the one exception.

### 4. Audit log
- `src/app/api/admin/audit/route.ts` — `GET`. Paginated audit log (latest first). Filters: `?campaignId=`, `?action=`, `?entityType=`, `?page=`, `?pageSize=` (default 50, max 200). Joins `AdminUser` in JS (the `AuditLog.adminUserId` column is a plain string FK with no Prisma relation — see "Key decisions"). Returns `displayName` (or `externalId` if null). Parses `metadataJson` into `metadata` (object|string|null). Both roles can read.

### 5. System settings
- `src/app/api/admin/settings/route.ts` — `GET` (list all) + `POST` (upsert by key, Zod-validated). Audits `settings.update`.
- `src/app/api/admin/settings/[key]/route.ts` — `GET` (one), `PATCH` (update valueAr, Zod-validated), `DELETE` (remove). Audits `settings.update` / `settings.delete`. Both roles can mutate.

### 6. Admin user management (SUPER_ADMIN only)
- `src/app/api/admin/users/route.ts` — `GET` (list all) + `POST` (create new — SURVEY_ADMIN gets 403 with `لا تملك صلاحية تنفيذ هذه العملية`). Audits `admin_user.create`. Zod-validated; rejects duplicate `externalId` with 409.
- `src/app/api/admin/users/[id]/route.ts` — `GET` (one), `PATCH` (update role/displayName/email/isActive), `DELETE` (deactivate — sets `isActive=false`; never hard-deletes to preserve audit trail). Audits `admin_user.update` / `admin_user.deactivate`. SUPER_ADMIN only. Self-deactivation is blocked (lockout guard).

## Key decisions

- **Threshold suppression shape**: The overview route returns `count` + `suppressed: boolean` per section AND per executive (the raw count is still returned for admin situational awareness; the frontend should mask the displayed value when `suppressed=true`). The detailed report routes (environment, future, executive) return the spec's literal `{ suppressed: true, message: MESSAGES.belowThreshold, threshold, totalResponses, questions: [] }` envelope — no per-question aggregates leaked. The executive route additionally returns the (zeroed-out) `campaign`, `executive`, and `evaluationCount` for UI continuity.

- **Per-section vs per-question suppression**: Section-level suppression only, per the spec. If a single question has very few responses (e.g., 1) within a non-suppressed section, we still expose its aggregates. The orchestrator may add per-question suppression as a follow-up if anonymity auditors flag this.

- **Favorable rate computation**: `favorableCount / validCount` where `validCount` is responses with `selectedScore !== null` (so `not_applicable` and any unscored multi-choice selections are excluded from the denominator). Returns `null` when `validCount === 0`. Frontend should handle null.

- **Dimension rollups**: Group per-question averages by `snapshot.dimension` (only questions with non-null `averageScore` and non-null `dimension` contribute to the rollup). The dimension average is the unweighted mean of the per-question averages (not the per-response average — this gives each question equal weight in the dimension score, matching common reporting conventions). `dimensionLabelAr` is resolved from `LEADERSHIP_DIMENSIONS` constants.

- **Strength/improvement areas**: Dimensions sorted by `averageScore` descending; highest is `strength`, lowest is `improvement`. Both null when there are zero scored dimensions.

- **Org-wide comparison**: Computed across ALL exec responses for this campaign (including the exec in question — that's the standard interpretation of "organization-wide"). Per-question averages → per-dimension averages (same rollup logic). Returned as `orgWideComparison: { totalResponses, suppressed, dimensions: [...] }` so the frontend can show "your 4.2 vs org 3.8" or mask when org-wide is itself suppressed.

- **CSV escaping**: RFC-4180 compliant — wraps a field in double-quotes if it contains a comma, double-quote, newline/CR, or leading/trailing whitespace; doubles any internal double-quotes. UTF-8 BOM prefix (`\uFEFF`) so Excel auto-detects UTF-8 and renders Arabic correctly. CRLF line endings for Excel compatibility.

- **CSV value columns**: Fixed order `always, often, sometimes, rarely, never, not_applicable` regardless of which scale the question uses. For questions whose options don't include all 6 (e.g., environment-style "agree_strongly" etc.), the missing buckets will always be 0 — this is the spec's literal header requirement.

- **Audit log AdminUser join**: There's NO Prisma relation between `AuditLog` and `AdminUser` (only `adminUserId String?` FK in the schema). I do the join in JS: collect distinct `adminUserId`s from the page, fetch them in a single `findMany`, and build a `Map<id, AdminUser>`. This avoids N+1.

- **Settings + user management not restricted to SUPER_ADMIN**: The task only specifies SUPER_ADMIN for user-management routes. Settings routes are open to both roles per the spec wording ("Auth-check + audit" without role restriction). I followed this literally.

- **Soft-delete for admin users**: `DELETE` never hard-deletes — it sets `isActive=false` to preserve the audit trail. Added a self-deactivation lockout guard (a SUPER_ADMIN can't deactivate themselves while logged in). Idempotent: if the user is already inactive, the route returns success without writing an audit entry.

- **`dynamic = "force-dynamic"`** on every file, no `'use server'` directive, all handlers wrapped with `apiHandler`, all mutations write audit logs (best-effort, outside any transaction — matches the Task 2-a convention).

## Cross-agent contracts (for the frontend agent)

### Suppression response shape (CRITICAL)
The detailed report routes return one of two shapes:
1. Suppressed: `{ ok: true, data: { suppressed: true, message: MESSAGES.belowThreshold, threshold, totalResponses: N, questions: [] } }` (HTTP 200, NOT 400). Frontend should render the `message` and a lock icon — no per-question data is exposed.
2. Not suppressed: `{ ok: true, data: { suppressed: false, campaign: {...}, totalResponses: N, questions: [...] } }`. Render the questions array.

The executive route adds `campaign`, `executive`, `evaluationCount`, `dimensions`, `strength`, `improvement`, `orgWideComparison` to the non-suppressed shape, and `null` for `strength`/`improvement`/`orgWideComparison` in the suppressed shape (plus an empty `dimensions: []`).

The overview route is NOT subject to the suppression envelope — it returns the raw `count` + `suppressed: boolean` per section/per executive. Frontend should mask the displayed count when `suppressed=true`.

### Dashboard shape
```
{ ok: true, data: {
    campaignsByStatus: [{ status: "draft"|"scheduled"|"active"|"closed"|"archived", count }],
    totals: { activeExecutives, activeQuestions, responses, campaigns },
    latestCampaign: { id, titleAr, status, responseCount } | null
}}
```

### Reports overview shape
```
{ ok: true, data: {
    campaign: { id, titleAr, descriptionAr, status, startsAt, endsAt, timezone,
                minimumReportingThreshold, enableEnvironmentSurvey, enableFutureSurvey,
                allowMultipleExecutiveEvaluations, activatedAt, closedAt },
    sectionTotals: { environment: {count, suppressed}, future: {...}, executive: {...} },
    executives: [{ executiveId, nameAr, titleAr, category, departmentAr,
                  evaluationCount, suppressed }]
}}
```

### Environment/future report shape
See "Suppression response shape" above. Per-question: `{ snapshotId, questionCode, questionAr, dimension, count, validCount, averageScore, distribution: [{value, labelAr, count}], favorableRate, notApplicableCount }`. Future distribution entries also have `percentage` (0..100, 2dp).

### Per-executive report shape
See "Suppression response shape" above. Non-suppressed adds: `evaluationCount`, `questions: [...]` (same as env), `dimensions: [{ dimension, dimensionLabelAr, averageScore, questionCount }]`, `strength`/`improvement: { dimension, dimensionLabelAr, averageScore } | null`, `orgWideComparison: { totalResponses, suppressed, dimensions: [...] }`.

### CSV export
- Returns raw CSV text body (NOT JSON).
- HTTP 200 on success; 401 if not authed; 400 if `?format=` is not `csv`; 404 if campaign missing.
- The audit log entry uses `action: "report.export"`, `entityType: "campaign"`, with `metadata: { format: "csv", rowCount, threshold }`.

### Audit log shape
```
{ ok: true, data: {
    items: [{ id, action, entityType, entityId, campaignId, metadata: object|string|null,
              createdAt, adminUser: { id, displayName, externalId, role } | null }],
    page, pageSize, total, totalPages
}}
```
Filters via query params: `campaignId`, `action`, `entityType`, `page` (default 1), `pageSize` (default 50, clamped to 200).

### Settings shape
- `GET /api/admin/settings` → `{ ok: true, data: { settings: [{ id, key, valueAr, updatedAt }] } }`
- `GET /api/admin/settings/[key]` → `{ ok: true, data: { id, key, valueAr, updatedAt } }` or 404
- `POST /api/admin/settings` (upsert) → `{ ok: true, data: { id, key, valueAr, updatedAt } }`
- `PATCH /api/admin/settings/[key]` (update valueAr) → same shape; 404 if not found
- `DELETE /api/admin/settings/[key]` → `{ ok: true, data: { id, key, deleted: true } }`

### Admin user shape
- `GET /api/admin/users` → `{ ok: true, data: { users: [{ id, externalId, displayName, email, role, isActive, createdAt, updatedAt }] } }`
- `POST /api/admin/users` → 201 with the new user object; 409 if `externalId` exists; 403 if SURVEY_ADMIN
- `GET /api/admin/users/[id]` → user object or 404
- `PATCH /api/admin/users/[id]` → updated user object; 404 if not found
- `DELETE /api/admin/users/[id]` → `{ id, externalId, isActive: false, deactivated: true|false }`; idempotent if already inactive (returns `deactivated: false`); 400 if attempting self-deactivation

## Audit actions used
- `report.export` (CSV export)
- `settings.update` (POST + PATCH on settings)
- `settings.delete` (DELETE on a setting)
- `admin_user.create` (POST new admin)
- `admin_user.update` (PATCH admin)
- `admin_user.deactivate` (DELETE admin — soft-delete)

## Verification
- `bun run lint`: ZERO errors/warnings in any of my 11 files. Only pre-existing errors remain in `src/lib/admin-auth.ts` (2 `require()` errors) and `prisma/seed.ts` (1 unused eslint-disable warning) — both out of my scope per the rules.
- `bunx tsc --noEmit`: ZERO type errors in my files. Only out-of-scope errors in `examples/` and `skills/`.

## Unresolved issues / follow-ups for the orchestrator

- **CRITICAL: slug-name conflict between Task 2-a and Task 2-b**. The dev server log shows repeated `Error: You cannot use different slug names for the same dynamic path ('id' !== 'campaignId')` warnings. This is a conflict at `/api/admin/campaigns/[dynamic]/` — Task 2-a used slug `[id]` while Task 2-b used slug `[campaignId]` in the SAME parent folder. Both routes' handlers can't be loaded simultaneously. **My routes are NOT affected** — they live under different parent paths (`/api/admin/reports/[campaignId]`, `/api/admin/users/[id]`, `/api/admin/settings/[key]`). Recommended fix: rename Task 2-b's `campaigns/[campaignId]/...` directories to `campaigns/[id]/...` to match Task 2-a's convention (or vice versa). The orchestrator should coordinate this BEFORE the next dev-server reload.
- **Pre-existing lint errors in `src/lib/admin-auth.ts`** (2 `require()` errors from `makeSessionToken`/`parseSessionToken`). Still flagged from Task 2-a's report — fix is `import { createHmac } from "crypto"` at the top of the file.
- **Per-question threshold suppression not implemented** — only section-level. Flagged for review if anonymity auditors want stricter masking.
- **`metricsJson` is parsed and returned as-is** in the audit log route. The writer convention guarantees no employee data lands here, but the route does NOT defensively redact sensitive keys. If the orchestrator wants belt-and-suspenders, add a key-redaction pass in the audit-log route (e.g., strip any `employeeHmac`, `employeeId`, `ip`, `email` keys from the parsed object before returning).
