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
*(Superseded by ADR-057: plans are agreed with the platform owner and recorded in the console;
invoicing happens outside Meroidea.)*

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

## ADR-057 — Billing is recorded by the platform owner; invoicing stays outside Meroidea

**Supersedes:** ADR-024 (Stripe self-serve subscription) and the self-serve billing in
`onboarding.md` §7.

**Context.** Businesses are onboarded after a conversation and prices are discussed, not published
(ADR-029, ADR-047, ADR-052). Milestone 13 still described Stripe Checkout, a customer portal,
trials and dunning, which assumed a business subscribes, adds seats and cancels on its own.

**Decision.** Each business's commercial terms are recorded by a platform owner in the console, on
the existing `tenant_subscriptions` row: plan, agreed price and currency, billing cycle, seat limit
and status (`active`, `past_due`, `canceled`). The seat limit is enforced on the server when a
login is added or reactivated. The console shows per-business usage (active logins, storage). A
business that does not pay is marked past due and, if needed, suspended with the suspension that
already exists. Invoices to businesses are issued from the platform owner's own accounting
system, not from Meroidea. Every change is written to `platform_audit_logs`.

**Why.** A sales-led service with a handful of clients needs the agreed terms written down and the
seat limit kept, not a payment flow. Stripe would add webhooks, a second source of truth for
status and a dependency, for collections the platform owner already handles. This matches
ADR-019's line that invoicing belongs in the accounting system.

**Consequences.** Nothing is charged automatically; a missed payment is noticed by the platform
owner, not by the system. `stripe_customer_id`, `stripe_subscription_id` and `trial_ends_at` on
`tenant_subscriptions` are unused, and milestone 13 decides whether to drop them. The design is
recorded here and in `roadmap.md`; none of milestone 13 is built yet.
