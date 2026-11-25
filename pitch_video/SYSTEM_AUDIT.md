# Meroidea — System Audit (for the investor pitch video)

Audited 2026-11-25 from branch `claude/meroidea-investor-pitch-video-dkhntm`. Every figure below was
counted from the repository, not estimated. Where the video brief asked for a capability the code
does not have, that is listed in **§9 Brief vs. reality**, so the pitch never claims what isn't built.

## 1. What it is

A **multi-tenant business platform** for small businesses (restaurants, grocery, retail, education
and migration consultancies, small service firms). One codebase; the platform owner switches
**26 features** on per business (`src/lib/features.ts`). It is industry-neutral: industry words only
appear after sign-in, from each tenant's labels, stages, custom fields and roles.

Onboarding is done by the platform owner in `/platform`, not by self-serve sign-up. The owner records the
business (name, ABN, contact, location) and its admin. The admin accepts the service agreement by
one-time link (ADR-047). Billing is manual for now: bank transfer, with suspend and reactivate in the console (ADR-057).

## 2. Stack and hosting

| Layer | Choice |
|---|---|
| App | Next.js 16.4 (App Router, `proxy.ts`), React 19.2, TypeScript strict |
| UI | Tailwind 4, shadcn/ui (Radix), Lucide, dnd-kit (kanban) |
| Data | Supabase Postgres + Auth + Storage + pg_cron; Realtime broadcast (social inbox only) |
| ORM / migrations | Drizzle ORM 0.45 + Drizzle Kit (one migration tool) |
| Validation / forms | Zod 4, React Hook Form |
| AI | Google Gemini via `@google/genai`, server-only, preview-then-approve (ADR-074) |
| Documents | OnlyOffice Document Server for in-browser Word/Excel/PowerPoint/PDF editing (ADR-030) |
| Tests | Vitest (unit + DB tests against real local Postgres), Playwright |
| Region | **Sydney.** Supabase `ap-southeast-2`, Vercel functions `syd1`. Australian Privacy Act / APPs |
| Shape | Modular monolith. No microservices, queue, cache, GraphQL or second database (by rule) |

## 3. Codebase scale (measured)

| Metric | Count | How counted |
|---|---|---|
| Database tables | **112** | `pgTable(` declarations in `src/db/schema/*.ts` (28 schema files) |
| SQL migrations | **86** | `drizzle/*.sql` |
| RLS policies | **196** (21 restrictive) | `create policy` in migrations |
| Permission keys | **85** | `src/lib/permissions/catalog.ts` |
| Switchable features | **26** | `FEATURES` in `src/lib/features.ts` |
| Domain modules | **47** | `src/modules/*` |
| App pages | **123** | `page.tsx` under `src/app` |
| Test files | **113** | `*.test.ts` in `tests/` and `src/` |
| Source lines (TS/TSX) | **~126,000** | `wc -l` over `src` |
| Architecture decisions | **86 ADRs** (ADR-001 … ADR-086) | `docs/decisions.md` |
| Commits | 114 since 2026-10-09 | `git log` |

## 4. Multi-tenant architecture

- **Isolation in two layers.** Every tenant-owned table has `tenant_id uuid not null` **and** RLS enabled in
  the migration that creates it. App queries run through `withRls(ctx, …)`, which sets the
  tenant/user claims so Postgres itself refuses cross-tenant rows. `adminDb` is limited to
  migrations, seeds, cron and verified webhooks.
- **Every-table isolation test**, plus a deactivated-membership test over every table (`tests/db`).
- **Mutation pipeline** (`authedAction()`): authenticate → resolve tenant context → permission + record
  scope → Zod validate → business rules → DB transaction → `audit()` → revalidate.
- **Feature switches enforced in the database** (ADR-038). A permission whose feature is off counts as
  not granted in `loadTenantContext` *and* in `app.has_permission`. Each table a feature owns alone gets a restrictive
  `feature_switch` policy. `app.permission_feature` mirrors the TS map, and a DB test keeps the two identical.
- **Audit log** (`audit_logs`): actor, actor type, action, entity type/id, field-level `changes`, context,
  IP, user agent, timestamp. Viewer at `/audit` with filters, record history and audited CSV export. It is
  readable only with `audit.view`, enforced in the DB (ADR-063). Separate `platform_audit_logs` for owner actions.
- **Support access**: platform owners enter a business through a temporary, audited Admin seat.
- **Data rights**: export within scope (audited), erase a person on request (`contacts.anonymize`).
  Sensitive staff tax/bank/super details are encrypted, with audited reveal and key rotation (ADR-040).

## 5. Roles, scopes, permissions

- Model: `users → tenant_memberships (tenant, role, team) → roles → role_permissions (permission, scope)`.
- Default roles (ADR-048): **Admin** (`owner`), **Manager**, **Staff**. Roles are editable per tenant, and
  the Admin can never lock themselves out.
- **Record scope: `own` ⊂ `team` ⊂ `all`**, applied only by the shared `scopeFilter()` /
  `assertCanAccess()`. Out-of-scope reads return NOT_FOUND. Sensitive fields are masked by `canViewField`.
- **Sign-off rule**: nobody approves their own hours, leave or expenses (`maySignOffFor()`).

## 6. Module map

### 6.1 CRM and sales pipeline (feature `crm`)
- **Contacts and organisations**: links, households, custom fields, sensitive fields, merge, erase.
- **Duplicate detection**: same email or phone gives a *strong* match. A similar name plus the same date of birth gives a
  *possible* match. Duplicates are warned about, not blocked (`modules/contacts/duplicates.ts`).
- **CSV/Excel import** in batches, with a per-row duplicate strategy **skip / merge / create** and a per-row report
  (`created | merged | skipped | duplicate_created | error`).
- **Pipelines**: several per tenant. Stages have name, order, colour, won/lost category, **win probability**,
  stale-after days, stage owner, required fields, checklist, approval gate, and an item stage that advances the parent stage.
- **Opportunities**: kanban (drag, plus mobile), list, record page, stage history (time-in-stage), lost
  reasons, contact roles. **Opportunity items** (e.g. applications) have their own stage, value and owner (ADR-018/058).
- **Weighted forecast**: `Σ amount × stage.probability / 100` over open deals (`modules/reports/queries.ts:139`).
- **Partners**: referral partners with commission terms, referral stats, expected/earned commission.
- **Leads** (ADR-051): capture by hand, upload or website form with source, sub-source, campaign name and UTM;
  a lead queue; **routing rules** (round robin or least loaded, matched on source, region and industry);
  statuses with reasons; handover to a sales rep with an acceptance deadline in business days.
- **Outreach**: email templates, sequences and enrolments.

### 6.2 Marketing and channels
- **Social inbox** (ADR-064–068): Facebook, Instagram, WhatsApp (Embedded Signup), TikTok, **email
  channel** and **live chat** widget in one inbox. Private notes, saved replies, presence, sender-to-contact
  matching. Tokens are sealed and unreadable to sessions; Meta webhooks are signed.
- **Website forms and enquiries** with per-sender rate limits (ADR-039). **Customer reviews**: review links and
  QR codes with an inbox. **Knowledge base**: public portal, search, "Was this helpful?". **Helpdesk**:
  tickets with SLA response targets in business hours.

### 6.3 People and team
- **Staff**: directory, departments, profiles, contracts, end of employment. **Hiring**: Australian rule checks, contract
  sent by one-time link and accepted in-app, Fair Work pay database client.
- **Rosters**: weekly/fortnightly, teams, vacant shifts, break rules, live wage cost with weekend and
  public-holiday loadings. The **Restaurant Industry Award rules engine** has clause references (ADR-043).
- **Timesheets** (clock in/out, approvals), **time off**, **training** (courses, quizzes, assignment by
  role/department/person), **questions and concerns** (admin-only threads enforced by RLS), **recruitment**
  (public apply page), **projects** (task board, time logs), **productivity reports**.

### 6.4 Work and documents
- **Tasks and My Day** (overdue / today / upcoming), activity timeline with field changes, call outcomes,
  notification centre with email, SLA and stale-deal alerts (daily cron).
- **Document library**: private bucket, one-time upload tickets, content check, folders, versions,
  audited downloads, co-editing through OnlyOffice. **Stage checklists** gate pipeline moves.

### 6.5 Finance and reporting
- **Invoices**: lines, tax, numbering, email, part payments, credit notes. **Expenses** with receipts and approval.
- **Payroll and payslips**: roster authorisation locks the roster and drafts payslips; super on OTE;
  tax withheld from the ATO 2026–27 Schedules 1 and 8 (ADR-046).
- **Bookkeeping** (ADR-060): Australian chart of accounts, GST codes, a **double-entry ledger written only by
  DB functions** (balance check, lock date, whole cents, immutability), bills, P&L, Balance Sheet and Trial Balance.
- **Inventory**: append-only movement ledger, reorder levels, stock value. **Purchasing**: suppliers,
  price lists, numbered purchase orders.
- **Dashboard KPIs**: Open pipeline, **Weighted forecast**, Won this month, **Win rate (90 days)**; pipeline by stage;
  where business comes from; recent activity.
- **Reports**: conversion funnel, follow-up discipline, sources and win rate, by owner, **time in stage**,
  why deals are lost, activity by person, and lead reports (SDR/rep, SLA, acceptance). Audited CSV export.

### 6.6 AI assistant (MeroAI, feature `ai_assistant`)
Tools: `next-actions` (prioritised next steps from the user's *scoped* pipeline and tasks), `invoice`
(draft from a sentence, chase overdue invoices), `roster` (copy-last-week, lowest-cost, most-productive and even-hours strategies),
`communication` (reply drafts), `document` (summaries). **Every tool only prepares a preview**; writes happen
when a person approves, through module services.

## 7. Configuration over customisation
Settings a business admin changes without code: pipelines and stages (probability, gates), custom fields
(contacts, organisations, opportunities), object labels (rename "Opportunity" to anything), lead sources and sub-sources,
statuses and reasons, routing rules, email templates, sequences, web forms, roles and permissions, branding.

## 8. Data sovereignty
All personal data is stored in Sydney (`ap-southeast-2`). Audited CSV export of lists, reports and the audit log.
Erase on request. The code is AGPL-3.0, so customers are not locked into a no-code vendor.

## 9. Brief vs. reality (what the video will *not* claim)

| Brief asked for | In the code? | How the video handles it |
|---|---|---|
| Weighted pipeline | **Yes**: stage probability × amount, on the dashboard | Shown with the real formula |
| Next-best-actions | **Yes**: MeroAI `next-actions` tool, approve-first | Shown |
| CSV import + duplicate detection | **Yes**: strong/possible match; skip/merge/create | Shown |
| Own / Team / All scopes | **Yes** | Shown as nested sets |
| Win rates, live audit, executive dashboard | **Yes** | Shown |
| Revenue vs. forecast | **Partly**: weighted forecast + won-this-month exist; no forecast-vs-actual time series | Bars labelled "illustrative" |
| Deal velocity | **No** metric by that name; **time in stage** report exists | Says "time in stage" |
| Campaigns and attribution | **Partly**: source, sub-source, campaign name and UTM capture; "sources and win rate" report; no campaign module or multi-touch attribution | Says "source attribution" only |
| Workload / targets | **Partly**: least-loaded lead routing; **no sales targets/quotas** | Says "least-loaded routing" only |
| Expiring document verification | **No**: document types with expiry are roadmap milestone 10, not built. Built: document library, versions, stage checklists | Not claimed |
| "Real metrics" | No production or customer metrics exist in the repo | Engineering metrics are real; business charts are labelled *illustrative, synthetic data* |

## 10. Market context (external, cited)
ABS *Counts of Australian Businesses* (released 26 Aug 2025): **2,729,648 actively trading businesses** at
30 June 2025, of which **994,178 employ staff**. Source: abs.gov.au, catalogue 8165.0.
