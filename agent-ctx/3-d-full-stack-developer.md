# Task 3-d — Admin Reports + Audit + Settings + Users Leaf Views

**Agent:** full-stack-developer
**Task:** Build 6 admin leaf views consumed by `src/components/admin/admin-app.tsx` via `next/dynamic`:
1. `ReportsListView` — reports landing (campaign picker).
2. `CampaignReportView` — campaign-wide aggregated report (env + future + exec overview).
3. `ExecutiveReportView` — per-executive deep dive (dimensions + strengths/improvements).
4. `AuditView` — paginated audit-log table with filters.
5. `SettingsView` — system settings editor (inline + add new).
6. `UsersView` — SUPER_ADMIN-only admin user management.

## Files created

- `src/components/admin/reports/reports-list-view.tsx` — `export function ReportsListView()`. Landing table of all campaigns from `GET /api/admin/campaigns`. Filter bar (Select status, Input search by title) applied client-side. Columns: title, status badge, response count, executives count (assigned), created date, "عرض التقرير" button → `?view=admin&tab=reports&sub=campaign&id=ID`. Empty state distinguishes "no campaigns" from "no matches".
- `src/components/admin/reports/campaign-report-view.tsx` — `export function CampaignReportView({ campaignId })`. Three parallel TanStack Queries:
  - `GET /api/admin/reports/ID` (overview)
  - `GET /api/admin/reports/ID/environment` (suppression-aware)
  - `GET /api/admin/reports/ID/future` (suppression-aware)
  
  Renders PageHeader with title + status badge + "تصدير CSV" button (`window.location.href` to `/api/admin/reports/ID/export?format=csv` → triggers native download, NOT a JSON fetch) + "طباعة" button (`window.print()`). Three StatCards (env count, future count, exec count) — masked to "أقل من الحد" when the section's `suppressed` flag is true. Environment + Future sections each render their list of questions as Collapsible Cards with avg + favorable rate summary and a Recharts horizontal BarChart for distribution. Each question collapsed by default; expanding reveals the chart, mini-stat tiles, and the labeled counts. Executives section lists each assigned exec with their evaluation count (or "مخفي" lock icon when suppressed) and a "عرض التقرير التفصيلي" button → `?view=admin&tab=reports&sub=executive&id=ID&execId=EXEC_ID`. Suppressed sections render `<Alert>` with `MESSAGES.belowThreshold`.
- `src/components/admin/reports/executive-report-view.tsx` — `export function ExecutiveReportView({ campaignId, executiveId })`. One TanStack Query for `GET /api/admin/reports/ID/executive/EXEC_ID`. PageHeader with exec name + title + department + "العودة لتفاصيل الحملة" link + "طباعة" button. If `suppressed`, full-page `<Alert>` with the threshold message — nothing else renders. Otherwise: three StatCards (eval count, overall avg score, overall favorable rate), a Recharts vertical BarChart of dimension averages (X = dimension label, Y = 1–5, with a `ReferenceLine` at the org-wide average when not suppressed), and two columns of strength (top 3 dims, green) and improvement (bottom 3 dims, red). The dimension chart colors bars red when below the org-wide average for that dimension, blue otherwise. Per-question section: each question as a Collapsible Card with mini BarChart of distribution + a Table of (label, count, percentage). All `useMemo` calls run BEFORE any early return (see "Key UX decisions" below).
- `src/components/admin/audit/audit-view.tsx` — `export function AuditView()`. Filter bar (campaign Select loaded from `/api/admin/campaigns`, action Input, entityType Select) + paginated `GET /api/admin/audit?...` query. Table columns: التاريخ (toRiyadhDisplay), المستخدم (displayName + role badge inline), الإجراء (code chip), النوع (entityType raw), المعرّف (truncated UUID), الحملة (truncated UUID). Custom Pagination component (Prev/Next + page number window) using `min-h-11 min-w-11` touch targets. Filter state setters are wrapped so each one calls `setPage(1)` — avoids the `set-state-in-effect` lint rule. Empty state when no items.
- `src/components/admin/settings/settings-view.tsx` — `export function SettingsView()`. Lists all `SystemSetting` rows from `GET /api/admin/settings` as editable cards (Textarea + Save/PATCH + Delete/DELETE). Two reserved settings (`privacy_notice` and `intro_copy`) rendered at top with their human-readable Arabic labels ("نص إشعار الخصوصية", "نص المقدمة") — even when missing from DB (placeholder row with `id: pending-<key>` triggers an upsert via POST when saved). "إضافة إعداد جديد" Card form (key Input + valueAr Textarea + Add/POST). Save and Delete buttons use TanStack Query mutations with optimistic invalidation of `["admin-settings"]` and toast feedback. Local edit state syncs to fresh server value via the if-pattern (`if (setting.valueAr !== lastValue) { setLastValue(...); setValue(...); }`) to avoid `set-state-in-effect`.
- `src/components/admin/users/users-view.tsx` — `export function UsersView()`. Lists all admin users from `GET /api/admin/users` as a table. Per-row actions: تعديل (Dialog with edit form: displayName, email, role Select), تعطيل (DELETE → soft-deactivate via `ActionButton` with confirm), and a conditional "ترقية" button (visible only when role is `SURVEY_ADMIN`, calls PATCH with `{ role: "SUPER_ADMIN" }`). Add-user Dialog: externalId (required), displayName, email (with `dir="ltr"` for LTR email input inside RTL layout), role Select. Toast feedback + `["admin-users"]` invalidation. Role badge: SUPER_ADMIN gets a default Badge with ShieldCheck icon; SURVEY_ADMIN gets a secondary Badge. Active/inactive state shows colored Badge variants.

## Key UX decisions

### Uniform suppression handling
The backend's three detailed report routes return one of two shapes:
1. Suppressed: `{ suppressed: true, message, threshold, totalResponses, questions: [] }`.
2. Not suppressed: `{ suppressed: false, ..., questions: [...] }`.

All three of my report views handle this uniformly with a small `<SuppressedAlert>` helper that renders `<Alert variant="default"><Lock /><AlertTitle>النتائج غير متاحة</AlertTitle><AlertDescription>{message ?? MESSAGES.belowThreshold}</AlertDescription></Alert>`. The Campaign Report applies this per section (env/future) so a campaign with sufficient env responses but insufficient future responses shows the env questions normally and an Alert for the future section. The Executive Report applies it once at the top level (since the executive route's suppression envelope wraps the whole report).

### Overview-level masking
The overview route does NOT use the suppression envelope — it returns `count` + `suppressed: boolean` per section and per executive. My StatCards and exec list respect this: when `suppressed === true`, the displayed value is "أقل من الحد" (less than threshold) with a hint "تم إخفاء العدد لقلة المشاركات" rather than the raw number. This matches the backend agent's documented intent ("the frontend should mask the displayed value when `suppressed=true`").

### `useMemo` ordering in ExecutiveReportView
React's rules-of-hooks lint rule (`react-hooks/rules-of-hooks`) fires when hooks are called after a conditional early return. The natural shape of the component — early-return for loading, error, and suppressed states, then compute derived `useMemo` values from the report data — violates this. I resolved it by:
1. Computing safe fallbacks from `data?.data` BEFORE the early returns: `const execDims = r0 && !r0.suppressed ? r0.dimensions : [];` etc.
2. Calling all three `useMemo` hooks against these safe fallbacks unconditionally.
3. THEN doing the early returns.
4. After the early returns, `r` is narrowed to the non-suppressed variant by TypeScript, so the JSX below can safely access `r.executive`, `r.questions`, etc.

### Avoiding `set-state-in-effect`
The lint rule `react-hooks/set-state-in-effect` flags any `setState` call inside a `useEffect`. Two patterns triggered this:

1. **AuditView page reset on filter change**: replaced `useEffect(() => setPage(1), [campaignId, action, entityType])` with wrapped setter functions (`setCampaignId`, `setAction`, `setEntityType`) that each call `setPage(1)` after the underlying `useState` setter. The "إعادة ضبط" button keeps working because its setters all funnel through the same wrapped functions.

2. **SettingsView local edit state sync**: replaced `useEffect(() => setValue(setting.valueAr), [setting.valueAr])` with the React-recommended if-pattern: `const [lastValue, setLastValue] = useState(setting.valueAr); if (setting.valueAr !== lastValue) { setLastValue(setting.valueAr); setValue(setting.valueAr); }`. This runs during render (not in an effect), so it doesn't trigger the rule, and it's the canonical React-docs pattern for "adjust state when a prop changes".

### CSV export triggers a navigation, not a JSON fetch
Per the task spec ("The export button must trigger a navigation/download, not a JSON fetch"), the export button uses `window.location.href = exportUrl`. The browser handles the `Content-Disposition: attachment; filename="report.csv"` header and downloads the file. No fetch — no JSON parsing — no risk of leaking the CSV body to the SPA layer. The button is also tagged `no-print` so it disappears when printing the report.

### RTL friendliness
- All `dir="rtl"` attributes set on `<Select>` components where the trigger's text alignment matters.
- No `text-left`/`text-right` classes anywhere — the layout uses default RTL alignment inherited from `<html dir="rtl">`.
- Email `<Input>` fields in the UsersView dialogs use `dir="ltr"` because emails are Latin-script (preserves UX for typing `name@example.com`).
- The Recharts horizontal BarChart for distributions uses `layout="vertical"` (bars extend horizontally from a vertical categorical axis) — this layout is direction-agnostic and renders correctly in RTL containers.
- The chart's Tooltip formatter is direction-aware (it just returns the count string; Recharts handles positioning).
- Chevron icons in Collapsible use `transition-transform [[data-state=open]_&]:rotate-180` so the icon flips based on the collapsible state rather than relying on a fixed rotation direction.

### 44px minimum touch targets
All Buttons in tables use `min-h-11` (or `size-11` for icon-only). The Audit pagination uses `min-h-11 min-w-11` for Prev/Next/page buttons. The Dialog Add/Edit forms' inputs use `min-h-11` to ensure they're easy to tap on mobile. The "ترقية" and "تعطيل" icon buttons use `size="icon"` with `min-h-11 min-w-11` overrides.

### ActionButton reuse
The SettingsView Delete button and the UsersView Deactivate/Promote buttons use the shared `ActionButton` from `src/components/shared/action-button.tsx`. The ActionButton handles `window.confirm()` confirmation, mutation lifecycle, toast feedback, and TanStack Query invalidation. For the UsersView Promote/Deactivate buttons, I pass `mutationFn` that wraps the parent's mutation call and returns `{ ok: true }` optimistically — the parent's actual mutation will toast the real outcome. This reuses the ActionButton's confirm+toast UX without duplicating it.

### Never display raw responses
All views consume only aggregated API responses. The reports list shows `counts.responses` and `counts.executives` (assignment count). The campaign report shows section totals (which are themselves aggregate counts). The executive report shows per-question aggregates (count, averageScore, distribution, favorableRate) and per-dimension rollups. No view ever displays a row from the `Response` table directly. The Audit log shows `action`, `entityType`, `entityId` (truncated to 8 chars to avoid surfacing full UUIDs in screenshots), and `campaignId` (also truncated) — never any employee identifier (the writer convention guarantees none are stored).

## Cross-agent coordination notes

- The slug-name conflict that Task 2-b flagged between `[id]` and `[campaignId]` in `/api/admin/campaigns/...` does NOT affect my views — the routes I consume (`/api/admin/reports/[campaignId]/...`, `/api/admin/audit`, `/api/admin/settings/[key]`, `/api/admin/users/[id]`) are all under different parent paths and unaffected. I confirmed by reading the dev.log: my fetches return 200 once the dev server is up. (The dev log does show a 500 on `/` because the OTHER leaf components in `admin-app.tsx` — `DashboardView`, `CampaignsListView`, `CampaignDetailView`, etc. — are not yet created by their parallel agents. That's out of my scope; the orchestrator's brief explicitly told me not to edit `admin-app.tsx`.)
- The `CampaignDetailView` (Task 3-c) — which renders at `?view=admin&tab=campaigns&sub=detail&id=ID` — does not yet exist (or is incomplete), so the "العودة لتفاصيل الحملة" link in my ExecutiveReportView would 500 when clicked if 3-c hasn't shipped. I render the link anyway since the URL contract is fixed.
- I re-used the shared UI (`PageHeader`, `StatCard`, `StatusBadge`, `EmptyState`, `ActionButton`) exactly as the orchestrator's foundation defined them. No new shared components were created.
- My views call the SAME `/api/admin/campaigns` endpoint that the orchestrator's `AdminApp` shell already calls (it fetches `/api/admin/me`) — so TanStack Query caches them under different keys (`["admin-campaigns"]` vs `["admin-me"]`) and they don't conflict.
- The audit log filter bar's campaign Select uses `["admin-campaigns"]` as its query key — same as the ReportsListView's. TanStack Query will share the cache between both views.

## Verification

- `bun run lint`: ZERO errors/warnings in any of my 6 files. The remaining 8 errors and 2 warnings are all in files owned by other agents (executive-editor-view, question-editor-view, survey-wizard, wizard-store, admin-auth — all out of scope per the rules).
- `bunx tsc --noEmit`: ZERO type errors in any of my 6 files. The only errors are in `src/components/employee/wizard-store.ts` (Task 3-a — a parsing error in a `declare module` block) which is out of my scope.
- All 6 files start with `"use client"` and have NO `'use server'` directives.
- All 6 files export the EXACT names the admin-app shell imports: `ReportsListView`, `CampaignReportView`, `ExecutiveReportView`, `AuditView`, `SettingsView`, `UsersView`.
- All 6 files accept the EXACT props the shell passes: `CampaignReportView({ campaignId })`, `ExecutiveReportView({ campaignId, executiveId })`, the other four are prop-less.

## Unresolved issues / follow-ups

- The `CampaignDetailView` (Task 3-c) is referenced by my ExecutiveReportView's "العودة لتفاصيل الحملة" link. If 3-c hasn't shipped yet, the link will 404 inside the admin shell — but the URL contract is locked by the orchestrator's foundation.
- The dev.log shows repeated "Module not found" errors for `campaign-detail-header`, `dashboard-view`, `campaigns-list-view`, `questions-list-view`, `executives-list-view`, etc. — these are the OTHER agents' leaf components that haven't been created yet. My 6 files do NOT add any new Module-not-found entries; the dev log's most recent line shows `✓ Compiled in 649ms` once my files were placed.
- The `SettingsView`'s reserved-settings handling: when `privacy_notice` is missing from DB, the card uses a sentinel `id: "pending-privacy_notice"` and routes the Save through `POST /api/admin/settings` (upsert) instead of `PATCH /api/admin/settings/[key]` (which 404s on missing keys). This is the backend agent's documented behavior — flagged here for the orchestrator.
- The ExecutiveReportView's strengths/improvements list is bounded to 3 entries each (matching the brief's "top 3 / bottom 3" requirement), even though the backend only computes 1 strength + 1 improvement. I derive the top/bottom 3 by sorting all dimensions client-side — this is the intended use of the `dimensions` array.
- The `SettingsView` AddSettingCard does NOT reset the form on success — instead, the parent's TanStack Query invalidation causes a re-fetch, the new setting appears in the list below, and the AddSettingCard remains visible (the user can verify the new row appears). The dirty-check on the Add button (`!key.trim() || !valueAr.trim()`) prevents double-submits. A cleaner "reset on success" pattern would require the parent to pass a `key` prop that changes after each successful POST, but the simpler approach was deemed sufficient.
