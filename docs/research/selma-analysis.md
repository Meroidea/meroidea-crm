# SELMA SIS — Analysis for Meroidea

Research note, not part of the specification. Where it suggests a change to the spec, that change
is listed in §6 as a **proposal** and only takes effect once it is written into the relevant doc.
Companion to `suitecrm-analysis.md`; proposals already made there are referenced, not repeated.

- **Studied:** public product pages at `selmasis.com` and the SELMA Resource Centre
  (`wiki.selmasis.com`), 2026-09-28. No product access, no demo account, no screenshots of the
  logged-in app on the marketing site — UI observations below come from the help articles.
- SELMA is closed-source commercial software. We take *ideas and interaction patterns* only: no
  copied copy, screens, icons or templates.

---

## 1. What SELMA is — and why it matters to us

| | |
|---|---|
| Vendor | SELMA (NZ/AU), "Student Information System" |
| Buyer | Education **providers**: RTOs, private training, higher-ed, work-based training, English schools |
| Scope | Full SIS: student records, curriculum, intakes, timetable & attendance, marking, LMS link, compliance returns (AVETMISS, CRICOS, USI, TCSI, NZQA SDR), finance, accommodation, portals — with a built-in education CRM on the front |
| Tenancy | **Single-tenant** per customer (sold as a security feature) |
| Pricing | Per active student, unlimited staff users (≈ US$149–1,199/mo across 4 tiers) |

**Key point: SELMA sits on the other side of our first tenant's business.** Our education
consultancy is a *recruitment agent*; SELMA's customers are the *institutions* our consultants
apply to. So most of SELMA (timetables, grading, compliance returns, LMS) is out of scope by
definition. What transfers well is:

1. its **education CRM front end** (enquiry → application → offer → enrolment),
2. its **agent portal** — the exact shape of what a Meroidea *partner portal* should become,
3. a handful of **interaction patterns** that make a record-heavy system fast to work in,
4. its **configuration model** — "every workflow, field and form is a setting" — which is our
   industry-neutral promise too.

Useful side effect: our consultants already use SELMA-style agent portals at institutions. The
closer our application-item flow feels to those, the less friction for them.

### Module map, against our roadmap

| SELMA module | Our equivalent | Verdict |
|---|---|---|
| Education CRM (enquiries, pipeline, contact log, lead scoring) | M6 People, M7 Pipeline, M9 Work | Take patterns (§3) |
| Application module (template → steps → required fields → outcome → enrolment) | M8 Opportunity items | Take **stage gates** (§6 P1) |
| Student / contact / organisation index | M6 lists | Take **status count bar**, table⇄board toggle (§4) |
| Documents (folders, portal upload, retention) | M10 Documents | Mostly covered; take "documents arrive by form/email" |
| Visa / passport / insurance expiry tracking | M10 `expires_on` + `notify_expiring_documents` | Already covered |
| Offer letters (conditional → unconditional on verification) | Item stages + document requirements | Covered by P1 |
| Communication (2-way email/SMS, templates, bulk, triggers) | Stage 3 Inbox & channels | Take template + merge-field model (§6 P9) |
| Workflow builder | Stage 4 automation | Confirms the SuiteCRM proposal 10 shape; adds states + test run (§6 P7) |
| Form builder (conditional, multi-page, branded, embeddable) | Phase 2 `web_forms` / lead intake | Take conditional + multi-step + file upload (§6 P8) |
| Portals (student, agent, employer, parent, teacher) | Stage 3 self-service portals | Agent portal = our partner portal (§6 P6) |
| Dashboard (user-arranged widgets, task sticky notes) | M9 My Day, M11 Insight | Take role default + user arrange (§6 P10) |
| Report builder + scheduled subscriptions | M11 Insight | Scheduled digest already proposed (SuiteCRM P8) |
| Finance (quotes→orders, price books, debtors, Xero/MYOB) | Stage 3 Finance, ADR-019 | Validates "sync to accounting, don't replace it" |
| Agent commission rules (per agent / programme / region, tiers, volume bonus) | `partners` commission terms, P2 `partner_commissions` | Take rule overrides later (§6 P11) |
| RBAC ("hundreds of permissions", data security by campus/department), privacy blur | `permissions.md` scopes, `view_sensitive` | Take **privacy blur** (§6 P5) |
| Curriculum, timetable, attendance, marking, LMS, AVETMISS/CRICOS/NZQA returns, accommodation, Persona ID checks | — | Don't take (§7) |

---

## 2. How SELMA models the journey

- **Status on the student, applications as a separate pathway.** A student record carries a
  lifecycle status (Enquiry → Provisional → Validated → Enrolled …). An *application* is "the
  pathway a student undertakes before an enrolment can be created".
- **Application templates.** Admins build templates with three fixed *categories* —
  **Submitted → In Review → Outcome** — and any number of tenant-defined *steps* inside each.
  Each step declares **required fields**; you cannot mark a later step current until they're
  filled ("Mark as Current", with a warning listing what's missing). A step can be flagged
  **"can create enrolment"**, which is where the application converts.
- **Intake inheritance.** Applications inherit components, dates and fees from the intake /
  programme; changing template or intake resets progress to step one.
- **Workflows** hang off record create/update events (with old/new changeset) or a scheduled
  query, then If/Else and Field-Changed conditions, then Send email / Create task / Update field /
  Webhook. Workflows are Draft / Active / Paused / Archived, with "run once per entity".

**Mapping to us.** Our model is already the better fit for an agent: opportunity = the student's
case, opportunity items = applications, each with its own pipeline (ADR-018). SELMA's fixed
*category* layer is our `stage_category` (open/won/lost). What we don't have is SELMA's
**per-step required fields** — that's the most valuable idea in this note (P1).

---

## 3. What SELMA gets right (ideas worth taking)

1. **Progress is gated by data, not by discipline.** Required fields per step turn "did the
   consultant collect the passport?" from a manager's question into a system rule. Warn-and-list,
   not a silent block.
2. **The index page tells you the shape of the population before you search.** A row of status
   counts at the top of every list; clicking one filters the table. One glance answers "how many
   enquiries are waiting".
3. **Same data, two views, one URL.** Table grid by default, Kanban toggle — with the board
   refusing moves that would skip required steps and saying why.
4. **Staff alerts on a record.** A record can carry an alert other staff see when they open it
   ("Sponsor pays fees — don't invoice the student", "Do not call before 10am, time zone").
5. **One action menu per record.** Send communication, change status (wizard), transfer, add
   alert — all from one primary button in the header, instead of scattered links.
6. **Named, shareable views.** Column order, filters, sort and page size saved as named views,
   per user *and* shared with a team.
7. **Privacy blur.** A one-click screen mode that blurs sensitive values — built for a counsellor
   sharing their screen with a student or on a video call.
8. **Everything configurable is a setting, not a ticket.** Templates, steps, fields, forms,
   workflows, commission rules — no vendor involvement. Same promise as our milestone 12.
9. **Portals as the scaling lever.** The agent portal ("submit, upload, track, see commission
   statements, get marketing material") removes an entire category of email.
10. **Response-time SLA on enquiries.** Measuring time to first contact is the single most
    predictive lead metric for a consultancy, and SELMA reports it.

---

## 4. UI / UX patterns to adopt

SELMA's *look* is not the reference — its help screenshots show a conventional admin UI (purple
action buttons, pencil-icon inline edit, blue hyperlinks). Our visual language stays as
`design-system.md` defines it. We take the *patterns*, restyled:

| Pattern | Where in Meroidea | Our version |
|---|---|---|
| **Status count bar** | Contacts, Opportunities, Items lists; Partner & Institution pages | Row of chips above the table: stage name + count (+ sum amount for opportunities). Click = filter, reflected in URL. Stage colour as a 3px left bar, label always visible. Horizontal scroll on mobile. |
| **Table ⇄ Board toggle** | Opportunities, Applications | Segmented control top-right, same filters kept, `?view=board`. Board columns = the status chips. |
| **Gated stage move** | Board drag, stage stepper, inline item stage chip | On a blocked move: card snaps back, a sheet opens listing missing fields/documents with inline inputs; fill → move completes. Never a dead-end toast. |
| **Progress stepper with "current"** | Opportunity header, each application row | Existing stage stepper, plus a tick/empty/warning state per step showing whether its required data is complete. |
| **Record alert banner** | Top of any contact/opportunity/organization page | Amber strip, icon + text + author + date, dismiss per user, max 3 visible. |
| **Single action menu** | Record header | Primary button = most likely next action (Log activity); an "Actions" menu next to it holds Send, Change owner, Add alert, Merge, Archive. |
| **Saved views** | All tables | View switcher left of the search box: *My views* / *Team views* / *Workspace views*; "Save as…" when filters differ from the view. |
| **Privacy blur** | Global, top bar | Eye-slash toggle; blurs values of fields flagged sensitive + email/phone. Per user, session only, `Shift+P`. |
| **Dashboard with arrangeable widgets** | Home / My Day | Role default layout; user can hide and reorder (not free-form grid). Tasks due today pinned first. |
| **Page-level quick search** | Top bar | Search by name / email / phone / passport-last-4 / institution ID; `/` or `⌘K`. Postgres `tsvector` + `pg_trgm` already planned. |

Accessibility notes carried from `design-system.md`: status never by colour alone (chip text +
count), blocked-move sheet is keyboard reachable (board drag has a "Move to…" menu equivalent),
blur is a visual aid only — it is **not** access control; masking stays server-side.

---

## 5. Where our spec already does better

| Topic | SELMA | Meroidea |
|---|---|---|
| Tenancy | Single-tenant per customer | Multi-tenant with RLS + composite FKs; isolation tests over every table |
| Industry | Education-only vocabulary baked in | Industry-neutral core; education lives in seed/config |
| One student, many applications | Applications per intake; the student's *case* isn't a first-class object | Opportunity (case) + items, each with its own pipeline, and item stages advance the case (ADR-018) |
| Two revenue streams | Provider-side fees; commissions are what they *pay* agents | Service fee on the case + institution commission per application (ADR-019) |
| Record scope | Data security by campus/programme/department | own / team / all on every grant, one `scopeFilter()` |
| Audit | Change audit trail | Plus audited exports and downloads |
| Pricing model | Per student | Per seat (ADR-024) — right for a consultancy where staff, not students, are the cost driver |

---

## 6. Proposals for the spec (need sign-off before any doc changes)

In priority order. Each one names the doc it would change.

**Status (2026-09-28):** P2 (count bar) and P5 (privacy blur) are built with milestone 6 and
written into `design-system.md`. P1, P4 and P11 are the next ones to spec.

1. **Stage gates (required data per stage).** Add to `pipeline_stages`:
   `required_fields text[]` (core or custom field keys) and
   `required_document_type_ids uuid[]` (must be *verified* or *waived*). The service layer checks
   them on every stage change — board, stepper, API, import — and returns the list of what's
   missing. `stage_history` records a forced override (new permission
   `opportunities.override_stage_gate`, audited). Applies to opportunity and item pipelines alike.
   Education seed: *Application Submitted* needs passport + transcript verified; *Offer Accepted*
   needs item tuition fee + intake. → `database.md` §4, `permissions.md`, `architecture.md` §6,
   `design-system.md`. **Fits M7/M8.**
2. **Status count bar + table/board toggle** as the standard list header. UI only, no schema.
   → `design-system.md`, `architecture.md` §4. **M6–M8.**
3. **Record alerts.** `record_alerts(id, tenant_id, entity_type, entity_id, body text,
   severity alert_severity /* info | warning */, created_by, expires_on date, created_at,
   deleted_at)` with RLS; visible to anyone who can view the record; `record_alerts.manage`
   permission. Also the natural place for automation and the expiry cron to raise flags
   ("Visa expires in 28 days"). → `database.md` §5, `permissions.md`. **M9.**
4. **Shared saved views.** Flesh out the 🟡 `saved_views` stub: `(id, tenant_id, user_id,
   entity_type, name, visibility view_visibility /* private | team | workspace */, team_id,
   filters jsonb, columns jsonb, sort jsonb, is_default)`. Only `settings.manage` can create
   workspace views. → `database.md` §8. **M6.**
5. **Privacy blur.** Client-side display mode (no schema). Depends on SuiteCRM proposal 4
   (`custom_field_definitions.is_sensitive`) to know which fields to blur. → `design-system.md`.
   **M6.**
6. **Partner portal scope = SELMA agent portal.** When Stage 3 portals arrive, a partner user
   can: submit a contact + opportunity with documents (lands in intake, not straight into the
   pipeline), track their referrals' case and item stages, see their commission statement (from
   `partner_commissions`), download shared resources. Needs SuiteCRM proposal 3
   (`activities.is_internal`) and a `documents.shared_with_partner` flag. → `roadmap.md` Stage 3,
   `product-requirements.md` §3 Partner row.
7. **Automation: add to SuiteCRM proposal 10** — workflow states Draft / Active / Paused /
   Archived; *run once per entity* option; a **dry run** against the last N matching records
   before activating; triggers include a *scheduled query* (pg_cron, ADR-011) alongside events;
   the *field changed* condition reads the `audit_logs.changes` diff we already store.
   → the new ADR.
8. **Web forms: conditional fields, multi-step, file upload.** Extend the Phase 2 `web_forms`
   design: `schema jsonb` holds steps, fields (mapped to core/custom field keys), `show_if`
   rules; uploads go to a quarantine bucket and attach to the created contact as documents with
   status *received*. Tenant branding applied automatically. → `database.md` §8,
   `architecture.md` §9.
9. **Message templates with merge fields** (Stage 3 Inbox): `message_templates(tenant_id, name,
   channel /* email | sms | whatsapp */, subject, body, category)` rendering
   `{{contact.first_name}}`, `{{opportunity.stage}}`, custom field keys, tenant labels. Used by
   manual send, bulk send and automation. → `roadmap.md` Stage 3.
10. **Dashboard layout per role, rearrangeable per user.** `dashboard_layouts(tenant_id,
    role_id | user_id, widgets jsonb)`; widget catalogue in code (My tasks, Stale opportunities,
    Pipeline by stage, New enquiries not yet contacted, Expiring documents, Conversion by
    source). → `database.md` §8, `roadmap.md` M9/M11.
11. **Speed-to-lead metric.** Add `opportunities.first_contacted_at timestamptz`, set by the
    service on the first outbound activity (call/email/message/meeting) after creation. My Day
    gains a *New — not yet contacted* section sorted oldest first; M11 reports median time to
    first contact by consultant and source. → `database.md` §4, `product-requirements.md` §C, §F.
12. **Commission rules with overrides (Phase 2).** Keep the partner's default terms, and add
    `commission_rules(tenant_id, partner_id null, organization_id null, product_id null,
    region text null, commission_type, basis, value, tier_from int, valid_from, valid_to,
    priority)` — most specific match wins. Covers "ABC gets 10%, but 12% for University X from
    S1 2027". Also usable for *institution* commission rates we receive. → `database.md` §7,
    ADR-019.

---

## 7. Things we deliberately don't take

Curriculum builder, timetable & attendance, marking & moderation, LMS integration and Moodle
hosting, AVETMISS / CRICOS / USI / TCSI / NZQA compliance returns, certificate & transcript
generation, accommodation & homestay, Persona biometric ID checks, single-tenant hosting,
per-student pricing, and an AI "describe your workflow" builder (Stage 4 AI is scoped in
`roadmap.md`; build the plain builder first). These are provider-side SIS features or conflict
with ADR-024/ADR-025 and the stack rules. If Meroidea ever sells to training providers, revisit
curriculum/intakes as a *configuration* of products + items, not as new core objects.

## Sources

- https://selmasis.com/ · /crm · /student-management · /international · /automation ·
  /customisation · /communication · /finance · /portals-apps · /reporting
- https://wiki.selmasis.com/edit-dashboard/ · /searching-the-student-index/ ·
  /navigating-the-enrolment-profile/ · /application-module/ · /workflow-builder/
