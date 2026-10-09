 # Architecture

## 1. Shape

A **modular monolith**: one Next.js app deployed as one unit, internally split into modules
with clear ownership. No separate backend, no microservices, no queue, no cache.

```
Browser (React, mobile-friendly)
   │  HTML / RSC payloads / Server Action calls
   ▼
Next.js on Vercel ─────────────────────────────────────────────────────────┐
   proxy.ts            → refresh Supabase session cookie, redirect to /login │
   Server Components   → getTenantContext() → module queries → render       │
   Server Actions      → authedAction(): auth → tenant → permission → Zod   │
                         → service (tx: write + audit) → revalidate          │
   Route Handlers      → webhooks, public forms, file download, cron hooks   │
   └──────────── Drizzle (withRls / adminDb) ────────────────────────────────┘
                 │                               │
                 ▼                               ▼
      Supabase Postgres (RLS, pg_cron)     Supabase Auth · Supabase Storage (private bucket)
```

## 2. Folder structure

```
.
├── .claude/                  CLAUDE.md + rules/
├── docs/                     this specification
├── drizzle/                  generated + custom SQL migrations (committed)
├── supabase/                 config.toml for the local stack (Supabase CLI) — no migrations here
├── public/
├── src/
│   ├── app/
│   │   ├── (auth)/           login, forgot-password, reset-password, accept-invite
│   │   ├── (app)/            authenticated shell (sidebar, topbar, notifications)
│   │   │   ├── dashboard/
│   │   │   ├── my-day/       overdue / today / upcoming tasks + stale opportunities
│   │   │   ├── contacts/     list, [id], new
│   │   │   ├── opportunities/  list, [id], new
│   │   │   ├── pipeline/     kanban board (?pipeline=…)
│   │   │   ├── tasks/
│   │   │   ├── organizations/
│   │   │   ├── partners/
│   │   │   ├── reports/
│   │   │   ├── imports/
│   │   │   └── settings/     general, branding, labels, users, roles, teams, pipelines,
│   │   │                     fields, sources, lost-reasons, document-types, audit
│   │   ├── api/
│   │   │   ├── files/[id]/           permission check → audit → redirect to signed URL
│   │   │   ├── public/forms/[key]/   🟡 web-form intake
│   │   │   ├── webhooks/meta/        🟡 Meta Lead Ads
│   │   │   ├── webhooks/inbound-email/ 🟡 BCC email logging
│   │   │   └── v1/                   🔵 public API (API keys)
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/               shadcn/ui (generated)
│   │   ├── layout/           app shell, sidebar, page header
│   │   ├── data-table/       TanStack Table wrapper: sorting, filters, column visibility, pagination
│   │   ├── forms/            field components + <CustomFieldsSection/>
│   │   └── charts/           Recharts wrappers using theme tokens
│   ├── modules/
│   │   ├── contacts/         schemas.ts · queries.ts · service.ts · actions.ts · duplicates.ts · components/
│   │   ├── organizations/
│   │   ├── opportunities/    … + board.ts (board query) · stage-machine.ts
│   │   ├── pipelines/
│   │   ├── activities/
│   │   ├── tasks/
│   │   ├── documents/
│   │   ├── partners/
│   │   ├── products/
│   │   ├── custom-fields/    definitions CRUD + buildCustomFieldSchema()
│   │   ├── imports/          mapping, validation, chunked execution
│   │   ├── reports/          one file per report, each returns typed rows
│   │   ├── notifications/
│   │   ├── settings/         tenant settings, labels, branding, sources, lost reasons
│   │   ├── users/            invites, memberships, roles, teams
│   │   └── audit/            audit() + viewer queries
│   ├── db/
│   │   ├── schema/           one file per area (tenancy.ts, contacts.ts, …) + index.ts
│   │   ├── seed.ts
│   │   └── seed-data/
│   ├── server/
│   │   ├── db/               client.ts · with-rls.ts · admin.ts (server-only)
│   │   ├── supabase/         server.ts (cookie client) · admin.ts (service role, server-only)
│   │   ├── context.ts        getTenantContext()
│   │   └── action.ts         authedAction() + ActionResult
│   ├── lib/
│   │   ├── permissions/      catalog.ts · scope.ts · checks.ts
│   │   ├── tenant/           labels.ts · settings.ts (Zod) · branding.ts
│   │   ├── validation/       shared Zod primitives (phone, email, money, date)
│   │   ├── format/           dates in tenant tz, money, names
│   │   ├── csv/              export helpers
│   │   └── errors.ts         AppError + codes
│   └── types/
├── tests/
│   ├── unit/                 pure functions (scope, custom-field schema builder, stage machine, normalization)
│   ├── db/                   RLS, permissions, services against local Supabase
│   └── e2e/                  Playwright
├── .env.example
├── drizzle.config.ts
└── package.json
```

A single `src/modules/<x>/actions.ts` per module replaces a separate top-level `actions/` folder,
so a module's validation, rules, and endpoints sit together.

## 3. Request lifecycle

### Read (Server Component)
```ts
export default async function OpportunitiesPage({ searchParams }) {
  const ctx = await getTenantContext();                     // redirects to /login if needed
  requirePermission(ctx, 'opportunities.view');
  const data = await listOpportunities(ctx, parseFilters(searchParams));  // withRls + scopeFilter inside
  return <OpportunitiesTable data={data} labels={ctx.labels} />;
}
```

### Write (Server Action)
```ts
export const moveStageAction = authedAction(
  { permission: 'opportunities.edit', input: moveStageSchema },
  async (ctx, input) => opportunitiesService.moveStage(ctx, input),   // tx: update + history + activity + audit
  { revalidate: ['/pipeline', '/opportunities/[id]'] },
);
```
`authedAction` handles: session → tenant context → permission → Zod parse → run → map errors
to `ActionResult`. Services take `ctx` as the first argument, always.

### TenantContext
```ts
type TenantContext = {
  userId: string; tenantId: string; membershipId: string;
  roleKey: string; grants: Map<PermissionKey, Scope | true>;
  teamUserIds: string[];            // users visible under 'team' scope
  claims: JwtClaims;                // for withRls
  tenant: { name; timezone; currency; country; labels; settings; branding };
  requestId: string; ip?: string; userAgent?: string;
};
```
Resolved once per request (`React.cache`). Active tenant: the user's only active membership;
if several, a `tenant` cookie validated against memberships. In Phase 3 the subdomain
(`{slug}.app`) decides — only `getTenantContext()` changes.

## 4. API conventions

| Need | Mechanism |
|---|---|
| Page data | Server Components call `modules/*/queries.ts` |
| User mutations | Server Actions via `authedAction` |
| Client-side refetch (board drag, infinite scroll) | Server Action returning data |
| Webhooks, public forms, file redirects, cron hooks | Route Handlers under `/api` |
| External developers (Phase 3) | `/api/v1/*`, API keys per tenant, same services |

- Errors: `AppError(code, message)`; codes in `coding-standards.md`.
- Pagination: keyset `{ cursor, limit }`; response `{ items, nextCursor }`.
- Filters in URL search params so views are shareable and back-button friendly.
- Optimistic UI only on the board (stage move) and task completion; everything else waits for the action.

## 5. Custom fields at runtime

1. `getFieldDefinitions(ctx, entity)` (cached per request) returns active definitions.
2. `buildCustomFieldSchema(defs)` → Zod object (`text → z.string().max(…)`, `select → z.enum(values)`, required flags…).
3. Create/update schemas are `baseSchema.extend({ customFields: buildCustomFieldSchema(defs) })`.
4. `<CustomFieldsSection defs={…} />` renders inputs from the same definitions.
5. Lists/filters: columns flagged `show_in_list`/`is_filterable` query `custom_fields->>'key'`.
   Hot fields can get an expression index in a custom migration.
6. Import mapping offers `custom:<key>` targets; CSV export flattens `custom_fields` to columns labelled by definition.

## 6. Pipeline board

- Query: open opportunities of one pipeline, grouped by stage, within scope, with filters.
  Per-stage limit (50) + "load more"; counts and amount sums per column from one aggregate query.
- Drag between columns (dnd-kit) → optimistic move → `moveStageAction`. Dropping on a `lost`
  column opens the lost-reason dialog before saving.
- Won/lost columns show the last 30 days only.
- Cards show an applications summary (e.g. "3 apps · 1 offer") and expected revenue.
- A second board, **Applications**, shows items across all cases by item stage — the view ops
  staff work from. Same component, `object_type = 'opportunity_item'`.
- Mobile (<768px): stage selector + list; stage change via a menu instead of drag.

### Opportunity (case) page
Header with case stage stepper → **Applications panel** (one row per item: institution,
course, intake, item stage chip, expected commission; inline stage change; add application) →
document checklist grouped by level (student / case / per application) → timeline.
Revenue strip: service fee + commission if enrolled (highest live application, per currency) +
partner share if referred. Never a plain sum of all applications.

## 7. Documents flow

```
Upload: client picks file → action checks documents.upload + record access
        → server creates documents row (status pending upload) + signed upload URL for
          path {tenant_id}/contacts/{contact_id}/{document_id}
        → client uploads directly to Storage → confirm action verifies object exists,
          size and mime → requirement pending→received → activity + audit
Download: /api/files/{id} → documents.download + record access → audit('download')
          → 302 to signed URL (60s)
```
Files never pass through Vercel functions (keeps within request size/time limits).

## 8. Import architecture (CSV / Excel)

Designed for thousands to tens of thousands of rows without a background job system.

1. **Parse in the browser** (Papa Parse for CSV; SheetJS for .xlsx — install from SheetJS's
   official distribution, not the stale npm package). Show headers + first 20 rows.
2. **Map columns** → contact fields, `custom:<key>`, or ignore. Auto-suggest by header name;
   save the mapping on `import_jobs` for reuse.
3. **Options**: default owner (or "round-robin across selected users"), source, create
   opportunity in pipeline/stage (yes/no), duplicate strategy (skip / update empty fields / create anyway).
4. **Validate** — client sends rows in chunks of 500 to `validateImportChunk` → server
   normalizes (email, E.164 phone, dates, select values), validates with the same Zod schema,
   checks duplicates against DB **and within the file**, stores `import_rows`.
5. **Preview**: valid / invalid (with reasons, downloadable CSV of errors) / duplicate counts.
6. **Execute** — client calls `runImportChunk` repeatedly; each chunk is one transaction;
   progress bar from counts. Resumable because row status is persisted.
7. **Afterwards**: summary, `imported` activity per contact tagged with `import_job_id`,
   "undo this import" (soft-delete everything created by the job) for 7 days.

Clean-up after mass upload (Phase 2): duplicate finder across the whole DB + merge tool.

## 9. Lead intake (Phase 2, designed now)

All channels converge on one function: `ingestLead(tenantId, channel, externalId, payload)`.
```
channel adapter (web form | Meta | inbound email | API)
  → verify (signature / form key / API key)
  → insert lead_intake_events (idempotent on external_id)
  → map payload → contact fields + custom fields (per-integration mapping)
  → duplicate check → attach to existing contact or create new
  → create opportunity in the configured pipeline/stage, source, partner
  → assign owner (rule: fixed user | round-robin | unassigned queue)
  → notify owner → mark event processed
```
- **Web form**: public endpoint + embeddable HTML snippet; honeypot + rate limit (+ Cloudflare Turnstile if spam appears).
- **Meta Lead Ads**: webhook subscription → fetch lead from Graph API with the page token.
  Requires a Meta app with `leads_retrieval` and business verification — **start that paperwork
  early**; approval takes weeks.
- **Email logging**: each user gets a BCC address (`log+{token}@in.{domain}`); inbound email
  (e.g. Cloudflare Email Routing → Worker → webhook) becomes an `email` activity matched by address.

## 10. Reporting

Plain SQL over OLTP tables with the indexes in `database.md`; no warehouse, no materialized
views until a query is measured slow. Every report takes `(ctx, { from, to, pipelineId, ownerIds })`
and applies `scopeFilter` with `reports.view` scope.

| Report | Source |
|---|---|
| Leads per consultant | `opportunities` created in range, grouped by owner |
| Funnel conversion | `stage_history` (item id null): distinct opportunities that reached each stage (by stage position), cohort = created in range |
| Leads & win rate by source / partner | `opportunities` grouped by source / partner, status |
| Applications by institution | `opportunity_items` by organization: submitted, offer rate, enrolment rate, median days submitted → offer (from item `stage_history`) |
| Revenue pipeline | Open: service fee + **the best live application's** expected commission per case (a student enrols at one institution, so summing a case's applications overstates revenue), weighted by stage probability; won: fees + commissions of enrolled items — by consultant, institution, partner, source, month; totals per currency |
| Partner performance | referred cases, enrolments, our revenue from them, their expected share |
| Follow-up compliance | tasks due in range: completed on time / late / still open; % open opportunities with `next_task_due_at` set; median first-response time (created → first interaction activity) |
| Time in stage | avg / median `duration` per stage; currently stuck = open visit older than threshold |
| Activity volume | interactions per user per day/week by type |

CSV export streams from the same query functions, is permission-gated, and audited.

## 11. Notifications

- **Event-driven** (inside the service transaction): assigned to you, mentioned, import finished.
- **Time-driven** (pg_cron, `database.md` §12): due soon, overdue, stale opportunities.
- UI: bell with unread count (fetched with the layout; refreshed on navigation). Email or push
  delivery is Phase 2 and reads from the same table.

## 12. Environments & hosting

| Env | App | Database / Auth / Storage |
|---|---|---|
| Local | `npm run dev` | Supabase CLI (`npx supabase start`) — full local stack in Docker: Postgres with the same roles, Auth, Storage, pg_cron |
| Preview | Vercel preview per PR | Supabase dev project (or branch) with seed data |
| Production | Vercel | Supabase production project |

- **Region: Sydney.** Supabase project in `ap-southeast-2` (Sydney) and Vercel function region
  `syd1`. Keeps personal data stored in Australia and puts functions next to the database
  (Vercel's default US East region would add a Pacific round trip to every query).
- Connection: Supavisor transaction pooler (port 6543), postgres.js with `prepare: false`.
- Migrations: `drizzle-kit migrate` in CI against preview/prod — never from a laptop to prod.
- Node: use the current LTS (Node 24). Node 20 reached end-of-life in April 2026.

### Environment variables (`.env.example`)
```
DATABASE_URL=                          # pooler URL; server only
DATABASE_URL_DIRECT=                   # direct URL for migrations
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=  # a.k.a. anon key; safe for browser only because of RLS
SUPABASE_SECRET_KEY=                   # a.k.a. service role; server only, bypasses RLS
APP_URL=
SEED_TENANT_TIMEZONE=Australia/Sydney
SEED_TENANT_CURRENCY=AUD
SEED_TENANT_COUNTRY=AU
```

## 13. Cost reality

| Stage | Monthly | Notes |
|---|---|---|
| Prototype / investor demo | $0 | Vercel Hobby + Supabase Free + GitHub Free |
| Team using it with real student data | ≈ $45 | **Vercel Pro ($20)** — Hobby's terms are non-commercial use only. **Supabase Pro ($25)** — Free has no backups, pauses after a week idle, 500 MB DB / 1 GB files (a few hundred passport scans). |
| Resale | + per-tenant usage | Same architecture; add Sentry, email provider, job runner as needed |

Check current pricing before committing; these are the structural points, not quotes.

## 14. One platform, one login — ADR-025

Meroidea is **not** a set of apps a workspace installs. A company subscribes once and its people
sign in to a single system that already holds everything they need to run the business:
customers and sales, the team, the work, the documents, the money, and the admin behind it.
What a given person sees is decided by their **role and scope**, never by what has been bought
or installed.

```
                        one workspace, one login
 ┌──────────────────────────────────────────────────────────────────────┐
 │ People & organisations   the single record of everyone you deal with │
 │ Sales & pipeline (CRM)   opportunities, items, partners, forecasts   │
 │ Team & employees         staff records, roles, teams, leave, docs    │
 │ Work                     tasks, follow-ups, projects, calendars      │
 │ Documents                checklists, verification, expiry, storage   │
 │ Finance                  fees, commissions, invoices, payments, debt │
 │ Resources                assets, rooms, equipment, allocation        │
 │ Insight                  dashboards, reports, exports                │
 │ Admin                    users, roles & scopes, fields, stages,      │
 │                          labels, branding, billing, audit            │
 └──────────────────────────────────────────────────────────────────────┘
        shared core: tenant · people · organisations · activity · audit
```

Internally these are **modules for code organisation only** (`src/modules/*`). The rules that
keep one platform from becoming a pile of half-joined products:

1. **Shared core objects.** A person is one `contacts` row and a company one `organizations`
   row, whichever part of the system is looking at them. A module may add tables and reference
   the core; it must never duplicate it. An employee record links to the same person record a
   customer-facing module would use.
2. **One activity timeline and one audit log** across the whole platform, so "what happened to
   this customer / this invoice / this employee record" is answered in one place.
3. **Permissions are namespaced but universal** (`sales.opportunities.view`,
   `people.employees.manage`, `finance.invoices.view`) and every one carries a scope
   (own / team / all). Hiding a whole area from a role is just permissions — the area still
   exists, and turning it on for someone is a checkbox, not a purchase.
4. **Navigation is composed from permissions**, so a consultant sees Sales and Work, while the
   owner also sees Finance, Team and Admin. Nothing a person can't use clutters their screen.
5. **Configuration, not code, per business.** Labels, stages, fields, document types, roles and
   branding are tenant settings. The industry template chosen at sign-up just pre-fills them.
6. **Modules ship whole**: schema + service + UI + permissions + defaults + tests, without
   touching another module's code. That's how the platform grows (see `roadmap.md`) while the
   customer's experience stays "it's all just there".

## 15. Privacy & compliance (Australia)

Not legal advice — confirm with an advisor. What the design already supports:

- **Australian Privacy Act 1988 / Australian Privacy Principles.** Even if the small-business
  exemption applies today, resale to larger tenants will require APP-level handling, so build to it:
  collect only needed data, record consent (`marketing_consent`), restrict access by role and scope,
  let a contact's data be exported and deleted on request.
- **Data location:** all personal data stored in Sydney (Supabase `ap-southeast-2`). Note which
  sub-processors (email provider, Meta, Google) receive data when integrations arrive.
- **Notifiable Data Breaches scheme:** audit logs (who viewed/exported/downloaded what) make it
  possible to assess a breach. Keep them.
- **Education agent obligations:** providers and regulators increasingly scrutinise agent conduct
  and commissions (including onshore student transfers). Per-application onshore/offshore status,
  full activity history, and document verification records support that.
- **Phones and names:** students are often offshore — phone numbers are parsed with the
  contact's country when known, falling back to AU, and always stored in E.164.
