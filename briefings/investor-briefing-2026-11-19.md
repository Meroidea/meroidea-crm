# Meroidea: Investor Briefing (based on the code)

**Prepared:** 19 November 2026 · **Code audited:** `main` @ `22ad2f8` (merge of PR #19, 8 Nov 2026)
**Method:** I read the code directly: `package.json`, all 27 Drizzle schema files, 71 SQL migrations, route
handlers, module services, pages, permission catalog, CI config and `.env.example`. I also ran the
checks myself. Where this document relies on the project docs rather than the code, it says so.

---

## 0. Proof points you can quote (all checked)

| Metric                  | Value                                                                                                                                            | How it was checked                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Application code        | **607 source files, about 112,000 lines of TypeScript** (src + tests)                                                                            | `find`/`wc`                                                      |
| Database                | **99 tables**, **71 versioned migrations**, **145 row-level-security policies**                                                                  | schema + `drizzle/*.sql`                                         |
| Tenant isolation        | RLS is on for **every** table, and a test asserts this over the whole schema                                                                     | `tests/db/database.test.ts`, `tests/db/tenant-isolation.test.ts` |
| Screens                 | **108 pages**, **227 server actions**, all wrapped in `authedAction()`                                                                           | grep                                                             |
| Permissions             | **~80 permission keys** with own / team / all scopes, **20 switchable features**                                                                 | `src/lib/permissions/catalog.ts`, `src/lib/features.ts`          |
| Tests                   | **378 unit tests passing** (run today), **~575 database tests**, **26 browser (Playwright) tests**                                               | `npm run test:unit` run today; the DB and browser tests counted  |
| Static checks           | **TypeScript strict: 0 errors. ESLint: clean** (run today)                                                                                       | `npm run typecheck`, `npm run lint`                              |
| CI                      | **Green on the audited commit**: GitHub Actions run #50 runs lint, types, unit, build, migrations + DB tests on a fresh Supabase, and Playwright | GitHub Actions API                                               |
| Design records          | **62 Architecture Decision Records** (ADR-001 to ADR-062)                                                                                        | `docs/decisions.md`                                              |
| Unfinished code markers | **1 TODO in the whole codebase** (phone-number validation library)                                                                               | grep                                                             |

> Honest caveat: I could not run the database test suite in my own environment (it needs a Docker
> daemon). It does run in CI, and CI passed on this exact commit.

---

## 1. Executive Summary: What This System Is

**Meroidea is a multi-tenant "business operating system" for small businesses.** It combines a CRM
and sales pipeline with staff management (hiring, rosters, timesheets, payroll), operations
(inventory, purchasing), customer service (helpdesk, reviews) and a real double-entry ledger, all in
one codebase with one login per business.

**Business model in the code.** Meroidea is a _managed platform_, not self-serve SaaS (ADR-029,
ADR-047, ADR-057):

- The platform owner onboards each business from a console (`/platform`) after a sales meeting,
  recording its legal name, ABN, primary contact and first admin, and **switches on only the
  features that business pays for** (`tenants.features`).
- The business's admin accepts a versioned service agreement through a one-time emailed link,
  then sets their own password.
- **Billing is manual on purpose** (bank transfer). Access is controlled with Suspend/Reactivate.
  Public sign-up is switched off.

**Target customer (from the code and seed data).** Australian small businesses, with the strongest
fit for **restaurants and hospitality**. This is the only industry with a written award-rules engine
(Restaurant Industry Award MA000119), ATO 2026–27 PAYG withholding, GST tax codes, an ABN field, the
`syd1` hosting region and AUD defaults. The CRM is also designed for **education and migration
consultancies and B2B service firms** (lead routing, SDR→rep handover, partners with commission).
Industry words are never hardcoded: labels, stages and custom fields are set per business.

**User roles in the code.**

- Platform Owner (console, audited support access)
- Business Admin
- Manager
- Staff
- Role templates: SDR/BDR, Sales rep, Customer relations, Bookkeeper, Books viewer, Read only
- A custom roles editor

---

## 2. End-to-End System Workflow (as built)

```
Website contact form ──► Platform console enquiry inbox (/platform/enquiries)
        │
        ▼
Platform owner creates business ──► provisionTenant(): tenant, admin login, default roles,
(name, ABN, features, admin)          lead sources, sales pipeline, trial record, audit entry
        │                             in ONE database transaction
        ▼
Admin gets a one-time agreement link ──► accepts agreement ──► sets password ──► workspace opens
        │
        ▼
Admin adds staff logins (Staff/Manager), or hires people (contract → e-acceptance → login created)
        │
        ├──► SELL:   Leads (manual / CSV-Excel import / embeddable website form)
        │            → routing (round robin, least loaded, by source/region/industry/size)
        │            → outreach (1:1 email with templates, task sequences) → handover SDR→rep
        │            → convert to Contact + Organization + Opportunity → pipeline board
        │            → stage gates (required fields, checklists, approvals) → Won/Lost
        │
        ├──► STAFF:  Roster (award-costed) → publish → clock in/out (optional geofence)
        │            → timesheet approval → roster authorisation → payslips (ATO PAYG)
        │            → release to staff → posted to the ledger automatically
        │
        ├──► SERVE:  Helpdesk tickets (public form + customer tracking page, SLA due times),
        │            review links/QR codes → review inbox
        │
        ├──► OPERATE: Suppliers + price lists → purchase orders emailed; inventory stock ledger
        │
        ├──► MONEY:  Invoices → email/print → payments (part / multi-invoice) → credit notes
        │            Supplier bills → bill payments; expenses with receipts
        │            ALL post to the double-entry ledger by database functions
        │
        └──► REPORT: Dashboard, sales & lead reports, P&L, Balance Sheet, Trial Balance,
                     productivity report, audited CSV exports
```

Each step above has a real page, a server action and database tables. The deep dive below lists
the gaps in each step.

---

## 3. Deep-Dive Audit: Investor-Priority Features

### 3.1 Bookkeeping: `🟡 Partially Built` (strong core)

**What is implemented**

- Australian chart of accounts and GST tax codes loaded from a "country pack" (`src/modules/books/packs.ts`).
- Double-entry ledger (`ledger_entries`, `ledger_lines`) plus money in/out with the GST split,
  transfers, manual and adjusting journals, opening balances, and void by reversal.
- Invoices, invoice payments, credit notes, released payslips, supplier bills, bill payments and
  supplier credits **post themselves to the ledger**.
- Lock date, financial year settings, a duplicate-bill warning, and accounts remembered per supplier.
- Reports: **Trial Balance, Profit & Loss (with comparison period), Balance Sheet**, account
  drill-down, and audited CSV export.
- Payroll amounts are hidden unless the user holds `books.view_payroll`.

**How it works technically.** The ledger is written **only by Postgres functions**: 39 functions
across migrations `0068`–`0070`, such as `app.ledger_post_entry`, `app.ledger_check_balanced` and
`app.ledger_entries_immutable`. The database itself enforces that entries balance, that amounts are
whole cents, that posted entries cannot change, the lock date, and tenant checks. Application code
cannot write an unbalanced or back-dated entry, even with a bug. The `books.spec.ts`, `bills.spec.ts`
and `invoice-payments.spec.ts` E2E tests and the DB tests cover it.

**What is missing**

- Bank feeds, statement import and **bank reconciliation**
- **GST/BAS report** and lodgement
- Aged receivables and payables
- Cash-basis reporting, tracking categories, recurring transactions, attachments
- PDF/Excel report export
- **Xero/MYOB sync**
- **Review by a qualified accountant** (the README states this openly)

### 3.2 Rostering: `✅ Production-Ready` (for hospitality under the Restaurant Industry Award)

**What is implemented**

- Weekly and fortnightly rosters, by-day and by-person layouts.
- Coloured teams, vacant shifts, break rules, and copying shifts and previous rosters.
- **Live wage cost** with Saturday, Sunday and public-holiday loadings, plus shift warnings.
- Publish shift by shift, with optional email to staff.
- Owner-only editing enforced by RLS.
- Leave shown on the grid.

**How it works technically**

- `src/modules/roster/` (about 4,300 lines) and `src/modules/awards/ma000119.ts`: an award-rules
  engine written from the award text with clause references. It covers penalties, late-night
  amounts, daily and weekly overtime, casual minimum engagement and split-shift allowances.
- Minimum rates come from the **Fair Work Commission Modern Awards Pay Database API**
  (`src/server/fair-work.ts`, `api.fwc.gov.au`).
- Clock-in/out uses an optional geofence (`distanceMetres` in `src/lib/geo.ts`).
- Daily timesheet approval pairs rostered shifts with actual time.
- Exports to CSV and Excel.

**What is missing**

- Drag-and-drop on the grid
- Staff availability beyond leave
- Shift swaps, claiming vacant shifts, acknowledgement
- Mobile push notifications and a native app
- Awards other than the Restaurant Industry Award (retail, fast food, hospitality general, clerks)
- Salaried staff in cost
- Demand forecasting
- Qualified review of the award readings

> **Positioning note:** "production-ready" here means _for restaurants under MA000119_. For a
> retail shop the roster works, but award costing would be typed in by hand.

### 3.3 Lead Management: `✅ Production-Ready`

**What is implemented**

- B2B and B2C lead workflows.
- Capture by hand, CSV/Excel upload (skip/merge/create per row, with a report), or an **embeddable
  website form** (`/f/{key}`, rate-limited).
- Sources and sub-sources.
- **Routing rules**: round robin, least loaded, by source, region, industry or size.
- Completeness scoring, statuses with reasons, and duplicate detection and merge.
- **SDR → sales rep handover** with an acceptance deadline in business days, and accept or
  return with a reason.
- Conversion to Organization + Contact role + Opportunity.
- Lead reports: funnel, source, SDR/rep performance, SLA, rejection reasons.
- Daily stale/SLA alerts through Vercel Cron.

**How it works technically.** `src/modules/leads/` (about 4,400 lines). `routing.ts` holds
`routeLead` and `nextInTurn`, and `service.ts` holds `handoverLead`, `acceptHandover` and
`convertLead`. Scope checks use the shared `assertCanAccess`. The cron endpoint checks its secret
with a timing-safe comparison.

**What is missing**

- Mailbox sync (Gmail/Outlook)
- Phone-system call logging
- Data enrichment (Apollo, Clearbit and similar)
- WhatsApp/SMS capture
- AI lead scoring
- Weighted forecast by probability

### 3.4 Marketing: `🟡 Partially Built` (sales outreach only, no campaigns)

**What is implemented**

- 1:1 email from a contact record with **templates and merge fields**, capped at 200 emails per
  user per day.
- **Sequences**: multi-step cadences. Enrolling a contact **creates scheduled tasks**
  (email/call/meeting).
- Embeddable lead-capture web forms.
- **Review request links with QR codes**.
- The public marketing website.

**How it works technically.** `src/modules/outreach/service.ts`. Email is sent through the
**Resend** REST API (`src/server/email.ts`). Note that sequence steps are _tasks for a person_; they
do **not** send emails automatically.

**What is missing**

- Bulk campaigns and newsletters
- Segments and audiences
- Unsubscribe / consent management (needed under the Spam Act before any bulk email)
- Open and click tracking
- Automated sequence sending
- Landing-page builder
- Ad-platform integration
- Marketing attribution beyond lead source

> Say "sales outreach and lead capture" to investors, **not** "marketing automation".

### 3.5 Social Media Integration & Unified Multi-Platform Chat: `❌ Not Built Yet`

**What I found.** No Facebook, Instagram, TikTok, WhatsApp, Messenger, SMS or Twilio code, no Meta
Graph API calls, no webhooks for messaging, and no inbox or conversation tables. The only mentions
are a text placeholder in the activity composer ("Summary of the WhatsApp/SMS conversation…", used
for _manually logging_ a conversation) and "Instagram"/"LinkedIn" as lead **sub-source labels**.

**The closest existing building blocks**

- Helpdesk ticket threads (`tickets`, `ticket_messages`)
- The activity timeline
- Notification centre
- Public-endpoint rate limiting

Together these give a sensible base for a unified inbox, but **none of the channel integration
exists**. There is also **no incoming email** (README: "Customers reply to tickets on their ticket
page, not by email").

**What is missing:** all of it. That means Meta app plus App Review (`pages_messaging`,
`instagram_manage_messages`), WhatsApp Business Platform (BSP or Cloud API), TikTok Business
messaging API access, signed inbound webhooks, a conversation data model, assignment and SLA, and
real-time updates.

> **Do not present this as existing.** Present it as roadmap.

### 3.6 Role-Based Access Control & Tenant Isolation: `✅ Production-Ready` (this is the strongest part of the codebase)

**What is implemented**

- About 80 permissions, each with an **own / team / all record scope**.
- Default roles (Admin, Manager, Staff), six role templates, and a custom roles editor.
- **Feature switches enforced in the database**: a permission whose feature is off counts as not
  granted (ADR-038).
- Audit log on every mutation.
- Separate platform audit log and **audited, temporary support access** for the platform owner.
- Deactivated users lose every route in (tested over every table).

**How it works technically (for technical investors)**

- **Defence in depth.** Every request runs inside `withRls()` (`src/server/db/with-rls.ts`), which
  switches the Postgres session to the `authenticated` role and sets JWT claims and
  `app.tenant_id` for that transaction only. **Isolation is enforced by Postgres row-level
  security, not only by application code.** A bug in a query cannot leak another business's data.
- **One mutation pipeline.** `authedAction()` (`src/server/action.ts`) runs authenticate → tenant
  context → workspace-open check → permission → Zod validation → service (scope, business rules,
  transaction, `audit()`).
- **Verified identity.** `supabase.auth.getUser()` checks with the auth server; the code never
  trusts a bare cookie.
- **Encryption at rest.** Tax file numbers, bank and super details are stored with **AES-256-GCM**
  encryption (`src/server/crypto.ts`), with key rotation (ADR-040) and audited reveal.
- **Tests.** Per-module cross-tenant and cross-owner tests, including `tenant-isolation.test.ts`,
  `role-escalation.test.ts` and `deactivated-membership.test.ts`.
- **Security review.** A first internal review pass is done (ADR-059). It found and fixed 3 issues,
  including a privilege-escalation route through profile email.

**What is missing**

- **MFA / two-factor sign-in** (none found)
- Full script CSP with nonces
- **An independent penetration test** (the README says this openly)
- An audit-log viewer UI
- SSO/SAML
- Branded per-business subdomain sign-in
- One owner action from ADR-059: remove the `public` schema from the hosted Supabase Data API

### 3.7 Finance (dashboards, tracking, reporting): `🟡 Partially Built`

**What is implemented**

- Invoices list with **outstanding / overdue / paid totals** summed in the database.
- Expense claims with receipts, approval and reimbursement.
- P&L, Balance Sheet and Trial Balance (see 3.1).
- Live dashboard with revenue trend and pipeline value, gated by `revenue.view`.
- Sales reports: funnel, sources, owners, time in stage, lost reasons.
- Roster wage-cost and productivity reports.
- Audited CSV exports.

**What is missing**

- A dedicated finance dashboard (cash position, cash-flow forecast, AR/AP ageing)
- Budgets
- Scheduled report emails
- Multi-currency conversion (currency is stored per record, with no FX)
- Accounting sync

### 3.8 Invoice Generation & Management: `🟡 Partially Built`

**What is implemented**

- Invoices with line items, per-workspace numbering (INV-0001) and a tax rate (e.g. 10% GST).
- Seller details (name, **ABN**, address, payment details) copied onto each invoice.
- Statuses `draft → sent → paid / void`, with **overdue** derived from the due date.
- **Email to the customer** through Resend. The app refuses to send an invoice the ledger would reject.
- Print layout (browser print / save as PDF).
- **Payments as records**: part payments, one payment across several invoices.
- **Credit notes**.
- Automatic ledger posting with "Ledger entries" shown on each invoice.

**How it works technically.** `src/modules/invoices/` plus `invoices`, `invoice_lines`,
`invoice_payments`, `invoice_payment_allocations` and `invoice_credit_notes`. Money is
`numeric(14,2)` + `char(3)` currency. The balance is computed by `app.invoice_balance()`, and money
records cannot be changed after posting.

**What is missing**

- **A generated PDF attachment** (today it is browser print only)
- **Online payment** (Stripe/Square payment links)
- Invoices are **not linked to Contacts/Opportunities**: the customer is free text
- **One tax rate per invoice** rather than a tax code per line (e.g. GST-free + GST lines mixed)
- Quotes/estimates
- Recurring invoices
- Automated payment reminders
- Branded templates and logo
- E-invoicing (Peppol)

### 3.9 AI Integration Capabilities: `❌ Not Built Yet`

**What I found.** **No AI model or API is connected.** There is no OpenAI, Anthropic, Gemini or
other LLM SDK in `package.json`, no API keys for one in `.env.example`, and no AI calls in the code.
AI appears only in `docs/roadmap.md` Stage 4 ("lead scoring, timeline summaries, duplicate and
data-quality suggestions").

> ⚠️ **Investor-risk item:** the public marketing page's illustrative product mock-up
> (`src/components/marketing/admin-portal-demo.tsx`) shows a ✨ **"Next best actions"** panel. That
> looks like an AI feature, and it is **not in the product**. Relabel it or remove it before investors
> look at the site.

**Why the base suits AI later.** The data is clean, structured and tenant-isolated, and every record
has an activity timeline and audit history. AI features can be added _inside_ the existing RLS
boundary, so one business's data never reaches another business's prompts. That is a real
architectural advantage when you add AI. But today it is a plan, not a feature.

### 3.10 Other notable features found in the code

| Feature                                    | Status | Notes                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Payroll & payslips**                     | 🟡     | Pay lines from the award engine; **ATO 2026–27 PAYG Schedule 1 & 8 formulas** checked against ATO sample data; super on ordinary-time earnings; year-to-date figures; one-page payslip. **Missing: Single Touch Payroll (legally required for AU employers), leave accrual/pay, Medicare variations, tax offsets, deductions, payment (ABA) files** |
| **Hiring & contracts**                     | 🟡     | Full-time/part-time/casual/fixed-term/contractor; AU rule checks; contract generated and accepted through a one-time link; login created on acceptance. Contract wording **not lawyer-reviewed**                                                                                                                                                    |
| **Recruitment**                            | ✅     | Job openings, public apply page, applicant tracking and notes                                                                                                                                                                                                                                                                                       |
| **Staff directory, departments, time off** | ✅     | Leave requests and approvals, shown on the roster                                                                                                                                                                                                                                                                                                   |
| **Training (LMS)**                         | ✅     | Courses, modules, YouTube/Vimeo, quizzes marked in the database (answers hidden from learners), progress rings                                                                                                                                                                                                                                      |
| **Staff questions & concerns**             | ✅     | Private channel to a manager or admin only; "Ask about this payslip"                                                                                                                                                                                                                                                                                |
| **Helpdesk**                               | ✅     | Tickets, public form, customer tracking page, priorities and response-due times                                                                                                                                                                                                                                                                     |
| **Customer reviews**                       | ✅     | Review links and QR codes, review inbox. Reviews are unverified and not published anywhere                                                                                                                                                                                                                                                          |
| **Inventory**                              | ✅     | Items, append-only stock ledger, low/out-of-stock views, stock value. Single location                                                                                                                                                                                                                                                               |
| **Purchasing**                             | 🟡     | Suppliers, .xlsx/.csv price lists, POs emailed to suppliers. No receiving into inventory                                                                                                                                                                                                                                                            |
| **Projects & productivity**                | ✅     | Projects, task board, task timers, productivity report (no device monitoring)                                                                                                                                                                                                                                                                       |
| **Documents**                              | 🟡     | Library with versioning and **in-browser Word/Excel/PowerPoint/PDF editing through self-hosted OnlyOffice** (signed JWT callback). **The OnlyOffice server is not yet hosted in production**                                                                                                                                                        |
| **Custom fields, labels, pipelines**       | ✅     | Reconfigure for a new industry without code                                                                                                                                                                                                                                                                                                         |
| **Contacts privacy**                       | ✅     | Erase on request (anonymise), sensitive-field permission, households                                                                                                                                                                                                                                                                                |
| **Platform console**                       | ✅     | Onboard, features, suspend, delete test business, agreement versions, audited support access, enquiries inbox                                                                                                                                                                                                                                       |

---

## 4. Competitive Differentiation (realistic)

1. **One system instead of 4–6 subscriptions.** A typical Australian restaurant or service business
   pays for a CRM (HubSpot), rostering (Deputy/Tanda), payroll and accounting (Xero), a helpdesk,
   and an LMS separately. Meroidea already shares **one person record, one login and one audit
   trail** across sales, staff, rosters, timesheets, payslips, invoices and the ledger. A released
   payslip posts to the books automatically, and a roster shows award cost before it is published.
   Point tools need integrations to do that.
2. **Australian compliance built into the code.** Restaurant Industry Award rules with clause
   references, live Fair Work pay-database rates, ATO PAYG formulas, GST codes and ABN handling.
   HubSpot and Salesforce do none of this. Deputy does awards but not CRM or ledger. Xero does books
   but not CRM or awards.
3. **Features switched on per business, with database enforcement.** The same codebase serves a
   restaurant (roster/payroll/inventory) and a consultancy (leads/pipeline/partners) without a fork.
   The business pays only for what is switched on.
4. **Isolation and auditability usually found in enterprise software.** Postgres RLS on every table,
   an audit log on every mutation, encrypted HR data, and audited support access. That is unusually
   strong for an SMB product at this stage.
5. **Open source (AGPL-3.0).** Trust and transparency for customers, and AGPL means competitors
   cannot run a modified closed fork as a service. _Trade-off to state openly:_ the code is not a
   secret moat. The moat has to be service, onboarding, compliance content and distribution.

**Where it is weaker than incumbents today (say this before an investor does):**

- No bank feeds
- No STP payroll
- No native mobile app
- No marketplace or integrations
- No social inbox, no AI
- The award engine covers one award
- No independent security audit yet

Xero, Deputy and Employment Hero win on depth in their own categories. Meroidea's position is
**breadth plus one record plus AU compliance for small operators who would otherwise juggle tools**.

---

## 5. Tech Stack & Architecture

| Layer            | Technology (versions from `package.json`)                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend         | **Next.js 16.3.5** (App Router, Server Components, Server Actions), **React 19.2.8**, TypeScript 5 (strict), **Tailwind CSS 4**, shadcn/ui + Radix UI 1.6, Lucide icons, React Hook Form 7, dnd-kit 6 (pipeline board), tw-animate-css |
| Backend          | Next.js Server Actions + Route Handlers (no separate API server); module services in `src/modules/*`; **Zod 4** validation                                                                                                             |
| Database         | **PostgreSQL on Supabase**; **Drizzle ORM 0.45** + Drizzle Kit 0.31 migrations; `postgres` driver 3.4; Postgres functions/triggers for ledger integrity                                                                                |
| Auth             | **Supabase Auth** (`@supabase/ssr` 0.12, `@supabase/supabase-js` 2.116); session refresh in `src/proxy.ts`; one-time links for agreements, offers, password setup                                                                      |
| Authorisation    | Postgres **row-level security** + an app permission catalog with scopes + feature switches                                                                                                                                             |
| Storage          | **Supabase Storage** (private buckets, tenant-prefixed paths, one-time upload tickets)                                                                                                                                                 |
| Real-time        | **None.** Supabase Realtime is not used (and is excluded in CI)                                                                                                                                                                        |
| Email            | **Resend** REST API (transactional only; optional, links shown when not configured)                                                                                                                                                    |
| Third-party APIs | **Fair Work Commission Modern Awards Pay Database** (optional); **OnlyOffice Document Server** (self-hosted, `docker-compose.onlyoffice.yml`); YouTube/Vimeo embeds                                                                    |
| Scheduling       | **Vercel Cron** (one daily job: lead/SLA alerts)                                                                                                                                                                                       |
| Hosting          | **Vercel**, region `syd1` (Sydney); Supabase hosted Postgres                                                                                                                                                                           |
| AI               | **None**                                                                                                                                                                                                                               |
| Payments         | **None** (Stripe columns reserved in `tenant_subscriptions`, no Stripe code)                                                                                                                                                           |
| Testing / CI     | Vitest 5 (unit + DB), Playwright 1.63, ESLint 9, Prettier; GitHub Actions (3 jobs)                                                                                                                                                     |
| Data import      | Papa Parse (CSV), a built-in XLSX reader                                                                                                                                                                                               |

**Why this is scalable and cost-efficient**

- **A single modular application, not microservices.** One deploy, one database and one team can
  ship across 20+ modules. This is the right shape for a seed-stage company, and the repo's rules
  forbid adding queues, Redis or extra databases until a measured need.
- **Serverless hosting plus managed Postgres.** Costs rise with usage, with no servers to run.
  Supabase's transaction pooler is already supported (`set local` per transaction in `withRls`).
- **Shared-schema multi-tenancy with RLS.** One database serves every customer with isolation
  enforced by the database, so adding a customer costs almost nothing. This is the standard pattern
  for SMB SaaS.
- **Postgres does the heavy lifting.** Aggregates, ledger integrity and permissions run inside the
  database, which keeps the app thin and the data correct.
- **Scaling limits to watch.** One region. No background job system: long work like bulk email or
  large imports runs inside requests or the daily cron. No caching layer. No read replicas. All of
  these are fine for the first hundreds of businesses and would need attention past that.

---

## 6. Project Completion Estimate

The percentage depends on which launch you mean, so here are two definitions.

**A. "Managed-service v1"**: you onboard 5–20 Australian hospitality or service businesses by hand
and bill them by bank transfer. This is the model the code is built for.

**B. "Commercial SaaS v1" with the full investor feature list**: social inbox, AI, marketing
campaigns, automated billing, bank feeds, STP.

| Area                     | A. Managed v1                             | B. Full SaaS v1 | Rationale                                                                                                                      |
| ------------------------ | ----------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Backend / DB             | **85%**                                   | 60%             | 99 tables, full RLS, ledger in the database; missing bank reconciliation, BAS, STP, conversations, campaigns                   |
| Frontend UI              | **80%**                                   | 55%             | 108 pages covering every built module; missing mobile app, drag-and-drop roster, inbox UI, finance dashboard                   |
| Third-party integrations | **35%**                                   | 10%             | Live: Resend, Fair Work API, OnlyOffice. Missing: Xero/MYOB, bank feeds, payments, STP, Meta/TikTok/WhatsApp, AI, mailbox sync |
| Security / Auth          | **75%**                                   | 70%             | Excellent isolation and testing; missing MFA, full CSP, independent pen test, backup-restore drill                             |
| Billing                  | **90%** (manual is the decision, ADR-057) | 5%              | Suspend/reactivate works; no Stripe, plans, metering or dunning                                                                |
| **Overall**              | **≈ 75%**                                 | **≈ 45%**       |                                                                                                                                |

**What to tell investors:** "The platform foundation and the core operations modules are built and
tested. We are about 75% of the way to a managed launch with our first paying hospitality
customers. The channels, AI and automated-billing layer that turns it into scalable SaaS is the
next phase, and that is what this raise funds."

---

## 7. Pre-Launch Checklist (before onboarding paying customers)

### Must-fix before showing the site to investors (tomorrow)

- [ ] **Remove or relabel the "Placeholder client logos" strip** on the public homepage
      (`src/components/marketing/logo-cloud.tsx`: Acme, Northwind etc. are invented). The code already
      labels it as placeholders, but it should not appear in a pitch.
- [ ] **Relabel the ✨ "Next best actions" panel** in the marketing mock-up, or say clearly that it
      is a concept (AI does not exist in the product).

### Core features and incomplete flows

- [ ] **Single Touch Payroll** before releasing real payslips to AU employees. It is a legal
      requirement; without it, keep payroll as "draft for your accountant".
- [ ] Leave accrual and leave pay; Medicare levy variations and tax offsets in PAYG
- [ ] Qualified review of: award readings (MA000119), chart of accounts and posting rules, contract
      wording
- [ ] GST/BAS report; bank statement import and reconciliation; aged receivables and payables
- [ ] Invoice PDF attachment; link invoices to Contacts; per-line tax codes
- [ ] Host OnlyOffice in production, or switch the Documents feature off for customers
- [ ] Undo an import; saved views
- [ ] Branded per-business sign-in and subdomain (milestone 4)

### Security

- [ ] **MFA** for admins and platform owners, at minimum
- [ ] **Owner action:** remove `public` from the Supabase Data API exposed schemas (ADR-059 #4)
- [ ] Full Content-Security-Policy with nonces
- [ ] Independent penetration test
- [ ] Dependency audit (`npm audit`, Dependabot/Renovate)
- [ ] Rate limiting on the authenticated app (today: sign-in, public forms, outreach email; 8 call sites)
- [ ] Privacy policy, data-processing terms, Australian Privacy Principles and NDB breach process
- [ ] Before any social channel: **signed webhook verification** (today only the OnlyOffice
      callback, which checks a JWT, and the cron secret, checked timing-safe, are inbound machine endpoints)

### SaaS billing

- [ ] Fine to stay manual for the first customers (ADR-057). Before scaling: Stripe Billing (plans
      by feature bundle and seat, invoices, dunning, webhook-driven status). The
      `tenant_subscriptions` table already has `stripe_customer_id`, `stripe_subscription_id` and
      `trial_ends_at` columns.

### Operations and reliability

- [ ] **Error monitoring and logging**: there is none today (no Sentry or log drain; errors go to
      `console.error` with personal data deliberately removed). Add Sentry plus a Vercel log drain.
- [ ] Uptime monitoring and a status page
- [ ] **Backup and restore drill** (listed as not done in ADR-059); point-in-time recovery on Supabase
- [ ] A background job system for bulk email, large imports and scheduled reports, once those features arrive
- [ ] An audit-log viewer for business admins
- [ ] More Playwright journeys (26 tests today; ADR-059 lists "Playwright journeys" as not done)
- [ ] Staging environment and deployment runbook; production deploy currently relies on Vercel's Git integration

### Third-party approvals (only when you build those features)

- [ ] **Meta App Review**: Messenger and Instagram messaging permissions, Business Verification,
      privacy policy URL, screencast. Plan 2–6 weeks.
- [ ] **WhatsApp Business Platform**: Meta Business verification, a display-name approval,
      template approval, or use a BSP (Twilio/360dialog)
- [ ] **TikTok**: Business/Marketing API developer approval; DM access is restricted
- [ ] **Xero/MYOB**: app partner certification for public listing
- [ ] **ATO STP**: either become a registered DSP (heavy) or integrate a certified STP gateway
      (recommended)

---

## 8. Recommended Future Roadmap (Post-Launch)

### Phase 1 (0–3 months): Launch safely and earn the first revenue

- Fix the marketing-site items above. Add MFA, Sentry, a backup drill and the Data API change.
- Get the professional reviews done: accountant (ledger), payroll specialist (award/PAYG), lawyer
  (contract templates).
- **STP through a certified gateway**, plus leave accrual. This unlocks real payroll for hospitality.
- Invoice PDF attachment, invoice ↔ contact link, per-line tax codes, payment reminders.
- **Online invoice payment** (Stripe payment links) for invoices sent to _customers' customers_.
- Host OnlyOffice in production.
- Onboard 5–10 pilot businesses through the console; measure which feature bundles they buy.

### Phase 2 (3–6 months): Channels and accounting depth

- **Unified inbox v1**: incoming email (forwarding/BCC), then WhatsApp Cloud API, then Facebook
  Messenger + Instagram DMs (after Meta App Review). Build on the helpdesk `tickets` /
  `ticket_messages` model and the activity timeline, with signed webhooks and Supabase Realtime.
- **Bank feeds** (through an aggregator such as Basiq) plus reconciliation, **GST/BAS report**,
  and AR/AP ageing.
- **Xero/MYOB sync** for businesses that keep their accountant's system.
- Roster: drag and drop, availability, shift swaps, mobile-friendly staff app (PWA first).
- Second and third award engines (General Retail, Fast Food).
- A background job runner (pg_cron/queue table) for bulk sends and scheduled reports.

### Phase 3 (6–12 months): AI, automation and self-serve scale

- **AI inside the RLS boundary**: timeline and ticket summaries, reply drafting in the unified
  inbox, lead scoring, duplicate and data-quality suggestions, a natural-language "ask your
  business" over reports. Use a provider with zero data retention and log all AI calls in the audit trail.
- **Marketing v1**: segments, consent and unsubscribe, broadcast email/SMS, automated sequences,
  open and click tracking.
- **Stripe Billing** and optional self-serve sign-up with industry templates (labels, stages,
  feature bundles).
- Public API, webhooks and Zapier/Make connector. Workflow automation ("when X then Y").
- Customer and partner self-service portals. White-label for resellers and accountants.
- TikTok messaging if API access is granted. Native mobile app if the PWA does not meet demand.

---

### Appendix: how to answer the likely technical questions

| Question                                              | Answer with proof                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "How do you stop one customer seeing another's data?" | Postgres row-level security on all 99 tables; requests run as `authenticated` with the tenant set per transaction (`src/server/db/with-rls.ts`); an automated test fails the build if any table lacks RLS or leaks across tenants.                                                                 |
| "Is it tested?"                                       | 378 unit tests (passing), about 575 database tests including cross-tenant and cross-owner denial per module, 26 Playwright tests; CI green on every merge to `main`.                                                                                                                               |
| "Can the books be corrupted by a bug?"                | No: only Postgres functions write the ledger, and they enforce balance, whole cents, immutability, lock date and tenant.                                                                                                                                                                           |
| "Who built it?"                                       | 91 commits from Oct to Nov 2026; much of the code was written by an AI coding assistant (Claude Code) working from a written specification and 62 ADRs, with founder review and CI gates. _State this openly: it explains the speed, and the specs, tests and ADRs are what keep it maintainable._ |
| "Is it secure enough for payroll data?"               | AES-256-GCM encryption with key rotation for tax/bank/super; audited reveal; first internal security review done. Independent pen test and MFA are on the pre-launch list.                                                                                                                         |
