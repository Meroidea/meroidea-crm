# Roadmap

Meroidea is one platform with one login (ADR-025). The order below is the order we *build* it —
not a menu the customer chooses from. Each milestone ends with something that runs and has been
reviewed. Give Claude Code one milestone at a time: *"Implement milestone 5 per docs/roadmap.md."*

Three things sit in the foundation because retrofitting them is what kills projects like this:
**tenant isolation, audit logging and custom-field storage**. Their admin screens can come later.

## Build status (2026-09-28)

Built as working vertical slices ahead of milestones 3–5, so the whole sidebar works end to end:

| Area | Built | Still to do for "Done when" |
|---|---|---|
| M2 tenancy & access | `withRls`, `scopeFilter`/`assertCanAccess`, `audit()`, `authedAction`, audit insert policy, every-table isolation test | Deactivated-membership test |
| M6 people & organisations | Contacts, organizations, links, duplicate warning, CSV import (chunked, dedupe) | Custom fields, `import_jobs` with undo, saved views |
| M7 pipeline | Pipeline + stages + lost reasons, opportunities, stage history, board (drag + mobile), list, record page | Multiple pipelines |
| M8 items & partners | Partners with commission terms, referral stats | Opportunity items (applications) |
| M9 work | Tasks, My Day, activity timeline + composer, stale detection | Notifications + pg_cron reminders |
| M11 insight | Live dashboard, reports (funnel, sources, owners, time in stage, follow-up, activity, lost reasons) | CSV export |
| Team (Stage 3, pulled forward) | Rosters: weekly or fortnightly, shifts per person, draft → publish, copy from previous, owner-only editing enforced by RLS | Leave and availability, shift costs, notifications to staff, timesheets |
| Documents (ADR-030) | Shared library for docx, xlsx, pptx and pdf: upload by one-time ticket to a private bucket, content check, folders, search, version history, audited downloads; in-browser editing and co-editing through OnlyOffice Document Server with signed configuration, file feed and save-back | Hosting the editing service in production, creating a blank document, per-document sharing and permissions, restoring an old version, older formats (doc, xls, ppt), linking documents to contacts or employees, storage quotas |
| Platform (Stage 4, pulled forward; ADR-029) | Platform console for owners: list businesses, onboard a business with its admin login, switch features per business, suspend and reactivate, audited support access; feature switches enforced through permissions; self-serve sign-up closed | Password change and reset for handed-over admins, business-type templates beyond feature presets (labels, default stages), per-business usage and health, billing, marketing copy rewrite, dashboard tailored to enabled features |
| Finance: invoices and payslips (Stage 3, pulled forward) | Invoices with lines, tax rate, numbering, email to customer, sent/paid/void, print; roster authorisation that locks the roster and drafts payslips (hours × contract hourly rate, super %), manual tax withheld, release to staff, My payslips, print; employee ↔ login link | Tax (PAYG) calculation, award penalty rates, overtime, allowances, leave, salaried staff, year-to-date totals, payment files, single-touch payroll reporting; invoice link to contacts/opportunities, part payments, credit notes, PDF attachment, accounting sync |
| Operations: purchasing (Stage 3, pulled forward) | Suppliers with delivery days, lead time and cut-off; price lists uploaded from .xlsx or .csv; order builder with valid delivery dates; numbered purchase orders emailed to the supplier with reply-to the buyer; re-send and cancel; order-channel interface for supplier APIs | A concrete supplier API channel; receiving an order into inventory; linking supplier items to inventory items; editing a single price; order approval; PDF attachment; .xls (old Excel) files |
| Operations: inventory (Stage 3 “Resources”, pulled forward) | Stock items with categories, units, reorder levels and costs; append-only movement ledger (received, used, wasted, correction, stocktake); low and out-of-stock views; stock value; per-item history | Multiple locations, suppliers as records, purchase orders, bulk stocktake screen, CSV import and export, low-stock notifications, assets and equipment on loan |
| Team: staff (Stage 3, pulled forward) | Staff directory grouped by department with search and status filters; departments add/rename/delete; employee profile with personal details, pay conditions, contract and payroll sections; end employment | Time and attendance, leave and availability, qualifications, notes and files, profile photo, linking an employee to a login and their roster shifts |
| Team: hiring (Stage 3, pulled forward) | Hire flow for full-time, part-time, casual, fixed-term and contractor; Australian rule checks and statutory statements; contract generated, sent by one-time link, accepted in-app; encrypted tax, bank and super details with audited reveal; Fair Work pay database client; Resend email | Lawyer-reviewed contract wording per workspace; Fair Work client verified against the live API; giving a hire a login (needs M4 invitations); editing a draft; contract variations; right-to-work checks; rate limiting on the public link; key rotation |
| M12 configuration | Workspace details, stage editor, lead sources, lost reasons, team roles | Custom field builder, labels, roles editor |

## Stage 1 — The workspace exists and sells itself

| # | Milestone | Done when |
|---|---|---|
| 0 | **Specification** (this folder) | Owner/BA sign-off; open questions answered or defaulted |
| 1 | **Foundation** — Next.js + TS strict, Tailwind, shadcn/ui, ESLint/Prettier, Vitest, Playwright, Supabase CLI stack, Drizzle, CI | App shell runs locally; CI green |
| 2 | **Tenancy & access** — tenants, users, memberships, teams, roles, permissions with scopes, audit log, RLS, `withRls`, `scopeFilter`, `audit()` | Isolation test over every table passes |
| 3 | **Sign-up & provisioning** — marketing sign-up, company profile, `provisionTenant()`, industry templates, trial record, welcome email (`onboarding.md` §1–3) | A stranger can create a workspace end to end in under two minutes |
| 4 | **Workspace front door** — `{slug}.meroidea.app`, branded sign-in, password reset, invitations with one-time links, accept flow, seat check, transactional email provider | An invited person lands on their company's page, not ours, and gets in with the right role |
| 4a | **Staff logins (built)** — add a person with a role, one-time set-password link, admin-sent reset link, forgot password, change own password, deactivate/reactivate, add from a staff profile (ADR-031). Branded subdomain sign-in and seat checks remain in 4 | A client's admin adds their team without the platform owner |
| 5 | **Admin dashboard** — setup checklist, people & roles, teams, branding, workspace settings | The CEO can brand the workspace and add their whole team without help |

## Stage 2 — The work fits in it

| # | Milestone | Done when |
|---|---|---|
| 6 | **People & organisations** — contacts, companies, relationships, custom fields, duplicate detection, import from CSV/Excel with undo | 5,000 rows import with duplicates flagged; consultant scope tests pass |
| 7 | **Sales pipeline** — pipelines/stages per workspace, opportunities, kanban and list, stage history, lost reasons | Every stage move is recorded, audited and reportable |
| 8 | **Deal items & partners** — several items per opportunity with their own status and value, referral partners and their share | One opportunity with three items tracks three outcomes independently |
| 9 | **Work** — tasks and follow-ups, activity timeline, My Day, reminders and stale alerts (pg_cron), notification centre | A person can run their day from one screen on a phone |
| 10 | **Documents** — document types at each level, checklists, upload via signed URL, verify/reject, expiry warnings, audited download | A document verified once counts everywhere it's required |
| 11 | **Insight** — dashboards and reports (conversion, sources, follow-up compliance, time in stage, revenue), CSV export | The owner can answer "who's following up, where things stall, what's coming" |
| 12 | **Configuration** — pipeline and stage editor, custom field builder, labels, document types, lead sources, roles editor | A workspace can be reconfigured for a different industry without code |
| 13 | **Billing** — Stripe Checkout and Portal, plan entitlements, seat enforcement, trial reminders, dunning | A workspace can subscribe, add seats and cancel without us touching anything |
| 14 | **Hardening & launch** — audit viewer, security review, Playwright happy paths, backups tested, production setup | First paying workspace runs on it daily |

## Stage 3 — The rest of the business, in the same workspace

Same login, same people records, same audit trail — added module by module.

- **Team & employees** — staff records linked to the same person record, employment details, roles and reporting lines, leave requests and approvals, employee documents with expiry (visa, licence, insurance), onboarding checklists.
- **Finance** — quotes and invoices, payments received, commissions payable, expenses, receivables ageing, accounting sync (Xero/MYOB) rather than replacing it.
- **Resources** — assets, equipment, rooms and vehicles: what exists, who holds it, when it's due back, what it costs.
- **Projects & delivery** — projects with phases, assignments, time logging and a simple capacity view.
- **Inbox & channels** — email logging by BCC first, then mailbox and calendar sync; WhatsApp/SMS logging; internal notes and mentions.
- **Self-service portals** — a customer or partner signs in to see only their own records.

## Stage 4 — Platform

- Public API and webhooks; Zapier/Make connectors
- Custom domains and full white-label for resellers
- Workflow automation (when X then Y), templates marketplace
- AI: lead scoring, timeline summaries, duplicate and data-quality suggestions
- Platform admin console (our staff), per-workspace usage and health

## Non-goals until a measured need

Microservices, a second database, GraphQL, a search engine, a job-queue platform, real-time
collaborative editing, native mobile apps, replacing the customer's accounting ledger.

## Milestone 1 notes for Claude Code

- The project root already holds `.claude/`, `docs/` and design files, so `create-next-app`
  will refuse the directory. Scaffold into a temp folder and move the files in.
- Check current versions and docs for Next.js, Tailwind, shadcn/ui, Drizzle and `@supabase/ssr`
  before writing config — don't rely on remembered APIs.
- Upgrade to Node 24 LTS first (`.nvmrc`, `engines` in `package.json`).
