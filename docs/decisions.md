# Architecture Decision Records

Short records of decisions that shape the codebase. New decisions get a new number;
superseded ones are marked, not deleted.

---

### ADR-001 · Modular monolith on Next.js + Supabase + Drizzle
**Decision:** One Next.js app; Supabase for Postgres, Auth, Storage, and scheduled jobs;
Drizzle for schema, queries, and migrations.
**Why:** One developer with Claude Code. Owning the schema in TypeScript (Drizzle) keeps the
data model portable and ours; Supabase removes auth/storage/infra work.
**Consequence:** No extra services until a measured need exists (see `roadmap.md` non-goals).

### ADR-002 · No separate Lead object
**Decision:** A lead is a Contact plus an Opportunity in the pipeline's first stage. Junk leads
go to Lost with reason "Spam/invalid".
**Why:** The requested pipeline starts at "New Lead", and consultants shouldn't have to
"convert" anything. One board shows the whole funnel; reports stay simple.
**Trade-off:** Opportunity counts include unqualified leads — reports use stage-reached
metrics, so this is visible rather than hidden.

### ADR-003 · Custom field values in JSONB, not an EAV table
**Decision:** `custom_fields jsonb` column on each extensible entity; definitions in
`custom_field_definitions`; values validated by a Zod schema generated from definitions.
**Why:** The EAV table in the original plan (`custom_field_values` with `value_text/number/…`)
needs one join per field on every list, makes filtering/sorting/import/export painful, and
is a well-known source of CRM performance problems. JSONB reads with the row, filters with
`->>`, indexes with GIN or expression indexes, and maps 1:1 to CSV columns.
**Trade-off:** Types aren't enforced by Postgres — enforced by the single Zod builder instead.

### ADR-004 · Memberships instead of `users.tenant_id`; permission catalog in code
**Decision:** `users` is global; `tenant_memberships(tenant_id, user_id, role_id, team_id)`
links users to tenants. Permission keys are a TypeScript catalog; the DB stores only
`role_permissions(role_id, permission, scope)`.
**Why:** Resale is 6–12 months out. Resellers, partner staff, and our own support staff will
need access to more than one tenant; changing `users.tenant_id` to a join table later touches
every auth path. A `permissions` table adds nothing a typed constant doesn't, and a typed
constant makes typos a compile error.

### ADR-005 · Record scope (own / team / all) as part of every grant
**Decision:** Each record permission carries a scope. Enforced in one helper (`scopeFilter`).
**Why:** The original plan had permissions but no data scope, which can't express
"consultants see only their own leads" or "managers see their team". This is the single most
common permission request in CRMs.

### ADR-006 · RLS applies to Drizzle queries via `withRls`; RLS is the tenant wall
**Decision:** User-driven queries run in a transaction that sets `request.jwt.claims`,
`app.tenant_id`, and `role authenticated`. RLS policies enforce tenant isolation on every
table. Record scope is enforced in the app layer in Phase 1 and mirrored into RLS later.
**Why:** Drizzle's `DATABASE_URL` connects as `postgres`, which bypasses RLS entirely — so
without this, the RLS policies in the original plan would never run for app queries. Scope-in-RLS
is deferred because roles will change a lot early on and per-row permission functions are
harder to debug; tenant isolation is not deferred because it's the resale-critical guarantee.

### ADR-007 · RLS on every table; Data API not used for data
**Decision:** Every table has RLS enabled with no `anon` policies. Remove `public` from the
Supabase Data API's exposed schemas. The browser uses Supabase only for auth.
**Why:** Supabase exposes `public` over REST with a key that is shipped to every browser. A
Drizzle-created table without RLS is readable by anyone.

### ADR-008 · Local development on the Supabase CLI stack, not plain Docker Postgres
**Decision:** `npx supabase start` runs Postgres + Auth + Storage + pg_cron locally.
**Why:** Plain Postgres lacks the `auth` schema, `authenticated` role, `auth.uid()`, Storage, and
pg_cron — so RLS, auth flows, and uploads couldn't be tested locally.
**Consequence:** Drizzle Kit remains the **only** migration tool; `supabase/migrations` stays
empty. After `supabase start`, run `npm run db:migrate && npm run db:seed`.

### ADR-009 · Stage history table
**Decision:** `stage_history` with one row per stage visit, for opportunities and their items.
**Why:** Time-in-stage, funnel conversion, and "stuck" reports need entry/exit times per stage.
Reconstructing them from activity JSON is slow and fragile.

### ADR-010 · Document checklist separate from files; server-issued signed URLs
**Decision:** `document_requirements` (what's needed + status) vs `documents` (files).
Private bucket, no storage policies for users; the server issues short-lived signed URLs after
permission checks, and audits downloads.
**Why:** "Pending" means no file exists yet, so status can't live on the file. Server-mediated
access keeps all authorization in one place.

### ADR-011 · Scheduled work via Supabase pg_cron
**Decision:** Reminders, overdue flags, and stale alerts are generated by pg_cron jobs calling SQL functions.
**Why:** The requirements need time-based notifications; "no background jobs" can't deliver
"task due in 30 minutes". pg_cron is included in Supabase at no cost and needs no new service.
Vercel Cron on Hobby runs at most daily. Trigger.dev (or similar) comes only with heavy
async work like 50k-row imports or email campaigns.

### ADR-012 · Composite tenant foreign keys
**Decision:** `(tenant_id, x_id) → x(tenant_id, id)` for all intra-tenant references.
**Why:** Makes it impossible — not just unlikely — for an opportunity in tenant A to reference
a contact in tenant B, even through a bug or a crafted request. Near-zero cost.

### ADR-013 · Soft delete for business records
**Decision:** `deleted_at` on contacts, organizations, opportunities, activities, tasks,
documents, partners, products. Purge after 90 days (Phase 2 job).
**Why:** Accidental deletes in a sales team are routine; audit requirements need history.

### ADR-014 · Email logging via BCC address before mailbox sync
**Decision:** Phase 2 starts with a per-user BCC/forward address that logs emails as
activities. Full Gmail/Outlook sync comes later.
**Why:** Works with any mail client, no OAuth. Gmail read access uses *restricted* scopes:
for an app used by other companies (resale), Google requires verification plus an annual
third-party security assessment. That's worth doing once there are paying tenants, not before.
An internal-only Google Workspace app avoids verification if we want Gmail sync for our own team sooner.

### ADR-015 · Hosting plan matches usage, not just price
**Decision:** $0 tiers for prototype/demo only. Before consultants enter real student data:
Vercel Pro + Supabase Pro (≈ $45/month).
**Why:** Vercel Hobby is limited to non-commercial use; Supabase Free has no backups and pauses
idle projects. Passports without backups aren't acceptable.

### ADR-016 · Tenant-configurable lists are tables, code states are enums
**Decision:** Stages, sources, lost reasons, document types, org types → tables/JSON config.
Task status, stage category, permission scope → Postgres enums.
**Why:** Anything a tenant may rename or extend must not require a migration.

### ADR-021 · Self-serve sign-up and provisioning are core, not Phase 3
**Decision:** A company subscribes on the marketing site, answers a few profile questions, and a
workspace is provisioned in one transaction (tenant, industry template, owner membership, team,
trial). See `onboarding.md`.
**Why:** This is the product's actual front door and the business model. Retrofitting it later
would mean rewriting auth, tenant resolution, seeding and billing at once.

### ADR-022 · Every workspace answers on its own branded address
**Decision:** `{slug}.meroidea.app` (wildcard DNS + TLS), with `/w/{slug}` as a fallback and
custom domains later. Invitation, verification and reset links all point at the workspace, and
its sign-in page carries the company's logo, name and colour — never the Meroidea marketing site.
**Why:** Staff of a customer should never see our marketing pitch; they should see their own
company. Supersedes the Phase 3 timing in ADR-017; `getTenantContext()` stays the only place
that resolves a tenant, so the change is contained.

### ADR-023 · Our own transactional email provider from day one
**Decision:** Invitations, verification, resets and notices are sent through Resend or SES on a
verified domain (SPF/DKIM/DMARC), using auth links generated server-side and our own templates.
**Why:** Supabase's built-in mailer is rate-limited and can't carry per-workspace branding. An
invitation is the first thing a customer's staff ever see of the product.

### ADR-024 · Stripe for subscriptions, entitlements enforced server-side
**Decision:** Stripe Checkout and Customer Portal; `tenant_subscriptions` mirrors status, seats
and period; plan entitlements (seats, storage, features) live in code and are checked on the
server before invites, uploads and gated features.
**Why:** Billing correctness is not worth building. Reversing the "no Stripe" line in ADR-001 is
deliberate: self-serve subscription is the business model.

### ADR-025 · One platform, one login — not installable apps
**Decision:** Everything the business needs — sales, people, work, documents, finance,
resources, insight, admin — is part of one system. Modules exist for code organisation; they are
never sold, installed or enabled per tenant. What a person sees is decided by role and scope.
**Why:** The customer we're describing has nothing digital today and shouldn't have to assemble a
suite or decide which apps to buy. They sign in and their business is there. It also keeps one
person = one record across sales and HR, one timeline, and one audit log.
**Cost:** The surface area is large, so `roadmap.md` sequences it — but each part ships into the
same workspace, not as a separate product.

### ADR-017 · Tenant resolution isolated in `getTenantContext()`
**Decision:** MVP resolves the tenant from the user's membership (+ cookie if several).
Subdomains/custom domains arrive in Phase 3 by changing only this function and `proxy.ts`.
**Why:** Avoids baking `/t/[slug]/` into every route now while keeping the switch cheap.

### ADR-018 · Opportunity items with their own stage track (applications)
**Decision:** An opportunity (education: the student's *case*) has many `opportunity_items`
(education: *applications*, one per institution + course + intake). Items move through their own
configurable pipeline (`pipelines.object_type = 'opportunity_item'`) and carry their own revenue.
Item stages can push the parent case forward (`advances_parent_to_stage_id`).
**Why:** Students apply to several universities/colleges at once, each with its own outcome and
commission. One opportunity per application would scatter one student's sales relationship across
many cards and duplicate the early stages (contacted, consultation). One opportunity with no items
couldn't track per-institution offers or commissions.
**Generic:** Real estate = offers on several properties in one buyer deal; recruitment = candidate
submitted to several jobs. The code name stays neutral; labels make it "Application".

### ADR-019 · Two revenue streams: expected values in MVP, ledger in Phase 2, invoicing stays in accounting
**Decision:** Direct revenue (service fee) on `opportunities.amount`; item revenue (institution
commission = tuition × rate, editable) on `opportunity_items.expected_revenue`. Phase 2 adds
`revenue_entries` (per-instalment expected → invoiced → received) and `partner_commissions`
calculated from **received** revenue. GST, invoices, and payments stay in the accounting system
(Xero integration later).
**Why:** The business earns both fees and commissions, and commissions usually arrive per study period,
months after enrolment. The owner needs forecast visibility now; exact cash tracking needs the
ledger; rebuilding accounting would be wasted effort and a compliance risk.

### ADR-020 · Hosted in Sydney
**Decision:** Supabase `ap-southeast-2`, Vercel functions `syd1`, tenant default `Australia/Sydney` / AUD / AU.
**Why:** Users and business are in Sydney; keeps personal data in Australia and query latency low.
Tenants in other regions later can still use this deployment (per-tenant timezone/currency), or a
second regional deployment if data-residency rules require it.

### ADR-026 · Hiring: one-time links, encrypted payroll details, guard rails not guarantees
**Decision:** A new hire accepts their contract and enters tax, bank and super details through a
one-time link, without an account. That path (`src/modules/hiring/public.ts`) uses the privileged
database connection; the link's secret (stored only as a SHA-256 hash, 14-day expiry) is the
credential, and every function starts from it and touches only the one contract it names.
Identifying numbers are encrypted in the application with a key held outside the database, and
each reveal to an admin is audited. Country rules (Australia only so far) live in
`src/modules/hiring/compliance.ts`; minimum rates come from the Fair Work Commission's pay
database when connected and are never hard-coded.
**Why:** People are hired before they can have a login, so RLS has no session to match — the same
situation as provisioning (ADR-021). App-level encryption means a database dump alone does not
expose tax file numbers. The rule checks stop required steps being skipped but cannot confirm a
classification, a rate for a junior, or contract wording is right, so anything the system cannot
know is a warning the admin must decide on, recorded in the audit log, not a silent pass.
**Consequences:** Losing `HR_ENCRYPTION_KEY` makes stored numbers unreadable. The public link has
no rate limiting yet. Contract wording is a starter template until a workspace supplies its own.

### ADR-027 · Supplier orders go through a channel interface; spreadsheets are read in-house
**Decision:** Placing an order talks only to `OrderChannel` (`src/modules/purchasing/channels.ts`).
Email via Resend is the one implementation; a supplier with an ordering API gets its own channel
registered there and named in `suppliers.order_channel`. Price lists are read from `.xlsx` and
`.csv` in the browser by a small reader in `src/lib/spreadsheet.ts`, not a spreadsheet library.
**Why:** Most suppliers take orders by email, but each API that exists is different, so the
honest abstraction is the seam, not a generic "API" setting that would let an admin point the
server at any URL. Reading only shared strings and first-sheet cell values is small and avoids a
new runtime dependency (the stack rule) and the known issues of the common spreadsheet packages.
**Consequences:** Old binary `.xls` files and password-protected workbooks are not readable.
Dates and number formats come through as Excel stored them, which is fine for names and prices.

### ADR-028 · Payslips are a record of hours and rate; tax is entered, not calculated
**Decision:** Authorising a roster drafts a payslip per linked employee as worked minutes × the
accepted contract's hourly rate, with super as a percentage chosen at authorisation. The tax
withheld is typed in by whoever runs payroll before release. The system applies no award
penalty rates, overtime, allowances or leave, and does not report to the tax office.
**Why:** Withholding schedules, award penalty rules and reporting obligations change yearly and
are exactly where a wrong figure is a legal problem. ADR-019 already keeps accounting in the
accounting system; the same holds for payroll calculation. What this module can do reliably is
tie pay to authorised hours and a signed contract rate, show staff their payslip, and keep it
unchangeable once released.
**Consequences:** A workspace still needs payroll software or tax tables for the withheld
amount. Salaried employees and anyone on the roster without a linked employee record are skipped
at authorisation and listed for the admin.

### ADR-029 · Platform-owner onboarding and per-business feature switches
**Supersedes:** the "never enabled per tenant" part of ADR-025 and self-serve sign-up in ADR-021.
**Decision:** Meroidea is operated by its owner for client businesses of different kinds. The
owner onboards each business from a platform console (`/platform`): creates the workspace and its
first admin login, and switches on the features that business needs. Feature keys live on
`tenants.features`; the catalogue and the map from permission family to feature are in
`src/lib/features.ts`. `loadTenantContext` drops any grant whose feature is off, so every page,
menu and action already guarded by a permission follows the switch. Public sign-up is refused at
the action. Platform owners are named by email in the server-only `PLATFORM_ADMIN_EMAILS`.
To act inside a business, a platform owner starts support access: a real owner membership marked
`is_support`, recorded in that business's audit log and visible in its team list, removed on
leaving. Businesses remain isolated from each other exactly as before.
**Why:** A restaurant needs inventory and rosters but not a sales pipeline; a consultancy the
reverse. One codebase with switches serves both without forks. Onboarding by the owner fits a
sales-led, configured service better than self-serve. A visible support seat was chosen over a
hidden bypass so that RLS, the tenant wall, is never weakened and the client can see when their
data was accessed.
**Consequences:** RLS itself does not know about features: a switched-off feature is refused by
the application layer, and its rows stay in place for when it is switched back on. The marketing
site's "Start free", trial and pricing copy no longer match the model and need rewriting. A new
admin receives a temporary password; password change and reset (milestone 4) are still to build.

### ADR-030 · Office documents are edited through a self-hosted OnlyOffice Document Server
**Decision:** Documents (docx, xlsx, pptx, pdf) are stored in Supabase Storage and edited in the
browser by OnlyOffice Document Server (Community Edition), run as a separate container beside
the app (`docker-compose.onlyoffice.yml`). The app signs the editor configuration, serves the
file to the editing service through a short-lived signed link, and receives the edited file on
a callback that requires both a signed link and a token signed by the editing service. An edit
becomes one new version when the last person closes the document.
**Why:** Faithful editing of Office formats is a product in itself; building it in-house or
converting to simpler formats loses formatting. OnlyOffice is open source, self-hosted (files
never leave our infrastructure for a third party), supports co-editing, and its free edition
covers a small business. This is the one deliberate exception to "no second service": it holds
no business data of its own beyond working copies during an editing session.
**Consequences:** Production needs the container hosted and reachable by browsers and by the
app; the free edition allows 20 simultaneous editing connections. If the service is down,
documents can still be downloaded and uploaded. The callback fetches the edited file only from
the editing service's own address, so the endpoint cannot be used to make the app fetch
arbitrary URLs.

## ADR-031 — Staff logins: added directly, password chosen through a one-time link

**Decision.** A business's admin (`users.manage`) adds a person in Settings → Team or from a
staff profile. The login and an active membership are created at once; there is no pending
`invitations` row. The person receives a one-time link issued by Supabase Auth
(`auth.admin.generateLink`, type `recovery`) that lands on `/auth/confirm`, signs them in and
sends them to `/set-password`. The same link is used for "send a new password link" and for
"forgot password". We deliver the link ourselves (ADR-023); when no email provider is set up it
is shown once to the admin to pass on, and never stored.

**Why.** Nobody but the person ever knows their password, admins included. One mechanism covers
first sign-in, reset by an admin and self-service reset. Skipping the invitations table removes
an accept step that small businesses do not need; the table stays in the spec for when seat
limits or expiring invitations matter.

**Consequences.** An email address can hold one login, so a person already on the platform
cannot yet be added to a second business from this screen. Deactivating a membership is the way
to remove access; the auth user is kept so history stays attributed. Link lifetime is the auth
server's recovery-token setting.

## ADR-032 — Payslip hours: rostered or clocked, chosen per pay run

**Decision.** A pay run is still anchored on a published roster (it defines the period and is
what gets authorised and locked). When authorising, whoever runs payroll chooses whether the
hours come from the roster's shifts or from approved timesheet entries that started in the
roster's period. Paying from timesheets is refused while any entry in the period is still
running or waiting for a decision.

**Why.** Businesses that do not clock in keep working exactly as before; those that do are paid
for the time actually worked, which the roster-only version could not do. Refusing on
undecided entries means nobody is silently left unpaid.

**Consequences.** A business that pays from timesheets still needs a published roster for the
period. Penalty rates, overtime and leave loading are still not calculated (ADR-028).

## ADR-033 — Clocking in only at the workplace

**Decision.** The platform owner records a business's coordinates and a radius (default 10 m,
5–1000 m) on its page in the platform console (`tenants.location_latitude/longitude`,
`clock_radius_metres`). While a location is set, clock-in and clock-out must carry the device's
position; the server measures the distance (haversine, `src/lib/geo.ts`) and refuses anything
outside the radius, a missing position, or a reading the device itself rates worse than 100 m.
The distance in metres is stored on the entry (`clock_in_distance_m`, `clock_out_distance_m`);
the coordinates are not. Staff can no longer add or correct their own time by hand, since that
would bypass the check; managers still can.

**Why.** Hours that feed pay should be recorded at work. Storing only the distance keeps
people's whereabouts out of the database.

**Consequences and limits.** The position is reported by the person's own phone or browser, so
this deters casual misuse; it is not proof, and a determined person can fake a location. Phone
GPS is typically accurate to 5–20 m outdoors and worse indoors, so a 10 m radius will sometimes
refuse someone who is genuinely inside: the radius is adjustable per business for that reason.
Browsers only share location over HTTPS (or localhost) and after the person allows it.

## ADR-034 — Recruitment: a public apply page per job, hand-off into hiring

**Decision.** Each job opening has an unguessable public address (`/jobs/{token}`). The page and
its intake endpoint (`POST /api/jobs/{token}/apply`, multipart) have no session and use the
privileged client in `src/modules/recruitment/public.ts`, which only reads an open job's wording
and inserts one application. Protections: a hidden honeypot field, a per-job hourly cap, one
live application per email per job (a repeat is answered as success without revealing it),
Zod validation, and a résumé limited to PDF/DOCX ≤ 5 MB checked by its leading bytes. Applicants
are tracked through fixed stages; a successful applicant is handed to the existing hiring flow
(`/hiring/new?applicant={id}`), which stays the only place contracts and pay are set.

**Why.** Small businesses advertise wherever they like and need one link to collect replies.
Keeping contracts in hiring avoids a second, weaker path to employing someone.

**Consequences.** Applicants are not emailed by the system. Stages are fixed, not configurable.
Deleting an applicant removes their résumé from storage. The hourly cap is per job, not per
visitor, because no rate-limit store is in the stack.

## ADR-035 — Projects, task time and productivity

**Decision.** Project work lives in its own tables (`projects`, `project_tasks`,
`task_time_logs`), separate from CRM follow-up `tasks`. People time tasks assigned to them with
a start/stop timer (one running at a time, capped at 24 h) or by typing hours in. The
productivity report is computed on request from rosters, timesheets, task time and finished
tasks; nothing is stored. A figure is shown only when the viewer may see everyone's records of
that kind, otherwise a dash.

**Why.** Follow-ups hang off a contact or opportunity; project tasks hang off a project with
status, estimate and time. Mixing them would complicate both.

**Consequences.** "Activity tracking" here means recorded time and finished work. The platform
does not capture screenshots, keystrokes, apps or websites used: that needs software installed
on each person's device and raises consent and workplace-surveillance obligations.

## ADR-036 — Customer reviews by link and QR code

**Decision.** A business creates review links, each with an unguessable address (`/r/{token}`)
and a QR code for it. A customer rates 1–5, may add a comment, name and email, and may agree to
be contacted. The review is private to the business; it is not published anywhere. Intake
(`POST /api/reviews/{token}`) has no session and uses the privileged client in
`src/modules/reviews/public.ts`, with a honeypot, a per-link hourly cap and Zod validation. A
review with an email matching a CRM contact is linked to that contact. QR codes are generated
in-house (`src/lib/qr.ts`: byte mode, level M, versions 1–6) rather than adding a dependency.

**Why.** Small businesses want feedback at the counter and on receipts without sending
customers to a third party, and want to see which sign or message it came from.

**Consequences.** Reviews are unverified: anyone with the link can leave one, more than once.
They cannot be pushed to Google or other public sites. A link's address must stay under 106
bytes for the QR generator, which every address the platform produces does.

## ADR-037 — Helpdesk tickets with a public form and a customer page

**Decision.** Tickets are numbered per business, carry a priority with a first-reply target
(urgent 1 h, high 4 h, normal 24 h, low 72 h, in clock hours), a status, a category and an
assignee. Staff write replies the customer can see, or private notes. A business may switch on
one public contact form (`/support/{token}`); each ticket also has its own unguessable page
(`/support/ticket/{token}`) where the customer reads replies and writes back, which reopens the
ticket. Both public paths use the privileged client in `src/modules/helpdesk/public.ts`, never
return private notes, and are capped per hour. When email is configured, a staff reply is also
emailed with the link; otherwise staff copy the link to the customer.

**Why.** A customer needs a way to follow a request without an account, and the team needs one
queue with clear ownership.

**Consequences.** Customers cannot reply by email: incoming email is not read, so replies happen
on the ticket page. Targets are not business-hours aware and nothing is escalated automatically;
overdue tickets are flagged in the queue. All staff with `tickets.work` see all tickets.

