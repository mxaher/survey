# استبيان بيئة العمل والقيادة المؤسسية — مجموعة المرشد

**Anonymous Arabic Employee Survey & Executive Evaluation Platform for Almarshad Holding**

A production-ready, Arabic-first, fully RTL internal web application for running recurring anonymous employee surveys covering:
1. Overall work environment
2. Leadership / executive behavior
3. Employee perception of management
4. The kind of work environment employees want the company to build

**Purpose:** Give leadership a credible, privacy-safe read on organizational health and individual leadership behavior patterns — for development, not for ranking or disciplinary use.

---

## Table of Contents

1. [Technology Stack](#technology-stack)
2. [Quick Start](#quick-start)
3. [Project Architecture](#project-architecture)
4. [Database Schema](#database-schema)
5. [Privacy Architecture (Critical)](#privacy-architecture-critical)
6. [API Reference](#api-reference)
7. [Frontend Architecture](#frontend-architecture)
8. [File Map](#file-map)
9. [Conventions & Patterns](#conventions--patterns)
10. [Development Workflow](#development-workflow)
11. [Recurring Cron Job](#recurring-cron-job)
12. [Known Limitations](#known-limitations)

---

## Technology Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router, Turbopack) |
| **Runtime** | Cloudflare Workers (via @opennextjs/cloudflare) |
| **Language** | TypeScript 5 (strict) |
| **Styling** | Tailwind CSS 4 + shadcn/ui (New York style) |
| **Database** | Cloudflare D1 (raw binding, no ORM) |
| **State** | Zustand (client) + TanStack Query (server) |
| **Charts** | Recharts |
| **Icons** | lucide-react |
| **Fonts** | Tajawal (Arabic + Latin) |
| **Theme** | next-themes (light/dark) |
| **Exports** | xlsx (XLSX) + native CSV |
| **DnD** | @dnd-kit/core + @dnd-kit/sortable |

### Key Dependencies

```
next@^16.1.1  react@^19
@opennextjs/cloudflare  wrangler  @cloudflare/workers-types
@tanstack/react-query  zustand  recharts  lucide-react
next-themes  framer-motion  @dnd-kit/*  xlsx  zod
```

### Path Alias

```json
{ "@/*": ["./src/*"] }
```

All imports use `@/lib/...`, `@/components/...`, `@/app/...`.

---

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Create D1 database locally
npx wrangler d1 create almrshad-survey-db
# Copy the database_id into wrangler.toml

# 3. Run D1 migrations locally
bun run db:migrate

# 4. Seed demo data
bun run db:seed

# 5. Start dev server (port 3000)
bun run dev
```

### Cloudflare Workers Deployment

```bash
# 1. Create D1 database (first time only)
npx wrangler d1 create almrshad-survey-db
# Update wrangler.toml with the database_id

# 2. Run migrations against production D1
bun run db:migrate:prod

# 3. Set secrets
npx wrangler secret put EMPLOYEE_HMAC_SECRET
npx wrangler secret put ADMIN_AUTH_SECRET

# 4. Email for employee self-registration (verification links)
npx wrangler secret put RESEND_API_KEY   # optional: Mailjet keys work too

# 5. Build and deploy
bun run deploy
```

### Scripts

| Script | Purpose |
|---|---|
| `bun run dev` | Start dev server on port 3000 (Turbopack) |
| `bun run lint` | ESLint check (must be 0 errors) |
| `bun test tests` | Bun test suite (migrations, scoring engine, report endpoints, exports) |
| `bun run build` | Production build |
| `bun run db:migrate` | Run D1 migrations locally |
| `bun run db:migrate:prod` | Run D1 migrations against production |
| `bun run db:seed` | Seed demo data |
| `bun run deploy` | Build and deploy to Cloudflare Workers |

### Environment Variables

Secrets are managed via Cloudflare Workers bindings:

```bash
# Local development: create .dev.vars (never committed)
cp .dev.vars.example .dev.vars
# Fill in EMPLOYEE_HMAC_SECRET and ADMIN_AUTH_SECRET

# Production: set via Wrangler secrets
npx wrangler secret put EMPLOYEE_HMAC_SECRET
npx wrangler secret put ADMIN_AUTH_SECRET
npx wrangler secret put RESEND_API_KEY        # optional: verification emails
```

| Name | Kind | Purpose |
|---|---|---|
| `EMPLOYEE_HMAC_SECRET` | secret | HMAC key for the de-identified participation ledger (required) |
| `RESEND_API_KEY` | secret | Primary email provider for registration verification links |
| `MAILJET_API_KEY` / `MAILJET_SECRET_KEY` | secret | Fallback email provider |
| `EMAIL_FROM` | var/secret | Verified sender address, e.g. `survey@almarshad.com` (required for self-registration) |
| `EMAIL_FROM_NAME` | var | Optional sender display name (defaults to `استبيان بيئة العمل`) |

> **Employee self-registration** (`/?view=employee` → «إنشاء حساب موظف») only works once an
> email provider and `EMAIL_FROM` are configured: registration emails a one-time link to the
> corporate mailbox, and the account stays locked until that link is opened. Admin-created
> accounts are trusted immediately and never need the link.

---

## Project Architecture

### Single-Page App with URL-Based Routing

The user can only see **one route** (`/`). Navigation is via URL search params:

```
/?view=employee                              → Employee survey wizard (default)
/?view=admin                                 → Admin dashboard
/?view=admin&tab=campaigns                   → Campaigns list
/?view=admin&tab=campaigns&sub=editor&id=X  → Campaign editor (id=new for create)
/?view=admin&tab=campaigns&sub=detail&id=X   → Campaign detail (with sub-tabs)
/?view=admin&tab=campaigns&sub=archive       → Archived campaigns grid
/?view=admin&tab=questions                   → Question library
/?view=admin&tab=questions&sub=editor&id=X   → Question editor (id=new for create)
/?view=admin&tab=executives                  → Executives registry
/?view=admin&tab=reports                     → Reports landing (campaign list)
/?view=admin&tab=reports&sub=campaign&id=X   → Campaign report
/?view=admin&tab=reports&sub=executive&id=X&execId=Y → Executive detailed report
/?view=admin&tab=reports&sub=trend           → Cross-campaign trend comparison
/?view=admin&tab=audit                        → Audit log
/?view=admin&tab=settings                     → System settings
/?view=admin&tab=users                        → Admin user management (SUPER_ADMIN only)
```

### Entry Point

```
src/app/page.tsx
  └── ?view=employee → <EmployeeApp />  (src/components/employee/employee-app.tsx)
  └── ?view=admin    → <AdminApp />    (src/components/admin/admin-app.tsx, dynamic import)
```

### Admin Shell Structure

```
AdminApp (admin-app.tsx)
  ├── Header (sticky): logo + quick-search (⌘K) + theme toggle + notifications bell + user profile dropdown
  ├── Sidebar (nav): dashboard / campaigns / questions / executives / reports / audit / settings / users
  └── Main content: dynamically imported leaf views via next/dynamic
      └── <CommandPalette /> (Cmd+K global search)
```

---

## Database Schema

**File:** `migrations/0001_init.sql` (Cloudflare D1 / SQLite)

### Tables

| Table | Purpose |
|---|---|
| `Campaign` | Survey campaign with 5-state lifecycle (draft→scheduled→active→closed→archived) |
| `Executive` | Global registry of evaluable executives (CEO/executive/manager/department_head) |
| `CampaignExecutive` | Per-campaign executive assignment (M:N join table) |
| `Question` | Reusable question library (code, text, type, section, dimension, options) |
| `QuestionOption` | Answer options per question (value, labelAr, score, displayOrder) |
| `CampaignQuestionConfig` | Per-campaign question assignment (scope, required, order) |
| `CampaignQuestionSnapshot` | **Immutable** question snapshot frozen at activation |
| `CampaignQuestionOptionSnapshot` | **Immutable** option snapshot frozen at activation |
| `ParticipationLedger` | **PROTECTED identity layer** — HMAC + participation type + scope |
| `Response` | **Anonymous response layer** — no employee identifier of any kind |
| `AdminUser` | Admin accounts (SUPER_ADMIN / SURVEY_ADMIN) |
| `AuditLog` | Admin action audit trail (never contains employee data) |
| `SystemSetting` | Key/value system config (privacy notice, intro copy, eligible count) |

### Key Constraints

```sql
-- Race-condition-safe duplicate prevention:
UNIQUE(campaignId, employeeHmac, participationType, scopeKey)
-- on ParticipationLedger — SQLite enforces this at the DB level.

-- Question code uniqueness:
code TEXT NOT NULL UNIQUE
```

---

## Privacy Architecture (Critical)

This is the **most important** section. The spec mandates architectural anonymity, not just UI-level anonymity.

### Two Separated Layers

**A. Eligibility / Participation Layer (`participation_ledger`):**
- Knows: is this person an authorized employee? Have they already participated?
- Contains: `employee_hmac` (HMAC-SHA256 of normalized employee identifier)
- Used ONLY for: one-participation-per-employee + one-evaluation-per-executive-per-employee enforcement
- **NEVER** joined to `responses`

**B. Response Layer (`responses`):**
- Knows ONLY: which campaign, which executive (if applicable), which question snapshot, which selected value/score, when
- Linked via `response_group_id` — a random UUID generated at submission time, **not** derived from employee identity
- Contains **zero** employee identifiers: no name, email, HMAC, IP, user-agent, device fingerprint

### HMAC Identity Token

```
employee_hmac = HMAC_SHA256(EMPLOYEE_HMAC_SECRET, normalized_employee_identifier)
```

- Secret lives only in server-side env (`src/lib/employee-hmac.ts`)
- HMAC used **only** in `participation_ledger` WHERE clauses
- **NEVER** returned in any API response, **NEVER** logged

### Immutable Question Snapshots

At campaign activation (`POST /api/admin/campaigns/:id/activate`):
1. Readiness check (spec §11.7) — must pass all 9 checks
2. Freeze a snapshot of every assigned question + option into `campaign_question_snapshots` + `campaign_question_option_snapshots`
3. Responses reference the **snapshot**, never the live library question
4. This makes historical results trustworthy even if the library changes later

### Threshold Suppression

- **Section-level**: if distinct submitters (`responseGroupId` count) < `minimumReportingThreshold` (default **7**), the section returns a spec §8 gate: `{ reportAvailable: false, reason: "minimum_threshold_not_met", messageAr: "لا يمكن عرض نتائج هذه المجموعة حالياً حفاظاً على سرية المشاركين.", suppressed: true, respondentCount }` (legacy `suppressed` kept for old consumers)
- **Per-question**: if an individual question has `count < threshold`, that question's averages/distribution are masked (but the question text + raw count are still returned)
- Applied to all 4 report endpoints: environment, future, executive, summary — and to every export type (a blocked export downloads a one-row notice instead of data)
- Report + export responses send `Cache-Control: no-store`

### What Must NEVER Happen

- No employee identifier in `responses`, URLs, query strings, `localStorage`, analytics events, or response IDs
- No `employee_hmac` in any API response or log
- No survey answers in any log
- No raw employee identifier persisted next to responses

---

## API Reference

### Base URL

All API routes are relative: `GET /api/...`.

### Admin Auth

- `GET /api/admin/me` — current admin session
- `POST /api/admin/logout` — sign out
- `GET/POST /api/admin/dev-impersonate` — dev-mode employee identity picker

### Admin — Campaigns

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/campaigns` | List all campaigns (with `_count`) |
| POST | `/api/admin/campaigns` | Create draft campaign |
| GET/PATCH/DELETE | `/api/admin/campaigns/:id` | Get/update/delete (draft-only delete) |
| POST | `/api/admin/campaigns/:id/activate` | Activate (freezes snapshots, readiness check) |
| POST | `/api/admin/campaigns/:id/schedule` | Draft → scheduled |
| POST | `/api/admin/campaigns/:id/close` | Active → closed |
| POST | `/api/admin/campaigns/:id/archive` | Closed → archived |
| POST | `/api/admin/campaigns/:id/copy` | Duplicate campaign |
| GET | `/api/admin/campaigns/:id/readiness` | Readiness check result |
| GET | `/api/admin/campaigns/:id/preview` | Employee-UI data shape (read-only) |

### Admin — Questions + Executives + Assignments

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/admin/questions` | List / create questions |
| GET/PATCH/DELETE | `/api/admin/questions/:id` | Get/update/delete (soft-delete if used) |
| POST | `/api/admin/questions/:id/activate\|deactivate` | Toggle active |
| GET/POST | `/api/admin/campaigns/:id/questions` | List / assign questions to campaign |
| PATCH/DELETE | `/api/admin/campaigns/:id/questions/:questionId` | Update / remove assignment |
| POST | `/api/admin/campaigns/:id/questions/reorder` | DnD reorder |
| GET/POST | `/api/admin/executives` | List / create executives |
| GET/PATCH/DELETE | `/api/admin/executives/:id` | Get/update/delete |
| POST | `/api/admin/executives/:id/activate\|deactivate` | Toggle active |
| GET/POST | `/api/admin/campaigns/:id/executives` | List / assign executives |
| PATCH/DELETE | `/api/admin/campaigns/:id/executives/:executiveId` | Update / remove |
| POST | `/api/admin/campaigns/:id/executives/reorder` | DnD reorder |

### Admin — Reports + Exports

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/reports/:campaignId` | Campaign overview (counts + suppressed flags) |
| GET | `/api/admin/reports/:campaignId/summary` | Campaign summary (aggregate metrics + participation, threshold-gated) |
| GET | `/api/admin/reports/:campaignId/environment` | Env per-question aggregates (threshold-suppressed) |
| GET | `/api/admin/reports/:campaignId/future` | Future per-question distribution |
| GET | `/api/admin/reports/:campaignId/executive/:executiveId` | Per-exec dimension rollups + strengths/improvements |
| GET | `/api/admin/reports/:campaignId/export?type=...&format=csv\|xlsx` | 6 export types: `executive_questions`, `executive_summary`, `environment_summary`, `environment_questions`, `future_priorities`, `campaign_summary` (UTF-8 BOM CSV or RTL XLSX; audited as `report.export`) |
| GET | `/api/admin/reports/trend?status=all\|active\|closed` | Cross-campaign trend data |
| GET | `/api/admin/reports/trend/export?format=csv\|xlsx&status=...` | Trend CSV/XLSX export |

### Admin — Dashboard + System

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/dashboard` | KPIs + status distribution + org dimensions + participation + recent activity |
| GET | `/api/admin/system-stats` | DB size + table counts + last audit time |
| GET | `/api/admin/notifications` | Active campaign alerts (about-to-close, threshold-not-met, etc.) |
| GET | `/api/admin/search?q=...` | Global search (campaigns + questions + executives) |
| GET/POST | `/api/admin/settings` | List / upsert system settings |
| GET/PATCH/DELETE | `/api/admin/settings/:key` | Single setting CRUD |
| GET/POST | `/api/admin/users` | List / create admin users (SUPER_ADMIN only) |
| GET/PATCH/DELETE | `/api/admin/users/:id` | Single user CRUD (SUPER_ADMIN only) |
| GET | `/api/admin/audit` | Paginated audit log |

### Auth + Accounts

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/auth/setup` | First-run admin claim (works only while no admin has a password) |
| POST | `/api/auth/login` | Email + password (admin or employee) → httpOnly session cookie |
| POST | `/api/auth/logout` | Destroy the current session |
| GET | `/api/auth/me` | Current session (`authenticated`, admin/employee identity) |
| POST | `/api/auth/register` | Employee self-registration (gated to `@almarshad.com`, sends verification link) |
| GET | `/api/auth/verify?token=` | One-time verification link (HTML result page) |
| POST | `/api/auth/resend-verification` | Re-issue the verification link |
| GET/POST | `/api/admin/employees` | List / create employee accounts (mutations: SUPER_ADMIN) |
| PATCH/DELETE | `/api/admin/employees/:id` | Reset password / deactivate (SUPER_ADMIN) |

### Employee

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/employee/campaign` | Active campaign info + bundled env/future snapshots |
| GET | `/api/employee/executives?campaignId=X` | Available + already-evaluated executives |
| GET | `/api/employee/participation-status?campaignId=X` | Which sections are submitted |
| GET | `/api/employee/executives/:executiveId/questions` | Leadership question snapshots for one exec |
| POST | `/api/employee/environment/submit` | Submit environment section (atomic) |
| POST | `/api/employee/future/submit` | Submit future section (atomic) |
| POST | `/api/employee/evaluations/submit` | Submit one executive evaluation (atomic) |
| GET/POST | `/api/employee/draft` | Save/resume draft (currently returns 501) |

### API Response Shape

All JSON endpoints return:
```json
{ "ok": true, "data": { ... } }
// or
{ "ok": false, "error": "Arabic message" }
```

CSV/XLSX endpoints return raw file bodies with appropriate `Content-Type`.

---

## Frontend Architecture

### Employee Survey Flow (4-step wizard)

```
EmployeeApp (employee-app.tsx)
  ├── ImpersonationBanner (dev-mode 401 prompt or active-identity chip)
  └── phase: loading → no-campaign → intro → wizard → success
      └── SurveyWizard (survey-wizard.tsx)
          ├── Step 1: بيئة العمل (environment questions, 5-point agreement scale)
          ├── Step 2: تقييم القيادات (executive dropdown → leadership questions, 5(+1) frequency scale)
          ├── Step 3: البيئة المستقبلية (multi-choice / single-choice)
          └── Step 4: المراجعة والإرسال (review + confirm checkbox + submit)
```

- Wizard state: Zustand store (`wizard-store.ts`) persisted to `sessionStorage` (privacy — clears on tab close)
- Step navigation: ArrowLeft = next, ArrowRight = back (RTL) — only when not focused in an input
- Progress indicator with completed/active/upcoming states

### Admin Views

| View | File | Purpose |
|---|---|---|
| Dashboard | `dashboard-view.tsx` | 5 KPI StatCards + status distribution + org dimensions widget + system health + recent activity + dev impersonation panel |
| Campaigns list | `campaigns-list-view.tsx` | Table with health dots + status badge + density toggle + health filter + status filter + lifecycle actions dropdown |
| Campaign editor | `campaign-editor-view.tsx` | Full form with Zod validation + readiness-in-activate flow |
| Campaign detail | `campaign-detail-view.tsx` | 6 sub-tabs: settings / questions / executives / preview / readiness / results |
| Campaign archive | `campaign-archive-view.tsx` | Read-only card grid of archived campaigns |
| Questions library | `questions-list-view.tsx` | Filterable table with structural-edit locking |
| Question editor | `question-editor-view.tsx` | Form + DnD options editor + STANDARD_SCALES prefill |
| Executives list | `executives-list-view.tsx` | Filterable table |
| Executive editor | `executive-editor-view.tsx` | Form |
| Reports list | `reports-list-view.tsx` | Campaign table with "مقارنة الحملات" button |
| Campaign report | `campaign-report-view.tsx` | Env + future + exec sections, CSV/XLSX/print, per-question PNG download |
| Executive report | `executive-report-view.tsx` | Horizontal bar chart + strengths/improvements + per-question breakdown + chart PNG download |
| Trend report | `trend-report-view.tsx` | Comparison table + dimension line chart + participation rate chart + CSV/XLSX export |
| Audit log | `audit-view.tsx` | Paginated table with semantic action badges |
| Settings | `settings-view.tsx` | Inline editable system settings |
| Users | `users-view.tsx` | Admin user table with avatars + last-login + role badges |

### Shared Components

| Component | File | Purpose |
|---|---|---|
| `StatusBadge` | `shared/status-badge.tsx` | WCAG-compliant semantic colors + dot indicator |
| `StatCard` | `shared/stat-card.tsx` | KPI card with hover micro-interaction + tone prop |
| `PageHeader` | `shared/page-header.tsx` | Title + description + eyebrow + actions + gradient divider |
| `EmptyState` | `shared/empty-state.tsx` | Icon chip + title + description + action |
| `ActionButton` | `shared/action-button.tsx` | Confirm-and-mutate Button (handles loading + toast + query invalidation) |
| `ThemeToggle` | `shared/theme-toggle.tsx` | Light/dark mode toggle (next-themes) |
| `NotificationsBell` | `shared/notifications-bell.tsx` | Popover with campaign alerts |
| `CommandPalette` | `admin/command-palette.tsx` | Cmd+K global search + recently-viewed |

### Lib Helpers

| File | Purpose |
|---|---|
| `db.ts` | D1 database binding helper (`getDB()`) |
| `api.ts` | `ok()`, `fail()`, `noStore()`, `apiHandler()` response helpers |
| `admin-auth.ts` | Admin session via signed cookie (HMAC), SUPER_ADMIN/SURVEY_ADMIN roles, dev bootstrap |
| `identity.ts` | Dev-mode EmployeeIdentityProvider (cookie-based impersonation) |
| `employee-hmac.ts` | HMAC-SHA256 + `newResponseGroupId()` (random UUID) |
| `audit.ts` | `writeAudit()` — safe audit log writer (no employee data) |
| `audit-display.ts` | Shared `actionTone()` + `ENTITY_LABELS_AR` (used by audit view + dashboard) |
| `constants.ts` | CAMPAIGN_STATUSES, QUESTION_TYPES, STANDARD_SCALES, LEADERSHIP_DIMENSIONS, FAVORABLE_VALUES, CATEGORY_LABEL_AR, REPORT_CATEGORIES |
| `messages.ts` | All Arabic system messages (single source of truth per spec §4) |
| `scoring.ts` | Score validation, averages/index, distribution buckets, band + classification labels |
| `reporting.ts` | Report builders (environment/future/executive/summary) with spec §8 threshold gates |
| `report-export.ts` | CSV/XLSX builders for the 6 export types (RTL workbook, blocked-notice tables) |
| `time.ts` | `toRiyadhDisplay()`, `toRiyadhDate()`, `nowUtc()`, `isWithinActiveWindow()` |
| `readiness.ts` | `checkReadiness(campaignId)` — 9-point validation before activation |
| `utils.ts` | `cn()` (clsx + tailwind-merge) |

---

## File Map

```
survey/
├── .dev.vars.example               # Template for local dev secrets
├── package.json                    # Scripts + deps
├── wrangler.toml                   # Cloudflare Workers + D1 config
├── open-next.config.ts             # OpenNext.js Cloudflare adapter
├── migrations/
│   ├── 0001_init.sql               # D1 schema (13 tables)
│   ├── 0002_seed.sql               # Legacy seed (demo campaign, questions, executives)
│   ├── 0003_*.sql–0005_*.sql       # Indexes, hardening, registration
│   ├── 0006_scoring_schema.sql     # category/scale/scope + sentiment flags + indexes
│   └── 0007_question_bank_seed.sql # 36 approved questions + 228 options, camp-001 rewired (threshold 7)
├── tests/
│   ├── helpers/d1.ts               # In-memory D1 (bun:sqlite) + apiRequest helpers
│   ├── support/                    # bun:test / bun:sqlite ambient types
│   ├── unit/scoring.test.ts        # Pure scoring engine assertions
│   └── integration/                # migrations + report/summary/export endpoints
├── scripts/                        # Dev utilities (run with `bun run scripts/X.ts`)
│   ├── promote-admin.ts          # Promote dev admin to SUPER_ADMIN
│   ├── seed-responses.ts         # Seed executive evaluations
│   ├── seed-env-future.ts        # Seed environment + future responses
│   ├── set-dates.ts              # Set demo campaign dates
│   ├── set-eligible-count.ts     # Set eligible_employees_count SystemSetting
│   ├── cleanup-test-campaign.ts  # Delete test campaigns
│   ├── count-evals.ts            # Count evaluations per executive
│   └── get-qids.ts               # Get question IDs
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout (RTL, Tajawal font, ThemeProvider, Toaster)
│   │   ├── page.tsx              # Single route — ?view= switch
│   │   ├── globals.css           # Tailwind + Almarshad palette (navy/charcoal/gold) + dark mode + print CSS
│   │   └── api/                  # ~45 route handlers (see API Reference above)
│   ├── components/
│   │   ├── providers.tsx         # ThemeProvider + QueryClientProvider
│   │   ├── ui/                   # shadcn/ui components (60+ files, pre-installed)
│   │   ├── shared/               # 8 shared helpers (see Shared Components above)
│   │   ├── employee/             # 11 employee survey files
│   │   └── admin/                 # 18 admin view files + command-palette
│   ├── lib/                      # 12 lib helpers (see Lib Helpers above)
│   └── hooks/                    # use-toast.ts, use-mobile.ts
├── worklog.md                    # Detailed development history (Tasks 1–14)
└── dev.log                       # Next.js dev server log
```

---

## Conventions & Patterns

### Arabic + RTL

- `lang="ar" dir="rtl"` on `<html>` (layout.tsx)
- All user-facing text in Modern Standard Arabic
- System messages in `src/lib/messages.ts` (single source of truth)
- No `text-left`/`text-right` — rely on flex/grid which auto-mirror in RTL
- Arrow icons: "back/return" → `ArrowRight` (points right = back in RTL), "forward/open" → `ArrowLeft` (points left = forward)

### Styling

- Almarshad corporate palette: dark navy (`oklch(0.32 0.06 255)`) + neutral gray + restrained gold accent
- Status badges: WCAG-compliant semantic colors + dot indicator (never color-only per spec §4)
- Min 44px touch targets (48px for survey radios)
- Cards: hover micro-interaction (lift + shadow)
- Tables: `tabular-nums` + `font-feature-settings: "tnum" 1` for number alignment
- Loading: skeletons, never spinners for content areas
- Empty states: icon chip + title + description + optional action
- Print CSS: comprehensive `@media print` block (hides chrome, forces colors, avoids page-break-inside)

### API Route Handlers

```typescript
export const dynamic = "force-dynamic"; // always
export const GET = apiHandler(async (request: NextRequest, ctx) => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);
  // ... Zod validation ...
  // ... db.$transaction for atomic ops ...
  // ... writeAudit for mutations ...
  return ok({ ... });
});
```

- NO `'use server'` directive (these are route handlers, not server actions)
- Every admin endpoint: `getAdminUser()` first → 401 if null
- Every mutation: `writeAudit()` with admin ID + action + entity type
- Every employee/submission endpoint: `noStore()` (Cache-Control: no-store)
- Zod for input validation
- `db.$transaction` for multi-step atomic ops (especially activation, submissions)

### Dynamic Imports

Admin leaf views are loaded via `next/dynamic` with `{ ssr: false }` in `admin-app.tsx`. The shell uses known paths + export names as the contract for lazy-loaded components.

### Query Keys (TanStack Query)

Common keys:
- `["admin-dashboard"]`, `["admin-system-stats"]`, `["admin-notifications"]`
- `["admin-campaigns"]`, `["admin-campaigns", id]`
- `["admin-questions"]`, `["admin-executives"]`
- `["admin-report-overview", campaignId]`, `["admin-exec-report", campaignId, executiveId]`
- `["admin-report-trend", statusFilter]`
- `["admin-users"]`, `["admin-audit", ...]`
- `["employee-campaign"]`, `["employee-participation-status", campaignId]`
- `["admin-me"]`, `["admin-search", query]`, `["admin-dev-impersonate"]`

---

## Development Workflow

### Starting Work

1. Read `worklog.md` to understand current state
2. Run `bun run lint` — must be 0 errors
3. Check dev server is running on port 3000

### After Changes

1. Run `bun run lint`
2. Run `bun test tests` (must be all green — migrations apply from scratch on every run)
3. Smoke-test views: `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/?view=admin&tab=dashboard"`
4. Append a new section to `worklog.md`

### Worklog Format

```markdown
---
Task ID: <N>
Agent: <name>
Task: <one-line summary>

Work Log:
- <step 1>
- <step 2>

Stage Summary:
- <key results>
```

### Seeding Demo Data

```bash
bun run db:migrate                  # Applies 0001–0007 (0007 seeds the approved question bank)
bun run db:seed                    # Initial seed (questions, execs, demo campaign)
bun run scripts/set-dates.ts       # Set demo campaign dates (for activation)
bun run scripts/seed-responses.ts  # Seed executive evaluations (6 employees × 5 execs)
bun run scripts/seed-env-future.ts # Seed environment + future responses
bun run scripts/set-eligible-count.ts # Set eligible_employees_count = 50
bun run scripts/promote-admin.ts   # Promote dev admin to SUPER_ADMIN
```

Migration `0007_question_bank_seed.sql` is idempotent (keyed on `Question.code`, `INSERT OR
IGNORE`): re-running never duplicates rows. Its 36-row question insert is deliberately split
into three 12-row statements — D1 rejects single statements with more than ~500 compound
column-terms (`too many terms in compound SELECT`).

### Activating the Demo Campaign

1. `bun run scripts/set-dates.ts` (sets startsAt = now, endsAt = +30 days)
2. Open `/?view=admin&tab=campaigns`
3. Click "إجراءات" → "فتح الحملة (تفعيل)"
4. Confirm the activation dialog
5. The campaign is now active — employee view will show the survey

### Dev-Mode Employee Impersonation

In dev (NODE_ENV !== "production"):
- Admin dashboard has a "وضع التطوير" panel with an employee picker
- Selecting an employee + clicking "تطبيق" sets a cookie (`almrshd_dev_employee`)
- The employee view then uses this cookie to identify the "current employee"
- The HMAC is computed server-side from this cookie value
- In production, this would be replaced by Cloudflare Access / Entra ID / SSO

---

## Known Limitations

1. **Save/resume draft** — `GET/POST /api/employee/draft` returns 501. Persisting in-progress answers server-side would re-couple identity to answer content (architectural decision pending).

2. **Real SSO/IdP** — The app uses dev-mode cookie impersonation (`src/lib/identity.ts`). In production, this should be replaced with Cloudflare Access / Microsoft Entra ID / SSO via the same `getVerifiedEmployee()` interface. The README must say "de-identified" not "100% anonymous" because the identity provider / infra logs may retain data outside the app's control.

3. **Campaign comparison export with chart PNG embedded in XLSX** — Not yet implemented (requires server-side chart rendering — complex). The trend view has CSV/XLSX export of the raw data, but not the chart image itself.

4. **Eligible employee count** — The participation rate metric depends on a manually-set `SystemSetting` (`eligible_employees_count`), not an automated HR feed.

5. **Per-question threshold suppression** — Applied to all 4 report endpoints (environment, future, executive, summary) and to every export. The UI shows a Lock icon + "أقل من حد الإخفاء" message for suppressed questions.

6. **Print CSS** — Comprehensive `@media print` block exists in `globals.css`, but some chart-heavy views may not print perfectly (Recharts SVGs can overflow on small pages).

---

## Scoring Formulas (spec §5/§8)

```
valid        = numeric score AND value != 'not_applicable'
average      = sum(valid) / count(valid)                  // null when none valid
index        = average / 5 * 100
favorable%   = count(always + often) / count(valid) * 100
neutral%     = count(sometimes) / count(valid) * 100
unfavorable% = count(rarely + never) / count(valid) * 100
not_applicable% = count(na) / count(submitted) * 100      // null when none submitted
future rate  = count(picked) / unique respondent_groups * 100   // ranked desc, max 3 picks each
```

- "Valid" = `selectedScore !== null` (excludes "لا ينطبق" / `not_applicable`)
- Favorable values: `always`, `often`, `agree_strongly`, `agree` (see `FAVORABLE_VALUES` in `constants.ts`)
- Scoring is database-driven (option.score field), not hard-coded
- Engine: `src/lib/scoring.ts` + `src/lib/reporting.ts`; Arabic copy: `src/lib/messages.ts`
- Band per average: ≥4.50 مرتفع · ≥4.00 فوق المتوسط · ≥3.50 متوسط · ≥3.00 منخفض · else منخفض جداً
- Classification: **strength** (avg ≥4.00 AND favorable ≥75%) · **development** (avg <3.50 OR unfavorable ≥20%) · **priority** (avg <3.00 OR unfavorable ≥30%)
- Test suite (`bun test tests`) hand-computes these metrics against fixture data and asserts the spec+legacy payload shape, suppression gates, no-identity leakage, and all 6 export types

---

## Campaign Lifecycle

```
draft → scheduled → active → closed → archived
```

| State | Admin can | Employee can |
|---|---|---|
| Draft | Everything — add/edit/delete/reorder questions, sections, executives; configure dates, thresholds, rules; preview | Nothing (not visible) |
| Scheduled | Edit dates (if not started), description, assigned questions/executives; return to draft; cancel | Nothing yet |
| Active | View/export reports; close campaign; safely deactivate unused items | Participate once; evaluate any number of distinct executives, each once; save/resume if enabled |
| Closed | View/export reports (read-only config) | Nothing new; sees "campaign ended" message |
| Archived | Fully read-only; excluded from active-campaign selection | N/A |

On activation: create immutable question/option snapshots, record audit log entry, lock all structurally unsafe edit paths server-side.

---

## Audit Logging

Every admin mutation writes an `AuditLog` entry:

```typescript
await writeAudit({
  adminUserId: admin.adminId,
  action: "campaign.activate",     // entity.action format
  entityType: "campaign",
  entityId: campaignId,
  campaignId,
  metadata: { ... }                // NEVER employee data
});
```

Actions include: `campaign.create/edit/activate/close/archive/copy`, `question.create/edit/delete/activate/deactivate`, `executive.create/edit/delete/activate/deactivate`, `campaign_question.assign/remove/reorder`, `campaign_executive.assign/remove/reorder`, `report.export`, `settings.update`, `admin_user.create`.

The audit log table is viewable at `/?view=admin&tab=audit` with pagination + filters (campaign, action, entityType). The dashboard's "آخر النشاطات" widget shows the last 5 entries.

---

*Built with Next.js 16 + Cloudflare Workers + D1 + Tailwind 4 + shadcn/ui. Arabic-first, fully RTL. Privacy-architected with HMAC-separated identity layers. Production-ready.*
