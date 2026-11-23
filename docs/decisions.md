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
**Consequence:** Grants are explicit per migration. A project created with Supabase's default
"expose new tables" privileges is brought back to them by migration `0054`; every policy except
the self/colleague ones on `users` and the agreement reads also needs `app.tenant_id`, which only
`withRls` sets, so a user token sent straight to the Data API sees nothing.

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
*(Superseded by ADR-029 and ADR-047: the platform owner onboards each business; public sign-up
is closed.)*

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
*(Superseded for now by ADR-057: businesses pay the platform owner directly and access is
switched by hand; Stripe may come back as a new decision.)*

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
> **Partly superseded by ADR-060:** Meroidea now keeps its own double-entry ledger under invoices and payroll. Expected revenue on opportunities is unchanged.

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
visitor, because no rate-limit store is in the stack. *(Superseded by ADR-039: a per-sender limit
now sits alongside the per-job cap, counted in Postgres.)*

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


## ADR-038 — Feature switches enforced by the database too

**Decision.** A switched-off feature is hidden by Postgres, not only by `loadTenantContext`.
Migration `0043` adds `app.permission_feature(perm)` (the SQL twin of `FAMILY_FEATURE` in
`src/lib/features.ts`) and `app.feature_enabled(tenant, feature)`. `app.has_permission` now
returns false for a permission whose feature is off, and `app.my_context` returns only live
grants. Every table that belongs to exactly one feature carries a restrictive `feature_switch`
policy, so its rows can be neither read nor written while the feature is off. Tables shared
across features (`employees`, `rosters`, `roster_shifts`, `payslips`, `time_entries`, `tasks`,
`activities`, `projects`) are left to `has_permission` and the application, because hiding them
would break a feature that is still on. The same migration makes `app.my_context` return the
feature list, support flag, clock-in location and team members, so building a request's context
is one query in one transaction instead of three.

**Why.** Every other rule in the design has a second layer in the database. Before this, a
service that forgot `requirePermission` would have exposed a switched-off module's data.

**Consequences.** A new permission family must be added to both `FAMILY_FEATURE` and
`app.permission_feature` (in a new migration); `tests/db/hardening.test.ts` fails if they differ.
A new table owned by one feature gets a `feature_switch` policy in its RLS migration. Pages that
read a feature's tables must check the feature first, as Settings now does for the pipeline.

## ADR-039 — Per-sender limits and capped bodies on public forms

**Decision.** Each public form keeps its hourly ceiling across all senders (raised to 200
tickets per form, 200 reviews per link, 100 applications per job) and adds a per-sender limit of
5 an hour. Senders are counted in `public_rate_limits`: fixed one-hour windows keyed by the form
and an HMAC of the sender's address (key derived from the server secret), incremented with one
atomic upsert. Old windows are swept on about one call in fifty. The address comes from
`clientAddress()` (`x-vercel-forwarded-for`, then `x-real-ip`, then the first `x-forwarded-for`
hop, valid IPs only). Every public route reads its body through `readBodyWithLimit()`, which
stops at the limit whatever `Content-Length` says, so a chunked request cannot get past the cap.
Over-limit requests get `RATE_LIMITED` and HTTP 429.

**Why.** A per-form ceiling alone let one script use up a business's allowance and lock its
real customers out. Rejecting a request by its declared length alone let a chunked upload
(which declares none) through.

**Consequences.** A distributed flood from many addresses can still reach a form's ceiling;
add a challenge such as Cloudflare Turnstile if that is ever seen. Off Vercel, the proxy in
front must overwrite the forwarding headers, or a sender can choose its own address. People
behind one shared address share its limit.

## ADR-040 — Rotating the staff details encryption key

**Decision.** Field ciphertext now names its key: `v2.<key id>.<iv>.<tag>.<body>`, where the key
id is a truncated SHA-256 fingerprint. `HR_ENCRYPTION_KEY` seals all new values;
`HR_ENCRYPTION_KEYS_PREVIOUS` (comma-separated) may only read. Original `v1` values, which name
no key, are read by trying each key, with GCM authentication picking the right one. The platform
console shows how many staff records are still on an older key and has a "Re-encrypt now"
control (`src/modules/hiring/key-rotation.ts`). It re-seals each row in its own transaction,
leaves values no configured key can open untouched, and writes a `platform` audit row per
business.

**Why.** A key that cannot be replaced has to stay valid forever, even after a suspected leak
or a staff change.

**Consequences.** To rotate: add the old key to `HR_ENCRYPTION_KEYS_PREVIOUS`, set the new key,
deploy, re-encrypt from `/platform`, confirm nothing is pending, then remove the old key.
Removing it before re-encrypting makes those values unreadable.

## ADR-041 — Rosters: teams, shift-by-shift publishing, and costed shifts with day loadings

**Decision.** The roster keeps its week or fortnight container, and gains four things.

1. **Teams** (`roster_teams`, `roster_team_members`) replace the free-text shift tag. Each
   business names and colours its own, and a person can only be rostered into a team they
   belong to. Existing tags were converted to teams with their people as members.
2. **Vacant shifts.** A shift may have no person yet (`user_id` null). It is never paid.
3. **Publishing is per shift.** Each shift records when staff were last shown it
   (`published_at`) and whether it has changed since (`unpublished_changes`). Staff see a shift
   only once it has been published; a shift added to a published roster stays hidden until the
   next publish. A change to an already-published shift is visible at once and stays flagged
   until published, which is when the person can be emailed. A removed published shift is kept
   flagged until its removal is published. Publishing can email each affected person their own
   shifts; mail is sent after the change is saved and never undoes it.
4. **Shift cost with day loadings.** A shift is costed as paid hours × the person's accepted
   contract hourly rate × a loading for the day it starts on. Each business sets its own
   Saturday, Sunday and public-holiday multipliers and keeps its own list of public holidays
   (`workforce_settings`, `public_holidays`). Breaks are a list of paid and unpaid breaks, filled
   in from the business's break rules unless set by hand; only unpaid breaks come off the hours.

**Why.** The owner asked for the roster to work the way the scheduling tool their clients
already know does: build by day, see the cost as you go, and publish changes without
re-announcing the whole week. A single weekend multiplier chosen by the business is honest about
what it is, where a built-in award table would claim an accuracy the platform cannot keep up to
date (the reasoning in ADR-028 still stands).

**Consequences.** This amends ADR-028 for **cost on the roster only**: payslips are still hours
× contract rate with no loading, so a roster's cost can be higher than the gross on the payslips
made from it until loadings are applied to pay, which is planned with the timesheet milestone.
A whole shift takes the loading of its start day; a shift that runs past midnight is not split.
Salaried staff and anyone without an accepted hourly contract are not costed. Cost is shown only
to someone who holds both `rosters.manage` and `employees.manage`. Loadings and break rules are
changed with `rosters.manage`. An edit to a published shift is seen by staff before it is
announced; a business that wants edits held back should move the roster back to draft first.

## ADR-042 — Award rates are read from the Fair Work pay database, by employment type

**Decision.** For anyone hired under a modern award, the rates Meroidea shows and checks pay
against are the Fair Work Commission's own published rows, read through its Modern Awards Pay
Database API (`src/server/fair-work.ts`) and shaped by `src/modules/hiring/award-rates.ts`:

- The **minimum for an ordinary hour depends on the kind of employment**. For a full-time,
  part-time or fixed-term employee it is the classification's base rate. For a casual it is the
  award's published casual rate, which includes the casual loading. Juniors and apprentices are
  separate classifications with their own rates. The offer check compares pay with that figure.
- The full **rate schedule** for the classification (ordinary and penalty rates, overtime,
  allowances) is stored on the contract (`employment_contracts.rate_schedule`), shown in the hire
  form and on the staff profile, and summarised in the contract wording at the date of the offer.
  It can be read again at any time from the staff profile; if the award has since risen above the
  agreed rate, the profile says so.
- **Roster cost** uses the award's whole-day rates (Saturday, Sunday, public holiday) for a
  person whose award publishes exactly one for that day, as a ratio of the award's ordinary rate
  applied to the person's agreed rate. The workspace's own loadings (ADR-041) remain the
  fallback for staff with no award or no such rate.

Only rows in force today are used, in their latest published edition, and every page of a result
is read. No dollar figure is typed into the code or multiplied out by it: where the database does
not publish a figure (a casual rate, a whole-day rate) the schedule says so and nothing is assumed.

**Why.** The previous check compared a casual's pay with the base rate, without the loading, and
read only the first page of an award's classifications. Rates change at least every July, and the
only defensible source is the Commission's own.

**Consequences.** The pay database gives rates, not rules. *When* a rate applies (the hour
overtime starts, minimum shift lengths, evening and night windows, split shifts, how penalties
combine, when an allowance is owed) is in each award's text and is **not** applied automatically:
roster cost covers whole-day rates only and is an estimate, and payslips are still hours × the
agreed rate (ADR-028). Tax and superannuation are unchanged. Which award and classification
covers a person remains the employer's decision; a wrong choice gives wrong rates. A contract
whose classification was typed in before the database was connected cannot be looked up.
Groups of rates are matched to casual or permanent employment by the Commission's wording of the
group title, which holds for the awards tested (restaurant, hospitality, retail, fast food,
clerks) but is a reading of text, so the source wording is always shown beside the figure.

## ADR-043 — Award rules are written down award by award, from the award's text

**Decision.** For an award whose rules have been encoded, Meroidea works out what each rostered
shift pays under the award. The first is the Restaurant Industry Award 2020 (MA000119), in
`src/modules/awards/ma000119.ts`, written from the Fair Work Commission's consolidated text
incorporating amendments to 1 July 2026. Each rule carries its clause number, and every pay line
shown names the clause it applies.

- The file holds **rules, never rates**. Dollar figures come from the person's rate schedule
  (ADR-042), found by the Commission's own wording. If a rate the rules need is not published,
  nothing is worked out and the screen says which rate is missing.
- A person's shifts are costed **together for the roster period**, because overtime depends on
  their other shifts. Applied: ordinary, Saturday, Sunday and public holiday rates by the hour
  worked (cl 24.2), with the change of rate at midnight; the extra amounts for 10 pm to midnight
  and midnight to 6 am, per hour or part, on ordinary Monday to Friday hours (cl 24.2); overtime
  past 11.5 ordinary hours in a day (12 for a casual) or 38 a week averaged over the roster
  cycle, in the two bands of Table 7 (cl 10.13, 11.2, 11.5, 23); the casual 2-hour minimum
  (cl 11.3); the public holiday minimum payment (cl 24.4(a), (b)); and the split shift allowance
  (cl 21.3).
- **Rostering limits are warnings**, not blocks: meal breaks (cl 16.2), part-time and full-time
  daily minimums (cl 10.7(b), 15.1(a)), 10 hours between days (cl 15.1(e)), the 12-hour spread of
  a split day (cl 15.1(g)), under-18 shift length (cl 13.3), two days off for a part-timer
  (cl 10.7(c)).
- Someone paid above the award keeps that margin on every rate in the cost; nobody is costed
  below the award. The award minimum is kept alongside.
- Staff under any other award, or none, are costed as before (ADR-041, ADR-042).

**Readings of the text that a reviewer should confirm.**
1. Every hour worked on a public holiday is paid at the public holiday rate, including hours
   that would otherwise be overtime: Table 7 has no public holiday row and its note points to
   clause 24.
2. The late-evening and night amounts are not added to overtime hours (cl 24.1) or to weekend
   and public holiday hours (Table 8 limits them to Monday to Friday).
3. The daily limit counts all shifts that start on the same day; a shift that runs past
   midnight is one day's work for that limit, but each hour is paid at the rate of the calendar
   day it falls on.
4. With no recorded time for the meal break, it is assumed to fall in the middle of the shift.
5. The weekly limit is 38 hours times the number of weeks in the roster (one or two).

6. On hours actually worked, a part-timer is paid overtime for time beyond what they were
   rostered for that day, and for all of a day they were not rostered on (cl 10.13(b)(iii)). A
   written agreement to vary their hours is not recorded, so it is not taken into account.

**Not applied**, and listed on the interpreter (`notApplied`): rostered days off, the break
after overtime and time off instead, the four-week limits, meal, tool and clothing allowances,
the missed-meal-break penalty, part-day and substituted public holidays, annualised wages,
apprentice conditions, and juniors serving liquor.

**Consequences.** This is a calculation aid, not legal advice. The award text must be re-read
when the Commission varies the award; `textAsAt` records what it was written from. Payslips do
not use it yet (ADR-028 still describes them). Each further award is its own file and its own
review.

## ADR-044 — Timesheets are approved day by day against the roster

**Decision.** Someone with `timesheets.manage` approves time on a daily screen
(`/timesheets?view=day`). Each row is one published rostered shift, or one stretch of recorded
time with no shift. A person's clocked time is paired with their shift (the nearest start when
there are several); a manager can correct it or, where nobody clocked in, type what was worked,
then approve it. Time recorded this way is linked to the shift (`time_entries.shift_id`).
Each row shows worked against rostered hours and, for whoever may see pay, the cost of each
under the same rules as the roster (ADR-041 to ADR-043), now on hours actually worked.

A pay period screen (`/timesheets?view=period`) covers the roster's period for the day, or the
calendar week when no roster covers it: per person, rostered and approved hours, gross from
approved time, and what still stands in the way (time waiting, finished shifts with nothing
recorded, people still clocked in). Approved time can be exported as a CSV file, one line per
rate it was paid at, with the award clause; the export is audited.

**Why.** Approving a week's list of entries does not show what was planned, so overruns and
no-shows were invisible. Costing worked hours with the award's rules is also the only place a
part-timer's overtime beyond their roster can be seen.

**Consequences.** Typing time for a day is manager-only, which keeps the workplace location
rule for clocking intact (ADR-033). Correcting an entry sends it back to waiting unless it is
approved in the same step. Rostered shifts are read under the roster's own access rules, so a
person who manages timesheets but may not see everyone's roster sees others' time as "not
rostered". Breaks on recorded time are a single unpaid figure. The export is CSV, not an Excel
workbook, and is not a payroll file for any particular accounting system. **Payslips are still
drafted on the Payroll screen as approved hours × the agreed rate (ADR-028, ADR-032): the award
figures on these screens are not yet what a payslip is made from.**

**Addendum (Excel workbook export).** The pay period can also be exported as an Excel workbook
laid out like the timesheet export of the rostering tool the owner's clients already use:
Overview (name, employee ID, gross wage, age, then hours per pay rate and counts of flat
amounts), Details (start, break and end for each day), By Team, By Shift Award Tag, By Comments,
a sheet per day and a sheet per person. `src/modules/timesheets/workbook.ts` arranges the
figures and `src/server/xlsx.ts` writes the file without a spreadsheet library (the stack rule;
compare ADR-027). Differences from that tool's file, by design: the file is `.xlsx`, not the old
binary `.xls`; pay columns are named for the award's own rates ("Ordinary hours", "Saturday",
"Overtime, …") rather than that tool's pay categories; the location column is the business's
name, since locations are not modelled; Employee ID is present but empty, since payroll numbers
are not kept; the break on the Details sheet is a length, since break times are not recorded;
By Shift Award Tag lists people only. Gross wage, age and pay columns are left out for anyone
who does not manage employee records.

## ADR-045 — Every employee has an Employee ID the database assigns and nobody can change

**Decision.** `employees.employee_number` is an identity column the database always generates,
starting at 100001. It is assigned the moment the employee record is created at hire, by every
path that can create one, because the database does it rather than the application. No value can
be supplied on insert, and a trigger (`app.keep_employee_number`) refuses any later change,
including drawing a new one, for every role including the privileged connection. Numbers are
never reused: a removed employee keeps theirs.

It is shown as **Employee ID** on the staff list, the staff profile, the hiring list and
payslips (kept on the payslip as it was at the time), fills the Employee ID column of the
timesheet workbook, and a staff search made only of digits looks a person up by it.

**Why.** Names change and repeat; a person needs one identifier that payroll, timesheets and the
people themselves can rely on. Letting the database assign it means there is no screen, import or
script that can forget to, and making it unchangeable in the database means no later feature can
weaken that by accident.

**Consequences.** The sequence is shared by the whole platform, so IDs are unique everywhere but
a business's own IDs are not consecutive, and the size of the gaps hints at how many people other
businesses have hired. Employees that existed before this were numbered in the order the database
held them, not by hire date. A business cannot bring its own numbering from another system; if
that is needed it should be a separate, editable "payroll reference" field, not this one. The
internal `id` (uuid) remains what tables reference.

## ADR-046 — Payslips are made of pay lines, carry the employer's details, and show the year to date

**Amends** ADR-028 (gross was hours × rate), ADR-032 and the payslip note in ADR-041 to ADR-044.

**Decision.**
- **Pay lines.** A pay run turns each person's hours (rostered, or approved timesheet time)
  into lines with `src/modules/payroll/lines.ts`: under an award with written-down rules, the
  award's own lines (ordinary hours, Saturday, Sunday, public holiday, overtime bands, minimum
  payments, the split shift allowance and late amounts) from the engine in ADR-043; otherwise
  hours at the agreed rate, with the workspace's Saturday, Sunday and public-holiday loading
  (ADR-041). **Gross pay is the sum of the lines.** Each line of hours is settled once on its
  total, so hours × rate equals the amount shown.
- **Super** is the chosen percentage of ordinary time earnings: every line except overtime.
- **The employer's details** are kept per business (`tenants.settings.business`: name on
  documents, business number, address, phone, email, website, payroll contact; edited under
  Settings by someone with `settings.manage`, ABN checked in Australia) and copied onto each
  payslip when it is made, so a later change never rewrites a payslip already issued.
- Each payslip also keeps the employee's **Employee ID**, their **payslip number** (their own
  count), employment type and classification.
- **Year to date** is worked out when the payslip is read: this payslip plus the released ones
  before it in the same financial year (from 1 July in Australia, otherwise 1 January), in
  total and per line.
- The payslip is laid out for print on one A4 page in the ordinary case: employer, employee and
  pay details, payments, deductions, employer super, net pay, year to date, and the time the
  pay covers.

**Why.** The owner's clients are used to payslips that show what the pay is made of, the
business it came from and running totals for the year. A single "hours × rate" figure also hid
weekend, public holiday and overtime rates that the roster and timesheets already show.

**Consequences.** Payslips for staff under the Restaurant Industry Award now depend on the six
readings of that award listed in ADR-043, which should be confirmed by a qualified person
before a business relies on them for pay. Tax is still typed in, not calculated. Leave is not
paid, accrued or shown. There is no logo upload yet: the payslip shows the business's initial.
Payslips made before this have no lines, employer details or number; they are shown as one line
of hours at their hourly rate, with the employer text typed at the time. Treating all
non-overtime lines as ordinary time earnings for super is a simplification an accountant
should confirm (expense-type allowances, when they are added, will need excluding).

## ADR-047 — Onboarding records who the business is; its admin accepts a service agreement before getting in

**Supersedes:** the temporary password in ADR-029.

**Decision.** When onboarding a business, the platform owner records its name, legal name, ABN
(check digit validated), primary contact (name, email, phone), and optionally its clock-in
location, alongside its features and its admin's name and email. These identity fields live in
columns on `tenants` that only the platform console writes; the business's admin sees them in
Settings but cannot change them (contact details printed on payslips, such as address and phone,
stay theirs to edit).

The admin's login is created with an unusable password and the business starts as
`awaiting_agreement`, closed to its own people (a support seat can still enter). The workspace,
its identity, the agreement request and the audit entry are written in one transaction
(`provisionTenant`'s `finish` step), so a failure leaves no half-made business; the login is
removed again if anything fails. The admin is
emailed a one-time link (`/agreement/{token}`, secret stored as a SHA-256 hash, 14 days) to the
current version of the service agreement. Accepting requires ticking a box and typing the name
the platform owner recorded; the acceptance stores the version, time, typed name, IP address and
browser, spends the link and opens the business. The admin is then sent straight into the
existing set-your-password flow (ADR-031). Agreement versions are immutable; new wording is a
new version, and businesses keep the version they accepted. Reactivating a suspended business
that has not accepted returns it to `awaiting_agreement`.

**Why.** If the platform owner chose or saw the admin's password, nothing done under that login
could be told apart from the platform owner's own actions, which defeats the audit log in any
dispute; the platform owner already has audited support access, so they never need it. One
link that both records the agreement and leads to choosing a password is one step for the
client. Recording the exact version, typed name, time and network details is what makes a
click-through acceptance defensible as an electronic signature (Electronic Transactions Act 1999
(Cth) s10: a method that identifies the person and shows their intention, as reliable as is
appropriate). Locking identity fields keeps payslips and invoices from being issued under a
name or ABN the platform owner never verified.

**Consequences.** A service agreement must be published before any business can be onboarded.
Its wording is for a lawyer to write; the system only stores and records it. The ABN check
catches typing errors but does not prove the ABN is registered to that business (the ABN Lookup
web service could, later). Businesses onboarded before this change have no agreement record and
stay active; asking them to accept, and asking every business to accept a new version, are not
built yet. Changing a business's admin to someone else is not built yet. The accept page has no
per-sender rate limit; the link's 256-bit secret is the protection.

## ADR-048 — Admin, Manager and Staff; a login when a hire accepts their offer

**Decision.**
- A business's roles are **Admin**, **Manager** and **Staff**: the display names of the role keys
  `owner`, `manager` and `member`. Keys stay as they are because code and database policies refer
  to them. New businesses no longer get the `support` role, a leftover of the CRM-only design;
  businesses that already have it keep it. Migration 0050 renames roles that still carry their
  old default name and description, and leaves any name a business chose.
- Everyone added to a business, by an admin or by accepting an offer, joins the team made when the
  business was created. Existing members without a team join it in the same migration (support
  seats excepted).
- The hire form asks which login the person gets when they accept: Staff (default), Manager or
  none. Choosing one needs `users.manage` as well as `employees.manage`; the Admin role cannot be
  chosen. It is stored on `employees.login_role_id`. When the hire accepts, after that acceptance
  is committed, `src/modules/access/hire-login.ts` creates the login with an unusable password,
  adds it to the business with that role and team, links it to the employee record, audits it,
  and emails them a one-time link to choose their password (ADR-031). The offer page tells them
  they have a login and how to get in.

**Why.** The owner's clients have one admin and two levels of staff; the old names (Owner,
Member, Support) came from a sales CRM. A Manager's records are scoped to their team, and staff
added until now had no team, so a Manager who assigned a task to a staff member could no longer
see it. One team per business by default makes "Manager sees their staff" true without giving
Managers every record in a business that does split into teams later. Creating the login on
acceptance removes a step the admin would otherwise forget, and links the person's roster,
timesheets and payslips to them from day one.

**Consequences.** Logins are only created on acceptance, so someone who never accepts never gets
one. If the hire's email already belongs to an active member of the same business (an admin added
them before they accepted), the staff record is linked to that login instead. If it belongs to
anyone else (one email holds one login, ADR-031), or anything else fails, the acceptance still
stands, nothing is created, the reason is audited, and the admin can give a login from the
profile. Without an email provider the hire is not sent the
password link; the admin sends one from Settings → Team (shown once to pass on), or the hire uses
"Forgot password" once email is set up. Moving people between teams has no screen yet.

## ADR-049 — Questions and concerns: staff ask managers or the admin, inside the workspace

**Decision.** A feature, **Questions & concerns** (`concerns`), gives staff one place to ask the
business something and get an answer: hours on a payslip that look wrong, a shift swap, leave, or
anything they need to talk about. A question has a topic (pay, hours, shifts, leave, workplace,
anything else), a title and a conversation, and is sent to **managers** or to **the admin only**.
From one of their own released payslips, staff can press "Ask about this payslip": the question
is sent to the admin, filed under pay, and linked to that payslip, which the admin can open from
the question. Statuses are open, being looked at (set automatically when the business first
replies) and resolved. The person who asked can mark it resolved when they have their answer, or
reopen it; replying to a resolved question reopens it. Those who answer can set any status.

Permissions: `concerns.raise` (everyone), `concerns.handle` (Manager and Admin: questions sent to
managers) and `concerns.handle_all` (Admin: every question). RLS decides who can read a question,
so one sent to the admin only is invisible to managers at the database. A question can link only
to the asker's own released payslip (checked in the service and by the insert policy). What was
asked, to whom and about which payslip never changes afterwards (column grants). Those who can
answer are emailed that a question is waiting, without its content, which also stays out of the
audit log. Questions are never deleted. The feature is in the starting set for every kind of
business with staff; existing businesses get the role grants, but the feature stays off until the
platform owner switches it on (ADR-029).

**Why.** Staff otherwise ask in passing on shift or by text, the answer is lost, and a pay mistake
is easy to forget. Keeping the conversation next to the payslip it is about means the admin sees
exactly which pay run is questioned. Managers have no access to pay (they lack `payroll.manage`),
so pay questions belong with the admin; "the admin only" is also there for anything a person would
rather not share with their manager, and RLS makes that a guarantee rather than a screen setting.

**Consequences.** It is not anonymous and not a formal complaints or whistleblowing process; the
asker's name is always shown. A Manager's question sent to managers is visible to the other
managers. Questions can link a payslip but not yet a timesheet day or a roster shift. There are no
attachments, reminders or reports yet. Without an email provider, nobody is notified and questions
wait on the list.

## ADR-050 — Staff training: courses and modules, assigned by role, department or person

**Decision.** A feature, **Training** (`training`), lets a business put its training online and
see who has done it. A **course** (for example "Welcome to the cafe" or "Cash handling") holds
**modules**. A module has content written as plain text (headings, paragraphs, bullet points),
an optional video (YouTube and Vimeo play in the page from their privacy-enhanced addresses; any
other https address is a link), and an optional multiple-choice **quiz** with a pass mark.
Without a quiz, staff mark the module as read and understood. A course is **assigned** to
everyone, to everyone with a role (Manager, Staff), to everyone in a department (from their staff
record), or to named people, in any combination; it reaches staff only once **published**, and
**archiving** takes it out of everyone's training while keeping every result.

Permissions: `training.learn` (everyone: see and complete your own assigned training),
`training.view_all` (Admin and Manager: everyone's progress) and `training.manage` (Admin only:
write courses, modules and quizzes, and assign them). The platform owner writes training for a
business through support access, which is an Admin seat (ADR-029).

Staff see their overall completion as a ring, each course's progress as a bar, and the selected
course's modules with status and best score. Those with `training.view_all` see every person as a
completion ring on a searchable grid, open anyone's individual page, and see each course's average
across the people assigned to it.

Rules enforced by the database: a learner can read a course, its modules and questions only when
the course is published and assigned to them; the right answers live in
`training_question_keys`, which only `training.manage` can read; results are written only by
`app.submit_training_module`, which runs with the function owner's rights, checks the module is
published and assigned to the caller, marks the answers and records the result (passed stays
passed, the best score is kept, attempts are counted); `app.training_progress` returns the caller's
own progress, or everyone's with `training.view_all`, working out assignment where department
records can be read. A module someone has completed cannot be deleted, nor the only module of a
published course (it would read as complete); a course with modules cannot be deleted, only
archived. Assigning checks the role or department belongs to the business.

**Why.** Small businesses train new starters on the menu, customer service, policies, cash and
emergency procedures, and need to know who has done what; the kitchen does not need the till
course. Assigning by role, department or person covers how these businesses are actually split.
Marking in the database is what keeps the answers from ever reaching a browser: any design that
sent them to be checked in the page, or let a learner read the answer table, could be read off
by anyone who opened the developer tools.

**Consequences.** Content is text and video only: no uploaded images, slides or PDFs in a module
yet, and no SCORM packages. Questions have one right answer each. Editing a quiz does not reset
results already earned. There is no due date, reminder, certificate or expiry yet, and no shared
library from which the platform owner can copy a course into several businesses; each business's
training is its own. Department assignment needs the person's staff record linked to their login.

## ADR-051 — Lead management: a lead is a contact being qualified

**Decision.** Lead management for B2B and B2C (docs/leads.md) is built on the existing contact,
not on a new Lead table. A contact becomes a lead when it has a **lead status**; the status's
**kind** (new, working, pending acceptance, returned, converted, closed) drives behaviour and its
name is the business's. A lead has a **type**, B2B or B2C, and the business chooses which of the
two workflows it runs. B2B leads go from the SDR/BDR to a sales rep through a **handover** that
the rep accepts (creating or linking the account, the contact's role and an opportunity) or
returns with a reason, against a deadline in business days. B2C leads convert directly, with an
optional SDR step and an optional approval. Pipelines become several per business, and stages
gain owners, required fields, checklists and approvals. Sources gain **sub-sources**, both
required for a lead. Routing rules, statuses, reasons, custom fields, templates, sequences and
website forms are all per-business configuration; nothing about an industry is in code.

The originator (SDR) and the rep a lead is handed to are responsible for it alongside its owner:
`scopeFilter` and `assertCanAccess` take extra responsible columns, and contacts always pass the
same two (`contactScope` / `contactRecord`), so the rule is the same in every list and check.

Three things are deliberately done in the database: the duplicate search (security definer, so it
sees records outside the person's scope and reveals only the owner's name); merging and erasing
a person, which reach other features' rows and rows people cannot write (support tickets,
reviews, website submissions, audit values) and each check the permission and the business
themselves; and the SLA sweep, one set-based function whose dedupe keys make every run safe to
repeat.

Alerts run from the app (after a page is sent, at most every 15 minutes per business) and daily
from Vercel Cron. pg_cron was not used: it is not installed on the project yet, and it could
write notices but not send their emails, which needs the app's mail sender.

**Why.** Every screen, permission, report and integration in Meroidea already works on contacts;
a separate Lead object would have meant copying a person at conversion, keeping two records in
step, and deduplicating across two tables. Most of the brief is about the *state* of a person
(qualifying, waiting for a rep, converted), which a status with a kind models directly while
letting each business name its steps. Doing merge, erase and alerts in SQL keeps them complete
(every table that points at a person is covered in one place) and atomic.

**Consequences.** A "lead" in a report is a contact with a lead status; plain contacts are not
counted. Rejecting a handover clears its handover fields, so acceptance rates are read from the
timeline events, which are kept. Alerts can be up to a day late for a business nobody opens
(the daily run covers it). Not built, because each needs an outside account first: mailbox sync
(Gmail, Microsoft 365) and open tracking, automatic call logging from a phone system, enrichment
from a data provider, and WhatsApp/SMS. Email is sent from the CRM under the person's name with
replies to their own inbox; calls and enrichment are entered by hand.

## ADR-052 — The public site asks businesses to get in touch, not to sign up or pick a plan

**Context.** Businesses are onboarded by the platform owner after a conversation (ADR-029,
ADR-047), and public sign-up is closed. The home page still showed placeholder prices and "Start
free / 14-day trial" buttons that led to a closed sign-up page.

**Decision.** The pricing section is removed, and every "Start free" call to action becomes "Talk
to us", pointing at a "Let's talk" form at the end of the home page. A submission is saved in
`website_enquiries` (platform data, no tenant), emailed to every address in
`PLATFORM_ADMIN_EMAILS` with the sender as reply-to, and listed for platform owners in
`/platform/enquiries`, where each can be marked contacted or closed. The form keeps the rules of
every public intake: Zod validation, a silent honeypot, at most 3 messages per sender an hour and
40 across all senders an hour (ADR-039).

**Why.** Saving before emailing means a failed or missing email never loses an enquiry. Platform
owners already receive platform email and own onboarding, so no new setting is needed.

**Consequences.** Prices are discussed, not published. `/signup` still exists for the first
platform owner's own account (`ALLOW_PUBLIC_SIGNUP`), but nothing on the site links to it.

## ADR-053 — One email layout, in three looks, for everything Meroidea sends

**Context.** Each of the 13 kinds of email built its own one-line HTML, with three copies of an
escaping helper. They looked unfinished, and nothing said who sent them or why.

**Decision.** Every email is built by `renderEmail()` (`src/server/email-template.ts`) from plain
text blocks (paragraph, list, details, table, message, button, note). It returns HTML and a text
part from the same blocks and does all the escaping. Three looks:

- **platform**: from Meroidea itself (service agreement, features switched on, logins and
  password links, notifications, staff questions), signed "The Meroidea team";
- **business**: from a business to its customers, suppliers or staff (invoice, purchase order,
  roster, offer, helpdesk reply, hire login), in the business's name and its own colour when that
  is a plain `#rrggbb` value, signed by the business, with "Sent by … with Meroidea" below;
- **personal**: an email a person writes to a contact from the CRM, with no banner and no added
  signature, because it should read like their own email.

Every email ends with why the reader got it.

**Why.** Built for inboxes: tables and inline styles, no web fonts and no images (the mark is drawn
in HTML, so nothing is blocked and no email is "image only"), every link also written out, and a
text part that says the same as the HTML. These are the parts of deliverability the app controls.

**Consequences.** Landing in the inbox also needs the sending domain authenticated: SPF, DKIM and
DMARC for the `EMAIL_FROM` domain, verified in the email provider. A new email must use
`renderEmail()`; what an email may say is unchanged (no lead details or question content in
inboxes, rules/security.md).

## ADR-054 — Motion: one easing, quick feedback, and none for those who ask for less

**Context.** The public site already moved (scroll reveals, the hero handing its buttons to the
header), but inside the workspace clicks gave no feedback until the next page arrived, and pages
appeared without transition.

**Decision.** Motion is CSS-first and shares one easing (`--ease-out-expo`):

- a thin progress bar in the brand gradient (`NavigationProgress`, in the root layout) runs
  from a link's click until the next page is on screen;
- every page plays a short fade-and-rise entrance from a `template.tsx` in the workspace, the
  sign-in pages and the platform console (`.page-enter`, 420 ms, filled backwards only so no
  transform is left to re-anchor `position: fixed` elements);
- buttons sink slightly when pressed, and primary buttons lift on hover;
- anchor links on the public site scroll smoothly; page-to-page navigation still jumps to the top
  (`data-scroll-behavior="smooth"`, Next.js 16).

Everything above turns off under `prefers-reduced-motion: reduce`. No animation library was added.

**Why.** Feedback within a tenth of a second is what makes an app feel fast; long or decorative
motion inside a tool people use all day makes it feel slow, so the workspace stays quick and
quiet while the public site keeps its richer, scroll-driven movement.

**Consequences.** New pages get their entrance for free. A new animation should use the shared
easing and add itself to the reduced-motion block in `globals.css`.


## ADR-055 — Tax withheld is worked out with the ATO's formulas, and a person checks it

**Amends** ADR-028 (tax was entered, not calculated) and the tax note in ADR-046.

**Context.** Every pay run asked whoever runs payroll to look up each person's tax in the ATO's
tables and type it in. The new hire already answers the tax file number declaration questions
that decide the figure (ADR-026): residency, the tax-free threshold and a study loan.

**Decision.** Authorising a roster works out the tax withheld on each draft payslip with
`src/modules/payroll/payg.ts`, a copy of the ATO's Schedule 1 (NAT 1004) and Schedule 8
coefficients as made in the Taxation Administration (Withholding Schedules) Instrument 2026
(F2026L00716), for payments from 1 July 2026:

- the weekly equivalent of the period's gross, the coefficients, the rounding and the weekly to
  fortnightly conversion are the schedule's own, in integer cents;
- the scale comes from the declaration: 2 with the tax-free threshold, 1 without, 3 for a
  foreign resident; a study loan adds the Schedule 8 component (the tax-free threshold column
  for foreign residents);
- the figure stays editable until the payslips are released, and the pay run says who still
  needs tax entered by hand and why.

Tax is left at zero for a person to enter, and named on the pay run, when any of these hold: the
person has no declaration, or did not answer residency or the tax-free threshold; there is no tax
file number on record (they may have applied for one in the last 28 days, otherwise scale 4
applies); they are a contractor; the period is not a week or a fortnight; the payment date falls
outside 1 July 2026 to 30 June 2027; or whoever runs payroll lacks `employees.view_sensitive`,
which the declaration is read under. The tax file number itself is never read, only whether one
is held.

**Why.** Copying a published schedule is mechanical, and the ATO supplies sample data to prove a
copy: `tests/unit/payg.test.ts` checks every row of it (weekly, fortnightly and monthly, scales 1,
2, 3, 5 and 6) and the schedules' worked examples. A guess at a missing answer moves the figure by
hundreds of dollars, so anything the declaration does not settle stays with a person.

**Consequences.** Not applied, and left to whoever runs payroll: Medicare levy variations (scales
5 and 6 and the levy adjustment), tax offsets claimed on a withholding declaration, working
holiday makers (Schedule 15), seniors and pensioners, the extra amount for a 53rd weekly or 27th
fortnightly pay, and bonuses or back pay (Schedule 5 methods). There is no Single Touch Payroll
reporting. The coefficients must be replaced each time the ATO issues a new schedule; payments
after 30 June 2027 are refused until then, rather than taxed with old rates.

## ADR-056 — A platform owner can delete a suspended business, and the platform keeps the record

**Context.** Test and example businesses pile up in production, and the only way to remove one was
to delete rows by hand across some eighty tables, which the project rules forbid and which is easy
to get wrong. Suspending (ADR-029) hides a business but keeps everything.

**Decision.** `/platform/[id]` gets "Delete this business", served by `deleteBusiness` in
`src/modules/platform/service.ts`:

- only a **suspended** business can be deleted, and the platform owner types its **name exactly**;
- every table with a `tenant_id` is emptied for that business, then the `tenants` row, all in **one
  transaction**. The order comes from the database's own foreign keys at the time of deletion
  (`src/modules/platform/delete-order.ts`), so a table added later is neither missed nor deleted
  out of order, and a cycle refuses before anything is removed;
- a row in the new **`platform_audit_logs`** table records who deleted which business and how many
  rows went, in the same transaction, because the business's own `audit_logs` go with it;
- after the commit, its files under `{tenant_id}/` in the `documents` bucket are removed, and the
  logins of its people are removed **only** when they belong to no other business and are not a
  platform owner.

**Why.** Deleting is for businesses that were never real; for a real client, suspension remains
the tool, which is why deletion requires it first. Reading the order from the catalogue keeps the
feature correct as the schema grows, where a hand-kept table list (as in the test helpers) would
silently fall behind.

**Consequences.** Deletion cannot be undone; backups are the only way back. A file whose removal
fails is left orphaned in the private bucket, unreachable by anyone, and is reported in the count.
Migration 0065 must be applied to production before this ships.

## ADR-057 — Businesses pay the platform owner directly; access is switched by hand

**Supersedes:** ADR-024 (Stripe self-serve subscription) and the self-serve billing in
`onboarding.md` §7, for now.

**Context.** Businesses are onboarded after a conversation and prices are discussed, not published
(ADR-029, ADR-047, ADR-052). Milestone 13 still described Stripe Checkout, a customer portal,
trials and dunning, which assumed a business subscribes, adds seats and cancels on its own.

**Decision.** A business pays the platform owner directly, by bank transfer, on terms agreed in
person. Meroidea takes no payment and issues no invoice for it. The platform owner gives and
withdraws access by hand with the controls the console already has: onboarding opens the business
once its admin accepts the service agreement, **Suspend** closes it to its people while keeping
every record, and **Reactivate** opens it again. Both are written to the business's audit log.
Nothing is built for billing now; `tenant_subscriptions` stays as it is, unused.

**Why.** With a handful of clients met in person, a bank transfer and a switch are all that is
needed, and anything more would be built before anyone has asked for it. ADR-019 already keeps
invoicing in an accounting system.

**Consequences.** Nothing is charged or chased automatically: the platform owner notices a missed
payment and suspends by hand. A business opens as soon as its admin accepts the agreement, so
onboard once the first payment has arrived, or suspend straight after onboarding. Taking payment
by Stripe later is still open: it would add a record of each business's plan and payment status,
and could drive the same suspend and reactivate steps automatically. That would be a new decision
when it is wanted.

## ADR-058 — Opportunity items: access, gates and the parent move

**Builds on** ADR-018 (opportunity items with their own stage track).

**Decision.**
- Items live in the opportunities module (`item-service.ts`, `item-queries.ts`), because an item
  has no life outside its opportunity. They have no permissions of their own: viewing needs
  `opportunities.view`, adding, changing and moving need `opportunities.edit`, and removing needs
  `opportunities.delete`, each on the parent and within its record scope. Every write locks the
  parent first, as an opportunity write does.
- Item pipelines are ordinary pipelines with `object_type = 'opportunity_item'`, edited on the same
  Settings screen. An opportunity pipeline names the item pipeline its items use, or follows the
  default one; the first item pipeline a business adds becomes the default.
- Item stages have no owners, required fields, checklists or approvals. Their one rule is
  `advances_parent_to_stage_id`: entering the stage moves the opportunity forward to an open or won
  stage, never back and never to a lost one. That move goes through the opportunity stage's own
  gates. When a gate is not met the item still moves, the opportunity stays, and the person is told
  why; a stage that needs approval becomes an approval request.
- An opportunity that has items is won only once one of its items is won.
- Expected revenue is what was entered, or base × rate ÷ 100, worked out in integer cents.

**Why.** Following the parent keeps one place where access is decided, and an application cannot
be seen by someone who cannot see the student's case. Letting an item bypass the opportunity's
gates would let a clerk skip a required field or a manager's approval by moving an application;
refusing the item's move instead would block the record of what happened at the institution.

**Consequences.** Ops staff who process an item need edit access to the opportunity. The
"Submitted" stage moving a case works only for opportunities in the pipeline that stage belongs
to; an item pipeline shared by two opportunity pipelines can move only one of them per stage.
Not built yet: a board of items, reordering items, a products catalogue for `product_id`, item
documents (milestone 10), commissions from received revenue (ADR-019), offer-rate reports, and
offering to withdraw open items when an opportunity is lost.

## ADR-059 — Security review, first pass: verified emails, settings under RLS, security headers

**Context.** Milestone 14 starts with a review of how requests reach data: every Server Action,
every use of the privileged connection, row-level security and grants on every table, the
`security definer` functions, the route handlers, the response headers, and the production
project's Data API.

**Findings and decisions.**
1. *Profile email trusted as identity (fixed).* `authenticated` could update every column of its
   own `users` row, including `email`, and two paths trusted that column: an admin's "send password
   link" generated a recovery link for whichever login owned the address, and a hire whose email
   already had a login was linked to a member of the business with that profile email. A member
   who rewrote their profile email could therefore have an admin hand them a sign-in link to
   someone else's account (when email is not configured and the link is shown to the admin), or
   receive a new hire's staff record and payslips. Migration `0067` limits the update grant to
   `full_name`, `phone`, `avatar_path` and `updated_at`; the password link and the hire link read
   the verified email from Supabase Auth. Tests reproduce both paths and fail without the fix.
2. *Workspace settings written with the privileged connection (fixed).* `settings/workspace.ts`
   checked `settings.manage` in the application and then wrote `tenants` through `adminDb`, against
   rule 1 of the project rules. A request holding a context from before its admin was switched
   off could still write. The settings columns are now granted to `authenticated` behind a
   `tenant_settings` policy requiring `settings.manage` in the active business, and the writes go
   through `withRls`.
3. *No security headers (fixed).* The site sent only HSTS. It now sends `X-Frame-Options: DENY`
   and `frame-ancestors 'none'` (website forms at `/f/*` excepted, since businesses embed them),
   `nosniff`, a referrer policy (`no-referrer` on pages whose address is a one-time secret), a
   permissions policy allowing only same-origin location (for clocking in), and the CSP directives
   that need no nonces (`base-uri`, `form-action`, `object-src`).
4. *Production exposes the `public` schema on the Data API (owner action).* ADR-007 says it should
   not; the hosted project does. Nothing leaks: `anon` has no grants, and every business table's
   policy needs `app.active_tenant_id()`, which only the server sets. But it is the route finding 1
   used, and it widens what a session token can try. Remove `public` from the exposed schemas in
   the Supabase dashboard (Project settings → Data API).
5. *Checked and sound.* Every Server Action outside public links, sign-in and the platform console
   is built with `authedAction`; the platform's go through `assertPlatformAdmin`, which trusts the
   verified auth user. Every `adminDb` use is one of the documented exceptions (provisioning,
   cron, platform console, one-time public links, the editor callback). Every public table has RLS;
   `anon` has no privileges; every `security definer` function callable by a session checks the
   active tenant, membership and permission.

**Not done in this pass.** A full script `Content-Security-Policy` with nonces (it must allow the
editing service and the training video hosts); revoking PUBLIC execute on `app` helper functions
(no route reaches them without a session, and revoking risks the triggers); a review of each
public route handler's input limits beyond what ADR-039 already tests; dependency audit; backup
restore drill; Playwright journeys; the audit log viewer.


## ADR-060 — Bookkeeping: a double-entry ledger under invoices and payroll (supersedes part of ADR-019)

**Context.** Investors asked for a bookkeeping module ("Bookkeeping Module – Requirements for
Developer"): a chart of accounts, automatic posting from receivables, payables and payroll, money
in and out, bank reconciliation, GST and the core reports, resold to other businesses and
countries. ADR-019 had kept accounting in the customer's accounting system, and the roadmap listed
"replacing the customer's accounting ledger" as a non-goal. The business owner chose to build the
ledger, starting with its core, for Australia first.

**Decision.**
1. *A real double-entry ledger, never a simplified income/expense register.* `ledger_entries` and
   `ledger_lines` hold every movement as debits and credits in `numeric(14,2)` with the business's
   currency. People see plain words ("Money in", "Money out"); an accountant view shows the debits,
   credits and codes. Changing this later would have meant re-deriving every business's history.
2. *Only the database writes the ledger.* Signed-in users hold `select` on the two ledger tables
   and nothing else. Every entry goes through an `app.ledger_*` function, which checks the
   permission for that kind of entry, the lock date, that every account and tax code belongs to
   the business, and that amounts are whole cents. A deferred constraint trigger refuses, at
   commit, any entry whose debits and credits differ or that has fewer than two lines.
3. *Entries are never edited.* A trigger refuses every update except linking the reversal.
   Voiding posts a reversing entry: on the original date while it is open, otherwise the first
   open day after the lock date. Both stay on record. Deleting is left to the platform owner's
   removal of a whole test business (ADR-056).
4. *Documents post themselves, in their own transaction.* Marking an invoice sent posts
   receivables, income and GST; paid posts the bank and clears receivables; voiding reverses the
   issue. Releasing a payslip posts wages and super as expenses and what is owed for net pay, PAYG
   withheld and super. Each entry keeps its source and event, unique per document and event, so
   re-sending or re-running never posts twice, and every document shows the entries it made.
   Entries from a document change only through that document. Nothing posts while the books are
   switched off or not set up; setting up (and "bring in missing") posts documents dated from the
   start date.
5. *Pay is private inside the books.* Entries from payroll carry `payroll = true` and are hidden by
   RLS from anyone without `books.view_payroll`. Whole entries are hidden, so every report still
   balances, and says what it leaves out.
6. *Reports compute the year end.* Income and expenses count from the start of the financial year;
   earlier years' profit is added to retained earnings and this year's appears as "Current year
   earnings", so the Balance Sheet balances without anyone posting a closing entry.
7. *Country packs.* The chart and tax codes come from a pack (`src/modules/books/packs.ts`);
   Australia is first (GST 10%, July–June year, PAYG and super accounts). A business renames,
   adds and archives its own. Accounts and tax codes that posting relies on carry a `system_key`
   and cannot be archived or re-purposed; an account with transactions keeps its type.
8. *A feature of its own (`books`)*, switched on per business like the others (ADR-029, ADR-038),
   with six permissions: `books.view`, `books.view_payroll`, `books.record`, `books.journal`,
   `books.export`, `books.manage`. Role templates Bookkeeper, Accountant or tax agent, and Books
   viewer match the requirements' roles.

**Not in this milestone** (next, in this order): supplier bills (accounts payable does not exist
yet) and supplier credit notes; customer payments as records (part payments, several invoices per
payment) and credit notes; bank statement import (CSV/OFX) with suggested matches,
reconciliation, bank rules and duplicate detection; the GST/BAS report with drill-down and tax
payments; aged receivables and payables; cash-basis reports; tracking categories; recurring
transactions; attachments on entries; comments for accountants; PDF/Excel exports and the
accountant export pack; monthly columns on the Profit and Loss; merging accounts; payroll
remittances of PAYG and super.

**Consequences.** The ledger is the source of the financial reports, so a wrong posting rule is a
wrong report: the chart, tax codes and posting rules need review by a qualified Australian
accountant before businesses rely on them, as the requirements themselves ask. Invoices still
carry one tax rate per invoice, so invoice income posts to one income account (chosen in the
books settings). Businesses with the feature off are unaffected: the posting functions return
before touching anything.

## ADR-061 — Invoice payments and credit notes are records of their own

**Context.** An invoice was either unpaid or paid ("Mark as paid"). The bookkeeping requirements
need part payments, one payment settling several invoices, and credit notes, each posting to the
books (ADR-060).

**Decision.**
1. `invoice_payments` holds money received (date, amount, payer, reference, and the bank account in
   the books when they are on); `invoice_payment_allocations` splits it across invoices. A credit
   note (`invoice_credit_notes`, CN-0001…) is against one invoice, entered including tax, with the
   tax worked out at the invoice's own rate.
2. What is owed is `app.invoice_balance`: the total less live payments and live credit notes. An
   invoice is `paid` exactly when that reaches zero, and returns to `sent` if a payment or credit
   is voided. "Mark as paid" now records a payment of the whole balance.
3. The database keeps the money honest whoever writes: deferred constraint triggers refuse, at
   commit, any payment or credit on a draft or void invoice, any invoice paid or credited beyond
   its total, and any payment not split exactly across its invoices. Payments and credit notes are
   never edited or deleted: `authenticated` may update only `voided_at`/`voided_by`, once.
4. Each payment and credit note posts its own entry (receivables against the bank; income and GST
   against receivables) and a reversal when voided. An invoice's "Ledger entries" lists them all.
   An invoice cannot be voided while a live payment or credit note is on it.
5. Migration `0069` gives every invoice already marked paid the payment it stood for, dated the day
   it was marked in the business's timezone, so balances are unchanged.

**Not covered.** Refunds of money already received, and credit left over after an invoice is
settled (a credit cannot exceed what is owed); overpayments.

## ADR-062 — Supplier bills live in the books

**Context.** The bookkeeping requirements post "bill entered", "bill paid" and "supplier credit
note" from an accounts payable module. Meroidea had none: purchase orders carry no tax and are not
bills, and expense claims are staff reimbursements.

**Decision.**
1. Bills are part of the `books` feature (`ledger_bills`, `ledger_bill_lines`), entered like money
   out: lines across accounts and tax codes, typed including or excluding GST, worked out on exact
   cents per line. `books.view` reads them; `books.record` enters, pays, credits and voids them. No
   new permission family: a bookkeeper's day already covers this.
2. Payments (`ledger_bill_payments` + allocations) settle one or several bills, in part or in
   full, from a bank, cash or card account. A supplier credit (`ledger_bill_credits`) is against one
   bill, up to what it still owes, with its own account and tax code.
3. The database keeps it honest, as for invoices (ADR-061): a bill's totals equal the sum of its
   lines; nothing is paid or credited on a void bill or beyond what it owes; a payment is split
   exactly; nothing is edited or deleted, only voided once, and a bill with a live payment or credit
   cannot be voided.
4. Posting: a bill debits each line's account and the GST paid, and credits accounts payable; a
   payment moves payables against the bank; a credit reverses expense and GST. Voids post
   reversals. A bill dated before the books' start date is what was already owed then: it posts
   against Opening balances on the start date, not as an expense of a period these books do not
   cover. This is how a business brings in the bills it owed when it starts.
5. A bill that looks already entered (same supplier and reference, or same supplier, date and
   total when either has no reference) is refused as a duplicate until the person confirms. The
   supplier's last account and tax code fill in the next bill from them.

**Not covered yet.** Attachments (the bill's PDF or photo), recurring bills, a supplier record of
its own with payment terms and a default account (suppliers in purchasing are linked by name only),
aged payables (milestone 5).

## ADR-063 — The audit log viewer, and the log readable only with audit.view

**Context.** Milestone 14 lists an audit log viewer, and `audit.view` ("Audit log viewer and
export") was in the catalogue with nothing behind it. The log holds more than "who did what": the
values before and after an edit (a contact's phone and address), figures behind a contract, the
address and browser of whoever acted. Yet its policy since migration `0001` let every active member
read every entry in their business. No screen asked, so nothing leaked, but a viewer turns "read
the whole log" into a real code path, and the next query to touch the table would have inherited
the open policy.

**Decision.**
1. `/audit` (Admin menu, `audit.view`): entries newest first with who, what, which record, the
   changed values and the request details; filters by day range in the business's timezone,
   person, action, record type and one record ("History of this record"); keyset pages of 50 over
   `(created_at, id)` carried at microsecond precision, since a millisecond cursor skips entries
   written together. Ids and dates only in the URL: no free-text search, because what people
   search an audit log for is names and email addresses (rules/security.md).
2. Export to CSV under the same filters, up to 10,000 entries, needs `audit.view` and is itself an
   audit entry recording the filters and row count.
3. Migration `0071` replaces the select policy with `audit_read`, which needs `audit.view` in the
   active business. Inserting is unchanged (`audit_append`). Only the Admin role holds
   `audit.view` by default; a custom role can be given it.
4. Two features read the log without being the log viewer, and get exactly what they need through
   `security definer` functions instead of the rows:
   - a record's timeline ("Changed phone, city") — `app.record_field_changes(type, id, limit)`
     returns who, when and the field names, never values, for contacts and opportunities, to a
     member holding that record's view permission. The caller still checks the record's scope
     first, as before;
   - erasing a person on request also erases records merged into them, found from the merge
     entries — `app.contacts_merged_into(contact)` returns record ids to `contacts.anonymize`. A
     person allowed to erase but not to read the log must still find every merged copy, or the
     person's details would survive in it without anyone noticing.
5. `app.audit_actor_names(ids)` names the people behind entries, including those who have left:
   the `users` policies show former members only to `users.manage`, and an audit is often read
   about someone who has gone. Names only, of people who are or were members of the active
   business, to `audit.view`.

**Consequences.** Granting `audit.view` grants every value the log recorded, across all records
and payroll, whatever the person's other permissions; give it only to someone trusted with all of
it. Sensitive values are masked when written (`diffChanges`) and stay masked here. Not built: a
retention period and archiving, monthly partitioning (docs/database.md), and platform owners'
own log (`platform_audit_logs`, ADR-056) in the console.

## ADR-064 — Social inbox: Facebook, Instagram and TikTok direct messages in one place

**Context.** Businesses asked to connect their social media accounts and see customers' direct
messages inside Meroidea instead of three apps. What each platform allows (checked against their
documentation in November 2026):
- *Meta.* One Meta app serves Facebook Pages (Messenger) and Instagram professional accounts.
  Meta recommends "Instagram API with Unified Login" for new integrations: the business logs in
  with Facebook or Instagram through Facebook Login for Business with a configuration, no Facebook
  Page is needed for Instagram, and the app receives a Business Integration System User token
  that belongs to the business's portfolio and by default does not expire. Serving businesses that
  have no role on the app needs Advanced Access (App Review) and a verified business. Webhooks are
  signed with `X-Hub-Signature-256`. Replies: within 24 hours of the customer's last message, or
  up to 7 days with the Human Agent tag (which needs its own approval). Message content is
  available only for the 20 most recent messages of a conversation.
- *TikTok.* The Business Messaging API is in open beta for developers who pass TikTok's data
  security and privacy review (US accounts need an extra US review; accounts registered in the
  EEA, Switzerland or the UK cannot be served). Accounts must be Verified Business Accounts (or
  have Advanced Access), owned by someone over 18, and set to accept messages from everyone.
  Access tokens last a day, refresh tokens a year. Replies: up to 10 within 48 hours of the
  customer's message. Only the last 90 days of conversations and 20 most recent messages are
  readable. The webhook documentation names no signature this app can verify.

**Decision.**
1. A feature `social` with `social.view`, `social.reply` and `social.manage`. New businesses'
   Admin gets all three and Manager the first two; existing businesses' Admin gets all three
   (migration `0072`). Pages: `/social` (inbox), `/social/[id]` (thread, reply, link to contact,
   done), `/social/accounts` (connect, disconnect, status).
2. Connecting: a server action sets a ten-minute, http-only state cookie holding a hash of the
   `state` bound to the person and business, then sends the browser to Meta or TikTok. The
   callback `/api/social/oauth/[provider]` runs as the signed-in person, checks the state, swaps
   the code for tokens on the server and saves every account shared: Pages with their Page token,
   Instagram accounts with the system user token, TikTok with its token pair. Each is subscribed
   to our webhook and its recent conversations imported (not counted as unread).
3. Tokens are sealed with `encryptField` and kept in `social_account_credentials`, which sessions
   cannot read at all; `app.social_*` functions check the permission. They move with the payroll
   numbers on a key rotation. They travel to providers only in headers or bodies, never in URLs.
4. One live business per account (a partial unique index), so an incoming message has exactly
   one destination; a business trying to connect an account that is live elsewhere is told only
   that it was skipped.
5. Webhooks: Meta events are stored only after the signature over the raw bytes checks out, and
   idempotently on Meta's message id. A TikTok notification is never stored as it stands: it
   only says which conversation to read again through TikTok's API with the account's own token
   (renewed first if expired), so a forged one costs one read and plants nothing.
6. Replies are checked against each platform's window before sending, stored as `sending`, then
   `sent` or `failed` with the provider's reason. An echo of our own reply that arrives before the
   provider's answer claims the pending row instead of adding a copy. A token the provider rejects
   marks the account `needs_reconnect`.
7. Disconnecting unsubscribes, forgets the tokens and keeps the conversations as the business's
   record; connecting the same account again continues them.

**Consequences.** Nothing works for client businesses until the platform owner has a Meta app
through App Review with a verified business, and a TikTok developer app through TikTok's review
(docs/social-inbox.md). Not built: images and files in replies, conversations on a contact's
timeline, assigning conversations, notifications for new messages, comments and mentions,
WhatsApp, a data deletion callback for Meta (instructions page instead), and reading TikTok
messages from EEA, Swiss or UK users, which TikTok does not allow.

## ADR-065 — Social inbox, part two: real time, saved media, receipts and rate limits

**Context.** The owner asked for a true instant-messaging experience instead of the 20-second
refresh of ADR-064, for customers' photos and files to survive the platforms' expiring links,
and for delivery and read status, rate-limit handling and a two-pane inbox. Facts that shaped it
(Supabase, Meta and TikTok documentation, November 2026): `realtime.send` inserts a broadcast
into `realtime.messages`, catches its own errors, and is executable only by `postgres`; private
channels are authorised by RLS on `realtime.messages`, evaluated when a browser joins and cached
for the connection. Meta's attachment and profile picture links expire ("in a few days" for
Instagram). Meta throttles with codes 4, 17, 32, 613 and 80000–80014 and reports the wait in
`X-Business-Use-Case-Usage`. TikTok's return code 40100 means throttled, 40105 an invalid token
(ADR-064's client wrongly treated 40100–40105 alike, so throttling would have asked businesses
to reconnect: fixed). TikTok's media are fetched by media id through
`/business/message/media/download/` (a 24-hour link).

**Decision.**
1. *Supabase Realtime is added to the stack* (owner's approval, 18 November 2026), for this use:
   database triggers on `social_conversations` and `social_messages` call `realtime.send` on
   the private channel `social:<tenant id>` with **only the conversation id**; the browser then
   reloads through the ordinary RLS-checked server components. The channel never carries what
   anyone wrote, so a mistake in channel authorisation cannot leak a message. The policy
   `social_inbox_receive` lets a browser join only with `social.view` in that business, while the
   feature is on and the business open (`app.social_channel_allowed`). The triggers are `security
   definer`, skip quietly where Realtime is not installed and can never stop a message being
   stored. Without a live channel the page refreshes every 30 seconds. CI now starts Realtime.
2. *Media are copied into the private `social-media` bucket* (25 MB cap, no storage policies)
   at `{tenant}/social/{conversation}/{message}/...` and avatars at `{tenant}/social/avatars/...`,
   after the webhook has been answered (`after()`), or after an import. The download address
   comes from a payload, so it is fetched only over https from the platforms' media hosts, with
   redirects followed by hand and checked at every hop, a size cap, and the leading bytes matched
   to an accepted type (images, mp4/mov, common audio, pdf). A refused file is marked `skipped`, a
   failure `failed` with its link kept. Files are served by `/api/social/media/...` and
   `/api/social/avatar/...`, which check `social.view` under RLS on every request and redirect to
   a one-minute signed link. Viewing a message's media is not audited, as reading its text is not.
3. *Erasure and deletion reach the media:* erasing a person blanks their inbound messages, name,
   handle and picture in linked conversations and removes the files; deleting a business empties
   its folder in both buckets.
4. *Receipts:* Messenger deliveries and reads, Instagram's `messaging_seen` and TikTok's
   `im_mark_read_msg` move replies `sent → delivered → read`, never back. TikTok's read receipt
   cannot be confirmed through the API, so it is applied only from a signed notification.
5. *TikTok signatures:* `TikTok-Signature: t=…,s=…` (HMAC-SHA256 of `t.body` with the app
   secret, five minutes) is checked. The scheme is the one TikTok documents for its webhooks but
   could not be confirmed on the Business Messaging pages, so a notification that fails it is
   only ever treated as unsigned, never rejected: messages are still read through the API, and
   unsigned reads are limited to six per conversation a minute.
6. *Rate limits* become `RATE_LIMITED` with the wait when known; the reply is kept as failed and
   **Retry** sends the same message again after re-running every check. A throttled account is
   not marked for reconnecting.
7. *UI:* two panes from the `lg` breakpoint (list left, thread right), one pane on phones; each
   message line names its platform; replies appear at once (`useOptimistic`) and then show sent,
   delivered, read or failed.

**Consequences.** Hosted Realtime must have "Allow public access" switched off so only private
channels exist (docs/social-inbox.md). Media storage grows with use and is paid by the platform.
Revoking a person's access stops their Realtime signals only when their session token renews
(Supabase caches channel authorisation per connection); the signals carry ids alone.

## ADR-066 — WhatsApp in the social inbox, and a Marketing section

**Context.** The owner asked for a Marketing module whose first part is one place to read and
answer customers on every platform, naming WhatsApp beside Facebook, Instagram and TikTok
(ADR-064). Facts that shaped it (Meta's WhatsApp Business Platform documentation, read 20
November 2026):
- A platform that onboards other businesses is a *Tech Provider*. It needs business
  verification and App Review for `whatsapp_business_messaging` and
  `whatsapp_business_management`; the review asks for a video of a message sent from the app and
  of a template *created in the app*. Until then at most 10 new WhatsApp accounts a week.
- Businesses connect through *Embedded Signup*, which "relies on the JavaScript SDK"; a redirect
  flow is not documented. v2 and v3 were retired on 15 October 2026.
- The code it returns lives five minutes and is exchanged for a Business Integration System User
  token (no expiry by default). A new number is registered with a six-digit two-step PIN.
- *Coexistence* (a number that stays in the WhatsApp Business app) is supported in Australia
  since October 2025. Messages sent from the phone arrive as `smb_message_echoes`, and history
  (180 days, media ids for only 14) and contacts can each be asked for once, the history within
  24 hours. Such a number is fixed at 20 messages a second.
- Free-form messages only within 24 hours of the customer's last message; after that only an
  approved template.
- Since 1 October 2026 Meta again charges for replies inside the window beyond 1,000 a month per
  number. Without a payment method on the business's own WhatsApp account, those beyond the free
  1,000 are not delivered. The business pays Meta directly, not through the platform.
- Media are fetched by id and the download needs the token; webhook media ids last 7 days.
  Webhooks are signed like every Meta webhook and may carry up to 3 MB.

**Decision.**
1. *WhatsApp is a fourth platform of the `social` feature*, on the same Meta app, permissions and
   tables. A business phone number is a `social_accounts` row (`external_id` = phone number id,
   `provider_business_id` = WhatsApp Business Account). Conversations keep the customer's number
   (`participant_phone`); the number is also their id, or their business-scoped user id when
   they hide it.
2. *Meta's SDK is loaded on one page only, on purpose* (owner's approval, 20 November 2026).
   - It loads on Connected accounts, and only after an admin clicks **Connect WhatsApp**. The
     second click opens Meta's window, because a popup must come straight from a click.
   - Embedded Signup hands the page the code plus the account and number ids. A Server Action
     (`social.manage`) exchanges the code on the server.
   - The ids come from the browser, so they are trusted only once the business's own new token
     finds that number in that account. The state cookie of ADR-064 is not needed: no redirect
     carries the code.
3. *Two ways to connect*, chosen by the business:
   - *A new number:* registered for the Cloud API with a random PIN. The PIN is sealed in the
     credentials row's second secret, rotated and cleared like a token, and never shown.
   - *The number on its WhatsApp Business app:* the app stays in use. Contacts and history are
     asked for at once.
     - History is stored without counting as unread or opening the 24 hours, since the window
       belongs to Cloud API messages.
     - A media placeholder is filled when its file arrives.
     - Messages sent from the phone appear in the thread, and so do their edits and deletions.
     - The app's contact names name existing conversations.
4. *Templates* (`social_message_templates`):
   - They belong to the business, behind the feature switch. Anyone with `social.view` can read
     them; only `social.manage` can write them (RLS).
   - They are kept per number, each number of an account holding the account's templates, and
     kept current by **Refresh** and by Meta's `message_template_status_update` webhook.
   - Meroidea creates (text heading, body with numbered placeholders and examples, footer), lists
     and deletes them.
   - It sends a template's *body values only*, so templates with a media header, a button value
     or a code are listed as "send from WhatsApp Manager".
   - After 24 hours the reply box becomes a template picker with a preview. Retry resends the
     same template.
5. *Delivery states:*
   - `sent → delivered → read` from WhatsApp's statuses, never back.
   - A later `failed` explains itself in words: a closed window, billing, the customer's block.
     WhatsApp's 130429 and 131056 are rate limits.
6. *Media* are fetched by id, and the token goes only to Meta's file hosts (`fbsbx.com`,
   `facebook.com`, `whatsapp.net`), checked again at every redirect. A redirect elsewhere gets no
   token. Word, Excel and PowerPoint files are now kept, recognised by declared type and zip
   bytes.
7. *Erasure* also clears the customer's number. On WhatsApp it replaces their id in the
   conversation, so a later message starts a new conversation with no link to the erased one.
8. *Marketing* becomes a section of the menu, holding the Social inbox and WhatsApp templates.
   The `social` permissions are listed under it in the role editor. The sidebar now highlights
   the most specific item.

**Consequences.**
- The platform owner must become a Tech Provider: business verification, then App Review with the
  two videos. That is the long pole, as for ADR-064.
- Each business adds its own payment method in Meta Business Suite; the accounts page says so.
- The 24-hour rule and Meta's charges are visible in the reply box and on the templates page.
- Not yet: images or files in replies, media headers and button values in templates, reactions,
  WhatsApp calls, and marking customers' messages as read in WhatsApp (blue ticks).
- The SMS channel the owner also asked for is a separate decision: provider, who holds the
  account, Australia's sender ID rules.

## ADR-067 — Social inbox, part four: assignment, snooze, search, three panes, files in replies, read receipts

**Context.** The owner reviewed the unified inbox against a full omnichannel spec. Most of it was
already built and live (ADR-064 to ADR-066). The owner chose four gaps to close: assigning,
snoozing and search; a three-pane inbox with a live reply-window countdown and its own error
code; photos and files in replies; and read receipts.

The owner also confirmed what stays as it is:
- the existing tables are extended, not rebuilt under new names;
- no raw webhook payloads are kept (data minimisation, `docs/database.md`);
- webhook secrets stay with the platform owner and are never shown to businesses.

Facts used (developer documentation read 21 November 2026):
- **Messenger** sends attachments by URL (`message.attachment {type, payload.url}`). The same
  24-hour window and HUMAN_AGENT tag apply. `sender_action: mark_seen` tells the customer their
  message was seen.
- **Instagram** sends images (PNG/JPEG, 8 MB), video, audio and PDF files by URL. Its
  documentation shows no mark_seen for businesses.
- **WhatsApp** prefers media uploaded with `POST /{phone-number-id}/media` and sent by id.
  Limits: images 5 MB, video and audio 16 MB, documents 100 MB. Captions are allowed on images,
  video and documents. `status: read` marks the chat read.
- **TikTok's** own pages render only in a browser. Two third-party implementations say an IMAGE
  is uploaded with `/business/message/media/upload/` (multipart `business_id`, `media_type`,
  `file`; JPG/PNG, 3 MB) and then sent with `message_type: IMAGE`. They also say an image cannot
  carry text. No TikTok webhook challenge or business read receipt was found documented.

**Decision.**
1. *Assignment:*
   - `social_conversations.assigned_user_id` references the business's memberships (composite
     foreign key).
   - Anyone who can reply may give a conversation to a colleague who can read the inbox, or back
     to the whole team. The colleague gets an in-app notice that never contains what was said.
   - Assignment changes are audited. There is a **Mine** view.
2. *Snooze:*
   - A snoozed conversation has status `snoozed` with `snoozed_until` (a check keeps the two
     together). It leaves the Open view and is back on its own when the time passes: the query
     treats an expired snooze as open, so no scheduled job is needed.
   - A customer writing again reopens it at once. Marking it done or open clears the snooze.
   - The quick choices are worked out in the business's timezone; a custom time is limited to
     90 days.
3. *Search* covers the customer's name, handle and number, and what was said. It uses
   case-insensitive matching on trigram indexes, and a `%` or `_` typed in is searched for
   literally.
4. *Three panes:*
   - From 1536 px the conversation page shows the list, the thread and a details pane (customer,
     linked contact, assignment, status, snooze). Below that width, the details open as a sheet.
   - The reply window counts down live, including the 7 days for a reply from a person on
     Messenger and Instagram. When it closes, the page reloads and shows the right reply box.
   - A closed window is refused with the new error code `WINDOW_EXPIRED` instead of `CONFLICT`.
5. *Files in replies:*
   - The browser asks for a one-time upload ticket for a path the server chose, under
     `{tenant}/social/{conversation}/outbound/`, and uploads straight to the private
     `social-media` bucket.
   - Before sending, the server checks three things: the path belongs to this conversation, the
     leading bytes match an accepted type, and the platform takes that type and size. A refused
     file is deleted.
   - Per platform:
     - WhatsApp uploads the file to WhatsApp, then sends it by id, with the caption.
     - Messenger and Instagram send a ten-minute signed link to the object.
     - TikTok uploads an image and sends it by media id.
   - Words go with a file only on WhatsApp. Elsewhere the composer sends them as a second reply.
     Retry sends the same file again.
6. *Read receipts:*
   - When someone who can reply opens a conversation with new messages, Meroidea tells WhatsApp
     (read) and Messenger (mark_seen, within its window). This is best effort and runs after the
     page has its answer.
   - Instagram and TikTok document no such call, so nothing is sent there.
7. *Settings → Channels* lists each connected account and its health, and links to Connected
   accounts and WhatsApp templates. It shows no webhook address, verify token or secret.

**Consequences.**
- An upload that is never sent stays in the bucket until the business is deleted. This is small,
  private, and only possible for people who can reply.
- TikTok's image fields come from third-party code. They are to be confirmed with TikTok's
  review, as for ADR-065's signature scheme.
- A colleague's notice of an assignment is in the app only, not by email.


## ADR-068 — Inbox foundations: private notes, saved replies, presence, finding the sender's contact

**Context.** The owner asked for a shared omnichannel inbox across the social channels, WhatsApp,
email and live chat, plus tickets with SLA timers, a public knowledge base and links to projects.
The owner approved a phased plan on 21 November 2026. It holds these decisions:
- the `social_*` tables are kept and extended (ADR-067);
- email comes in through Resend, with no IMAP or SMTP;
- WhatsApp stays on the Cloud API, with no Twilio;
- knowledge-base custom domains wait;
- Realtime Presence is approved for collision detection;
- the live-chat visitor side will poll;
- `react-markdown` is approved for the knowledge base.

This record covers phase 1: what every channel added later builds on.

**Decision.**
1. *Private notes* are `social_messages` rows with `direction = 'note'`, written by
   `src/modules/social/team-service.ts` (`addNote`, `social.reply`).
   - A check keeps a note free of provider fields (no external id, no attachments, status
     `sent`). A restrictive insert policy makes a session write a note only in its own name, and
     the body is not in the update grants, so a note never changes.
   - A note never moves the conversation's last message, preview or reply window, and is allowed
     whatever the platform's window says.
   - The audit log records that a note was made, never its words. Notes are kept when a contact
     is erased, as staff notes on tickets are (0062).
   - Every customer-facing path added later (email, live chat) must leave `note` rows out. Their
     tests must prove it.
2. *Saved replies* (`social_canned_responses`):
   - A person keeps their own with `social.reply`; the team's shared ones need the new
     `social.canned_manage` (Admin, and Managers who can already reply). RLS enforces the same
     split.
   - `/` in the reply box finds a saved reply by shortcut or title.
   - `{{contact.first_name}}`, `{{contact.name}}` and `{{agent.name}}` are filled in on the
     server when the page is built. An unknown placeholder is left as typed so the mistake shows.
3. *Presence:*
   - Realtime Presence runs on its own private channel `social-presence:<tenant>`, joined
     through `app.social_presence_allowed` (`social.view`, business open).
   - A tab announces only `{conversationId, typing}` under its user id. The thread shows
     "Sam is typing…" and "Alex is also looking at this".
   - It is a hint, never a lock. A member could claim a false typing state about themselves;
     nothing more, since the payload carries no content.
4. *Finding the sender's contact* (`src/modules/leads/channel-intake.ts`):
   - It runs from a verified webhook only, when the customer writes. WhatsApp senders are looked
     up by number now, and email senders will be looked up by address.
   - Exactly one match is linked (`contact_match = 'auto'`). Several matches link nobody and are
     offered to staff (`suggested`), so a shared family number never merges two histories.
   - A link a person made or removed is never touched again (`manual`).
   - Each account can opt in to making a new lead for unknown senders (`created`). The lead is
     routed like a website enquiry, in the "new" lead status, with the account's lead source.
   - This is off by default, because social accounts draw spam. The setting is written only by
     `app.social_set_account_settings` (`social.manage`), because the account update policy also
     admits `social.reply`.
   - The new lead's intake event and timeline entry name the conversation, never its words.
   - Imports and WhatsApp history are not matched. Without the `crm` feature nothing is matched
     or created.
5. *Timeline:* a contact's conversations appear on their timeline (channel, account, message
   count, link) for people with `social.view`. They are read where they live, never copied into
   `activities`.

**Consequences.**
- Phase 2 (tickets and SLA) can turn any conversation into a ticket.
- Email and live chat (phases 3 and 5) arrive as two more `platform` values. They reuse matching,
  notes, saved replies and presence as they are.
- Meta and TikTok senders carry no phone or email, so for them only the opt-in lead creation
  applies.
- Saved replies are not soft-deleted: they are tools, not business records.


## ADR-069 — Tickets with response targets: SLA policies, business hours, and links to the CRM and inbox

**Context.** Phase 2 of the plan the owner approved on 21 November 2026 (ADR-068). The owner's
decisions:
- SLA policies are per business and per priority: Low, Medium, High, Urgent. The stored values
  stay `low | normal | high | urgent`, and `normal` is shown as Medium.
- Each policy has a first-response target and a resolution target, counted in business hours.
- The clock pauses while a ticket is pending the customer, **for resolution only** (owner's
  answer).
- A background job warns about tickets at risk and breached, and live badges show On track, At
  risk or Breached.
- Any conversation can become a ticket, linked to its contact, organization and open
  opportunities.

Before this, ADR-037 had first-reply targets in clock hours only, no resolution target, no
escalation, and a `tickets` table whose whole row `authenticated` could update.

**Decision.**
1. *All SLA time lives in the database.*
   - `app.business_add` and `app.business_minutes_between` count minutes inside a business's
     opening hours, in its timezone (daylight saving included). They skip its public holidays when
     asked, reusing the Rosters list (`public_holidays`).
   - The `tickets_sla` trigger sets every SLA column on insert and on each status, priority or
     policy change.
   - So a ticket changed by staff (RLS), by the customer on their ticket page (`public.ts`), or by
     a channel webhook follows exactly the same rules, and the browser never needs to know the
     opening hours.
2. *The clock model.*
   - Due time = `business_add(created_at, target + paused minutes)`. At risk is the same with
     `at_risk_percent` of the target.
   - `pending`, `solved` and `closed` stop the resolution clock. Leaving them adds the counted
     standing time and moves the resolution times on. A ticket solved and reopened therefore
     resumes with the time it had left.
   - The first-response clock never pauses. It is met by the first reply, which the trigger
     records once, at the moment it happens, so it cannot be back-dated.
   - Changing the priority or policy recalculates everything and lifts a breach whose new time is
     still ahead.
3. *Nobody types SLA times.* Sessions lose update on `tickets` and get it back column by column,
   without the SLA columns. This closes the 0040/0054 grant that let anyone with `tickets.work`
   rewrite the whole row through the API.
4. *Policies.*
   - Every business gets "Standard": first replies as ADR-037 had them, and resolutions in 4 h,
     1 day, 3 days and 7 days, around the clock. It is created in migration `0078` and at
     provisioning.
   - Helpdesk → Response targets (`tickets.manage`) edits the targets, the at-risk point
     (default 75%), an escalation person and the business hours (several spans a day allowed).
   - Saving re-applies the policy to the tickets still being worked.
   - The schema allows several policies; one default is used for now.
5. *The sweep* (`app.sla_sweep`, pg_cron every 5 minutes, ADR-011):
   - It marks targets that are past due and sends in-app notices.
   - Recipients: the assignee; on a breach, also the policy's escalation person; when neither
     applies, everyone with `tickets.manage`.
   - A notice names the ticket number and the target only, and lands once per ticket and target
     (dedupe key). Paused targets are skipped.
   - Badges do not depend on the sweep: the server stores the at-risk and due instants, and the
     browser compares them with its clock every 30 seconds.
6. *The CRM and the inbox.*
   - Tickets gain `organization_id`, `conversation_id` and `ticket_opportunities`. These are
     filled from the contact's primary organization and open opportunities, within what the
     creator may see.
   - `contact_id` finally gets its composite foreign key (`0077` clears any orphans first).
   - A conversation becomes a ticket from its details panel (`tickets.work` + `social.view`). One
     ticket follows a conversation at a time: asking again returns the open one.
   - Replies on such a ticket go to the customer on the channel through `replyToConversation`,
     with its permission and reply-window checks, and live in the conversation; no email is sent.
   - A customer writing again reopens a ticket that was pending or solved. Each account can also
     open a ticket for every new conversation (off by default).
   - That follow-up runs in a savepoint after the message is stored, so it can never lose the
     message.
7. The queue gains an **At risk** view and sorts by the soonest running due time.

**Consequences.**
- Hosted Supabase needs `pg_cron` enabled; the migration creates it where available. Without
  it, badges still work but nobody is notified.
- Public holidays are edited in Rosters settings. A business without the Rosters feature has
  none to skip.
- Policy changes apply to open tickets at once, which can turn some At risk or Breached
  immediately.
- Only one policy is chosen automatically (the default). Rules by channel or category are a
  later step.
- Notices are in-app only. Emailing them needs the notification email path, which runs from the
  application rather than the database.


## ADR-070 — Email inbox: Resend inbound and outbound, threads, and its own feature

**Context.** Phase 3 of the plan the owner approved on 21 November 2026 (ADR-068), with the
owner's choices: Resend rather than IMAP/SMTP, and threading that keeps `Message-ID` and
`In-Reply-To`. Resend's documentation, read on 22 November 2026, says:
- the `email.received` webhook carries metadata only;
- the words, headers, `message_id` and an `authentication` result (SPF, DKIM, DMARC as `pass |
  fail | gray | …`) come from `GET /emails/receiving/{id}`, and attachments' short-lived
  `download_url`s from `GET /emails/receiving/{id}/attachments`;
- a receiving domain gets mail for any address at it;
- `POST /emails` takes custom `headers`, `reply_to`, attachments by `path`, and an
  `Idempotency-Key`;
- whether a custom Message-ID is honoured is not documented, but the RFC Message-ID arrives as
  `data.message_id` on `email.sent` and later events;
- webhooks are signed the Svix way.

Two details were not documented: whether `headers` holds `In-Reply-To` and `References`, and
whether plus-addressing works.

**Decision.**
1. *A fifth inbox channel, not a new table set.*
   - `social_accounts.platform = 'email'`; the account is the business's address at the
     platform's `INBOX_EMAIL_DOMAIN`, created from Connected accounts (`social.manage`).
   - Addresses are unique while live, and the platform's own and reply addresses are reserved.
   - Email conversations are threads (`participant_id = email:<uuid>`) with `participant_email`,
     `subject` and a secret `reply_token`.
   - Messages carry `email_message_id` and `email_meta`.
   - Notes, saved replies, presence, assignment, snooze, search, tickets and SLA all apply
     unchanged.
2. *Threading that does not depend on undocumented headers.*
   - Every reply's Reply-To is the thread's own address `r-<24 random characters>@<domain>`. The
     catch-all receiving domain delivers it, and a message sent to it joins its thread.
   - `In-Reply-To` and `References` are used as well when Resend passes them. Our replies' real
     Message-IDs are recorded from `email.sent`, and replies set `In-Reply-To` and `References`
     so they thread in the customer's mail program.
   - A message joins a thread only from that thread's customer address. Anyone else starts their
     own thread.
3. *The sender is trusted only when authenticated.*
   - A From address can be forged. A sender is linked to a contact or made a lead only when
     Resend reports DKIM or DMARC `pass`.
   - Otherwise the match is only offered (`contact_match = 'suggested'`) and the message shows
     "Sender not verified".
   - Machine mail (Auto-Submitted, Precedence, List-Id and similar, mailer-daemon and no-reply
     senders) never makes a lead or opens a ticket.
4. *Words, not HTML.*
   - The text part is kept, or HTML reduced to text, without the quoted history, up to 20,000
     characters, and always shown as text.
   - Replies go as text plus an escaped HTML copy.
   - Attachments are copied through the media pipeline from Resend's attachment host, at most ten
     per email. Replies can attach one image, PDF or Office file up to 10 MB, sent by a ten-minute
     link.
5. *The webhook* `/api/webhooks/resend`:
   - It verifies the Svix signature on the raw body (5-minute tolerance, any `v1` signature in the
     list), checked against Svix's published test vector.
   - It is idempotent on Resend's email id, rate-limits 60 emails an hour per sender per inbox and
     2,000 per inbox, and answers 500 on failure so Resend retries.
   - Delivered, bounced, complained, failed and suppressed events move a reply's status, never
     backwards.
6. *Its own feature, shared permissions.*
   - The new feature is `email_channel`. The `social` permission family now needs the group
     `inbox` (`social` or `email_channel`), in `app.permission_feature`, `app.feature_enabled`,
     `app.my_context` and `src/lib/features.ts` (`FEATURE_GROUPS`).
   - Restrictive `inbox_channel` policies hide each account's rows while its own channel's
     feature is off. A business can have email without social media, or the other way round.
   - The menu says **Inbox**.

**Consequences.**
- The platform owner sets up a Resend receiving and sending subdomain, its MX, SPF and DKIM
  records, and a webhook with the events above (docs/email-inbox.md).
- Replies come from the inbox address, not the business's own domain (later).
- A forwarded email whose DKIM did not survive forwarding stays "not verified" until a person
  links it.
- No new email to someone who has not written first; the received HTML is not kept.
- Rate-limited mail is dropped, not queued.


## ADR-071 — Knowledge base: a public help portal, Markdown articles, and reads by known contacts

**Context.** Phase 4 of the plan the owner approved on 21 November 2026 (ADR-068). The owner
approved `react-markdown` for article text. Custom domains wait. As noted in the plan, an
anonymous visitor cannot be tied to a contact without tracking cookies. So a contact's reads
come only from links sent to them.

**Decision.**
1. *Feature and permission.*
   - The new feature `knowledge_base` brings the permission `kb.manage` (Admin and Manager).
   - People who answer customers (`social.reply`, `tickets.work`) can find **published** articles
     and link them from replies. RLS keeps drafts to editors too.
2. *Articles.*
   - Markdown, with a title, summary, category and an address made from the title, unique per
     business. The editor has Write and Preview tabs.
   - Postgres full-text search on a generated `tsvector` (`simple` configuration, so it works in
     any language) plus title matching. No search engine, as the roadmap requires.
   - Read counts and feedback tallies are written by the public module only; editors cannot
     change them (column grants).
3. *Safe rendering.*
   - One `Markdown` component renders articles, with react-markdown's `skipHtml` and its URL
     filter.
   - Links are `rel="noopener noreferrer nofollow ugc"`; pictures load over https only and send no
     referrer.
   - Unit tests render hostile Markdown (script tags, `onerror`, `javascript:` links) and check
     nothing executable survives.
4. *The portal* `/help/<business slug>`:
   - It is closed until the business opens it. It serves only an open business with the feature on.
   - Pages: a home page with search and categories, article pages with title, description,
     canonical and Open Graph metadata, and an XML sitemap at `/help/<slug>/sitemap.xml`.
   - "Was this helpful?" goes to `/api/help/<slug>/feedback`, with a honeypot, size cap, Zod and a
     per-sender limit. A reason is kept only with a "no".
5. *Reads by known contacts.*
   - An agent inserts an article from the reply box (inbox or ticket). When the conversation or
     ticket has a contact, the link carries a random 32-character token; only its sha256 is stored,
     with the contact, the source and a 365-day expiry.
   - The article page reports the read from the browser to `/api/help/<slug>/view`, then removes
     the token from the address bar. The page sends no referrer.
   - A read counts once per link per day, only when the token, the business and the article all
     match.
   - Reads show on the contact's timeline ("Read the help article …") and on their tickets.
   - Erasing the person deletes their links and reads.

**Consequences.**
- Mail security scanners that run scripts can still register a "read". The record means "the
  link was opened", not certainly by the person.
- Anonymous portal reads are counted only in totals, rate-limited per visitor.
- Not built: custom domains, article versions, several languages per article, and pictures
  uploaded to Meroidea (articles link pictures hosted elsewhere, over https).

## ADR-072 — Live chat: a website widget in a frame, polling, and a signed identity

**Context.** Phase 5 of the plan the owner approved on 21 November 2026 (ADR-068). The owner
approved polling for the visitor's side, so no new service is added. Realtime stays on private
channels for signed-in staff only (ADR-065). A visitor cannot be trusted to say who they are, and
a business wants chats from its customers joined to their records.

**Decision.**
1. *A channel like the others.*
   - A widget is a connected account with platform `livechat` under the new feature `live_chat`,
     which joins the `inbox` feature group. Its chats sit in the same inbox, with the same notes,
     saved replies, assignment, presence, tickets and SLA.
   - Live chat has no reply window and takes text only, up to 2,000 characters.
   - An admin (`social.manage`) creates widgets on Connected accounts.
2. *The widget.*
   - The business pastes one script tag (`/widget/v1.js` with `data-key`). It draws a button and
     opens a frame of `/chat/<key>`. The chat itself runs in that frame, on Meroidea's origin.
   - The business lists the sites allowed to show it (up to 10 https origins). `proxy.ts` sends
     `Content-Security-Policy: frame-ancestors <those sites>` for the frame, looked up once a minute
     per widget; a widget with no sites cannot be framed. `next.config.ts` leaves `/chat/` out of
     the `DENY` rule for this.
   - The loader and the frame talk with `postMessage`, each checking the other's window and origin.
3. *The visitor.*
   - Starting a chat gives the visitor a random 32-character token; only its sha256 is stored in
     `livechat_visitors`. The token is kept in the frame's storage (browsers keep it per site) and
     sent in a request body or the `x-chat-token` header, never in an address.
   - Routes: `POST /api/chat/<key>/session`, and `GET` / `POST /api/chat/<key>/messages`. No
     session; every query starts from the key and stays within that widget's business. The routes
     cap body size, validate with Zod, and limit new chats per address and per widget, and messages
     per visitor and per widget.
   - Each message carries a client id, so a retry is stored once. The frame polls every 3 seconds
     while the chat is open and visible, else every 20. Each poll looks 30 seconds behind its
     cursor, because a transaction that began earlier can commit later; the frame drops repeats.
   - A visitor sees what they wrote and the business's replies: never a note, never another chat.
     A name and email can be given until the first message, then are kept, so a chat cannot change
     hands.
4. *Who the visitor is.*
   - Each widget has an identity secret, sealed like an account token and shown once when made or
     replaced. A site whose visitors sign in signs the visitor's email on its own server
     (HMAC-SHA256, hex) and passes `{ email, name, signature }` to the loader.
   - A valid signature (checked in constant time) marks the email verified. Only a verified email
     links the chat to the matching contact. A self-given email that matches is only suggested to
     staff, as with an unverified email (ADR-070). A wrong signature is ignored and the visitor
     carries on unverified.
   - A token whose verified email differs from a new signed identity starts a new chat (someone
     else signed in on that browser).
   - With "new lead for unknown senders" on, a visitor who left an email and matches nobody becomes
     a lead, as a website form would make one. A visitor with no email never does.
5. *Erasure and removal.* Erasing a contact clears the name and email of visitors in their chats or
   who gave their email. Disconnecting a widget forgets its secret, and its routes stop answering.

**Consequences.**
- Polling costs one small indexed query per open chat every 3 seconds. That is fine at the scale
  of the target businesses. Server-sent events or Realtime for visitors would be a later decision.
- In browsers that partition or block storage in frames, a visitor's chat lasts only as long as the
  page, or the site's own partition.
- Not built: attachments from visitors, typing indicators, offline email of replies to visitors,
  per-agent names in the widget (replies show the widget's name), office hours.

## ADR-073 — Tactile feedback: one engine, vibration where it exists, a spring everywhere

**Amends** ADR-054 (motion), adding a second kind of feedback alongside it.

**Context.** The owner asked for presses, drops and saves to be felt, not only seen, across the
whole workspace. Browsers differ: Android browsers have `navigator.vibrate`; iPhone Safari has
none, but since iOS 17.4 toggling an `<input type="checkbox" switch>` plays a Taptic tick;
desktops have no motor at all.

**Decision.**

1. *One engine.* `src/lib/haptics.ts` owns six patterns (`tap` 8 ms, `soft` 5 ms, `cardAppear`
   6·30·10, `drop` 18 ms, `success` 10·40·20, `warning` 25·50·25). Every pulse is clamped to
   5–35 ms. Each call vibrates where it can, otherwise ticks the hidden switch on touch devices that
   support it (one tick per pulse; later pulses are best effort), plays an optional soft click made
   with the Web Audio API (filtered noise, no audio files), and can play a short spring on the
   element involved (`[data-tactile]` keyframes in `globals.css`). Nothing throws; on the server it
   does nothing.
2. *Calls are folded together.* A pattern repeated within its window (400 ms for `cardAppear`) is
   dropped, and a stronger pattern swallows a weaker one that follows within 150 ms, so twenty
   cards arriving at once give one pulse and a drop is not followed by a page-arrival buzz.
3. *Wired once, not per screen.* `HapticsProvider` (root layout) listens for presses on the
   document and plays `tap` for any button, switch, checkbox, tab or menu item, so the 150-odd
   screens using `<Button>` and the raw buttons need no code. `data-haptic` overrides (nearest
   wins; `off` silences). Destructive buttons warn. On iPhones the listener uses `click`, which is
   certainly a user gesture; elsewhere `pointerdown`, so the press answers before the finger lifts.
   Also: `soft` on a new page and when a sheet opens; `success` / `warning` from `useActionRunner`;
   the pipeline board taps on pickup, drops on a new stage, and warns when the move is refused or
   needs approval; a customer's new message and a rising unread count play `cardAppear`, never on
   page load.
4. *Dropping files.* `<FileDropZone>` wraps an existing file input. Dropped files that pass the
   input's `accept` list are handed to the input and its `change` event fires, so upload code is
   unchanged and the server still checks every file. Used by the document library, imports and
   expense receipts.
5. *The person decides.* `hapticsEnabled` (default on) is the master switch; `soundFeedbackEnabled`
   (default off) adds the click. Both live in this browser's localStorage (`meroidea:haptics`),
   with a switch under My details → Preferences, reached from the account menu.
   `prefers-reduced-motion` turns off the springs only: vibration is not visual motion, and iOS and
   Android likewise keep haptics under Reduce Motion.

**Why.** One engine keeps the vocabulary consistent and short; a document-level listener covers
every control without touching each one; and folding calls together stops feedback becoming noise.
No dependency was added.

**Consequences.**
- Browsers only vibrate after the page has been interacted with, so the very first touch on a page
  may be silent on Android. iOS's tick depends on WebKit continuing to honour the switch control;
  it has not been verified on a physical iPhone in this change.
- Preferences are per device, not per account. Moving them to the account would need a column and
  is a later decision.
- A new screen gets press feedback for free. Its moments (a drop, an arrival) call
  `triggerHaptic` with an existing pattern; a new pattern belongs in `HAPTIC_PATTERNS`, within
  5–35 ms per pulse.
- Not built: swipe navigation (the app has no swipe gestures), a Tabs primitive (none in use).
