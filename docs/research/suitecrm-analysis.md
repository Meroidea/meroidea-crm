# SuiteCRM — Analysis for Meroidea

Research note, not part of the specification. Where it suggests a change to the spec, that change
is listed in §6 as a **proposal** and only takes effect once it is written into the relevant doc.

- **Studied:** `github.com/SuiteCRM/SuiteCRM` @ `ce25314` (2026-09-03), **SuiteCRM 7.15.2**
- Paths below are relative to that repo.

> **Licence — read first.** SuiteCRM is **AGPLv3**. Meroidea is a closed, hosted SaaS. We take
> *ideas and data-model lessons* only: no copied code, templates, language strings or dropdown
> lists. Build every part from our own spec. (Not legal advice. If we ever want to reuse actual
> code, ask a lawyer first.)

---

## 1. What SuiteCRM is

| | |
|---|---|
| Lineage | Fork of SugarCRM Community Edition 6.5 (2013), extended by SalesAgility with the "AO*" modules (Advanced OpenSales / Workflow / Reports / Portal / Discovery / Knowledge) |
| Stack | PHP 8.1, MySQL/MSSQL, Smarty templates, jQuery/YUI, Slim 3 + league/oauth2-server for the API, Zend Lucene / Elasticsearch for search |
| Size | ~760k lines of PHP (bundled libraries included), **123 modules**, ~183 test files |
| Tenancy | **Single-tenant.** One install = one company. Config, cache and uploads sit on the local disk. |
| SuiteCRM 8 | A separate repo (`SuiteCRM-Core`) puts an Angular + Symfony UI over this same legacy engine. The data model below is the same. |

### Module map, grouped by our roadmap

| Our area | SuiteCRM modules |
|---|---|
| People & organisations | Contacts, Accounts, Leads, Prospects, ProspectLists, EmailAddresses, MergeRecords, Import |
| Sales | Opportunities, Campaigns, AOS_Products / Categories, AOS_Quotes, AOS_Contracts, AOS_Invoices, AOS_PDF_Templates, Currencies |
| Work | Calls, Meetings, Tasks, Notes, Emails, Reminders, Calendar, Alerts, SugarFeed |
| Documents | Documents, DocumentRevisions |
| Service | Cases, AOP_Case_Updates / Events, AOBH_BusinessHours, AOK_KnowledgeBase, Bugs |
| Delivery | Project, ProjectTask, AM_ProjectTemplates, AM_TaskTemplates, ResourceCalendar |
| Insight | AOR_Reports / Fields / Conditions / Charts / Scheduled_Reports, Spots (pivot), Home dashlets |
| Automation | AOW_WorkFlow / Conditions / Actions / Processed, Schedulers, SchedulersJobs |
| Admin & access | Users, Employees, ACLRoles, ACLActions, SecurityGroups, Studio, ModuleBuilder, DynamicFields, LabelEditor, Configurator |
| Extras | FP_events, Surveys, jjwg_Maps, EmailMarketing, OAuth2Clients, ExternalOAuthConnection |

---

## 2. How it's built

### 2.1 Data layer: "Beans" defined by metadata
- Every record type is a subclass of `SugarBean` (`data/SugarBean.php`, one class of 6,369 lines)
  that handles saving, loading, list queries, relationships, access control, audit and hooks.
- Fields, indexes and relationships are declared in PHP arrays (`modules/*/vardefs.php`).
  Shared field sets come from templates (`include/SugarObjects/templates/`: `basic`, `person`,
  `company`, `sale`, `issue`, `file`) and behaviours from `implements/` (`assignable`, `security_groups`).
- **The schema comes from those vardefs, not from migrations.** Admin → "Repair & Rebuild" compares
  them with the live database and runs the ALTERs.
- Every table gets `id char(36)`, `date_entered`, `date_modified`, `created_by`,
  `modified_user_id`, `deleted tinyint` and `assigned_user_id`.
- Relationships: definitions are rows in `relationships`, many-to-many links use one join table each
  (`metadata/*MetaData.php`, 88 files), and activities attach to anything polymorphically through
  `parent_type` + `parent_id`, which has **no foreign key**.

### 2.2 Custom fields: sidecar tables with real columns
- Definitions live in `fields_meta_data`. Values live in `<table>_cstm` (e.g. `contacts_cstm`), one
  real column per field, created with `ALTER TABLE` at runtime and joined with
  `LEFT JOIN contacts_cstm ON contacts.id = contacts_cstm.id_c`
  (`modules/DynamicFields/DynamicField.php`).
- Each field carries useful flags: `audited`, `importable`, `reportable`, `mass_update`,
  `duplicate_merge`, `required`, `default`, `help`, plus **dependent dropdowns**
  (`include/SugarDependentDropdown`).

### 2.3 Access control: roles × module × action, plus security groups
- `ACLRoles` grant, per module, the actions `access`, `view`, `list`, `edit`, `delete`, `import`,
  `export` and `massupdate`, each at a level: **All · Owner · Group · None**
  (`modules/ACLActions/actiondefs.php`).
- List scope is added in `SugarBean::buildAccessWhere()` (data/SugarBean.php:3590):
  - Owner level: `assigned_user_id = me`.
  - Group level: `EXISTS (…securitygroups_users × securitygroups_records…)`.
  - A `before_acl_query` hook can rewrite either.
- **Security groups tag individual records.** `securitygroups_records(module, record_id)` rows are
  copied onto new records from the creator, the assigned user or the parent record
  (`SecurityGroup::inherit_*`). A record can be in several groups.
- Admins bypass everything. There is no field-level ACL in this edition.

### 2.4 Automation (AOW)
- A workflow has a `flow_module`; `run_on` (New / Modified records); `run_when` (Always / On Save /
  Scheduler); `multiple_runs`; and `run_on_import`.
- Condition types: Value, Field (compare to another field), **Any_Change**, Date (relative,
  including `business_hours`), Multi, SecurityGroup. Operators: `= ≠ > < ≥ ≤ contains
  starts/ends-with is_null`. Conditions combine with AND/OR.
- Actions: **Create Record, Modify Record, Send Email, Compute Field** (formula calculator).
  Assignment can be **Round Robin, Least Busy or Random**.
- `aow_processed(workflow, parent_type, parent_id, status)` stops a flow re-running on the same record.
- Execution happens **synchronously inside the `after_save` hook** at priority 99
  (`custom/Extension/application/Ext/LogicHooks/AOW_WorkFlow_Hook.php`), and also from cron. A
  static `$doNotRunInSaveLogic` flag exists to stop flows that save records from recursing.

### 2.5 Reports (AOR)
- A report has a base module plus:
  - **Fields**: `module_path` (relationship path), `field_function` (COUNT/SUM/AVG/MIN/MAX),
    `group_by`, `sort_by`, `total`, `format`.
  - **Conditions**: `logic_op`, `parenthesis`, `operator`, `value_type` = Value / Field / Date /
    Multi / **Period** / **CurrentUserID**.
  - **Charts**: `type`, `x_field`, `y_field`.
  - **Scheduled reports**: a cron expression and recipients.
- `AOR_Report::build_report_query*` turns this into SQL and adds an access filter
  (`build_report_access_query`).

### 2.6 Everything else worth knowing
- **Opportunities**:
  - `sales_stage` is a global dropdown, and a parallel `sales_probability_dom` maps stage to %.
  - Money is `amount` plus `amount_usdollar`, a converted copy at the `currencies.conversion_rate`
    of the moment. The base currency is effectively USD.
  - `date_closed`, `next_step`, a `lead_source` dropdown, `campaign_id`.
  - **No stage-history table.** Stage changes survive only if `sales_stage` is audited.
- **Leads** are a separate module. "Convert" copies a lead into Contact + Account + Opportunity,
  moves its activities and runs duplicate checks on each (`modules/Leads/views/view.convertlead.php`).
- **Activities** are five separate modules (Calls, Meetings, Tasks, Notes, Emails), each
  polymorphic. The History subpanel UNIONs them. Calls and meetings have invitees with
  `accept_status`, recurrence and reminders.
- **Email addresses** are shared, de-duplicated rows (`email_addresses`: `invalid_email`,
  `opt_out`, confirmed opt-in token and dates). `email_addr_bean_rel` links an address to any record
  with `primary_address` / `reply_to_address`.
- **Import** (`modules/Import`) is a wizard: upload → delimiter detection → field mapping (saved as
  reusable *import maps*) → duplicate check against user-selected indexes → import.
  `users_last_import` enables **undo last import**.
- **Merge** (`modules/MergeRecords`) compares records side by side, lets the user pick each field's
  value and re-points relationships.
- **Audit** uses one `<table>_audit` per module (`field_name`, `before/after_value_string|text`).
  It covers **updates to fields flagged `audited` only**: no creates, views, exports or downloads.
- **AOS quotes → invoices → contracts** share a line-item model:
  - `aos_products_quotes` snapshots the product name, list/unit/cost price, discount, VAT and total.
  - `aos_line_item_groups` holds subtotals per group.
  - PDF templates use field placeholders.
- **Cases**: threaded `aop_case_updates` with an `internal` flag hide staff-only notes from the
  customer portal. Business hours feed SLA date maths.
- **Background jobs**: `cron.php` runs every minute, and `schedulers` enqueue `job_queue` rows
  (`status`, `resolution`, `retry_count`, `failure_count`). Built-in jobs include inbox polling,
  campaign email, workflow processing, scheduled reports, email reminders, index maintenance and
  pruning.
- **API v8** (`Api/V8/Config/routes.php`):
  - JSON:API over OAuth2 (password and client-credentials grants).
  - Generic CRUD at `/V8/module/{moduleName}/{id}` and relationship endpoints under the same path.
  - `/meta/modules`, `/meta/fields/{module}`, `/meta/swagger.json`.
- **Productivity touches**: Trackers (recently viewed), Favorites, SugarFeed (activity stream),
  Spots (saved pivot tables), dashlets on Home.

---

## 3. What SuiteCRM gets right (ideas worth taking)

| # | Idea | Where in SuiteCRM | How it maps to Meroidea |
|---|---|---|---|
| 1 | **One access model everywhere**: action × level, applied to lists, records, reports, exports and the API | ACLActions, `buildAccessWhere`, `build_report_access_query` | Same shape as our permission + scope. Confirms `scopeFilter()` must also cover reports, exports and the future API. |
| 2 | **Separate import, export and mass-update permissions** | `actiondefs.php` | We have import/export. **Mass update has no permission of its own yet** (see §6). |
| 3 | **Field metadata flags**: audited, importable, reportable, mass-updatable, merge-able, dependent dropdowns | vardefs / `fields_meta_data` | Useful extra columns for `custom_field_definitions` (§6). |
| 4 | **Workflow shape**: trigger → conditions (incl. *any change* and relative dates) → actions (create / modify / email / compute), assignment strategies, run-once ledger | AOW_* | A good template for Stage 4 automation. **Round-robin and least-busy assignment** is needed earlier, for web-form and Meta leads (§6). |
| 5 | **Report definitions as data**: fields with aggregate + group + sort + total, conditions with brackets, *Period* ("this quarter") and *Current user* ("my") values, charts, scheduled email | AOR_* | A path from our fixed reports (M11) to a user-built report: a Zod-validated JSON definition compiled to Drizzle *through* `scopeFilter()`. |
| 6 | **Saved import maps + duplicate-check choice + undo** | Import | We already have undo and a duplicate strategy. **Saved mappings** answer open question 5 (partners sending batches in their own format). |
| 7 | **Side-by-side merge** that re-points relationships | MergeRecords | The UX reference for `contacts.merge` 🟡. |
| 8 | **Shared email-address rows with per-address opt-out / invalid / double opt-in** | EmailAddresses | Consent and bounces belong to an *address*, not a person. Matters once we send email (Spam Act 2003). |
| 9 | **Money snapshot in the base currency** | `amount_usdollar` | For Phase 2 FX, store the converted amount and rate **at close** so old reports don't drift with rates (§6). Base = tenant currency, never USD. |
| 10 | **Line items snapshot product data** (name, price, discount, tax) | AOS_Products_Quotes | For Stage 3 quotes: a line item copies the product at quote time; later price changes don't rewrite quotes. |
| 11 | **`internal` flag on updates** so portal users never see staff notes | AOP_Case_Updates | Cheap to add to `activities` now, expensive to retrofit when portals arrive (§6). |
| 12 | **Business-hours date maths** | AOBH, AOW `business_hours` | Use `tenants.settings.workingHours` for due-date and stale calculations later. |
| 13 | **Job ledger** with status, resolution and retries | SchedulersJobs | pg_cron already keeps `cron.job_run_details`. Surface failures in the platform admin console (Stage 4). |
| 14 | **Recently viewed + favourites** | Trackers, Favorites | Small effort, large daily-use win for consultants (§6). |
| 15 | **Metadata-described API** (`/meta/fields`, swagger) | API v8 | Our public API can generate its schema from the permission catalog, Zod schemas and custom field definitions. |

---

## 4. What to avoid (and where our spec already does better)

| SuiteCRM choice | Problem | Meroidea's position |
|---|---|---|
| Single-tenant install, disk-based config, cache and uploads | Every customer is a separate server; no isolation guarantees inside the code | `tenant_id` everywhere, composite FKs, RLS (ADR-006/007/012) ✅ |
| Schema derived from vardefs by "Repair & Rebuild"; Studio/ModuleBuilder write PHP and ALTER tables at runtime | Unreviewable schema drift; impossible in a shared multi-tenant database | Drizzle migrations only (rule 6); tenant configuration is data ✅ |
| Custom fields in `_cstm` tables with runtime ALTERs | One tenant's field would change everyone's table | JSONB + definitions (ADR-003) ✅ |
| Separate Leads module + conversion | Duplicated data, duplicated dedupe logic, activities moved between records | No Lead object (ADR-002) ✅ |
| No stage history, only optional field audit | No time-in-stage or funnel without guesswork | `stage_history` (ADR-009) ✅ |
| Five activity tables UNIONed for history | Slow timelines, inconsistent fields | One `activities` table + `tasks` ✅ |
| Polymorphic `parent_type/parent_id` without FKs | Orphans; cross-record mistakes can't be caught by the database | Explicit nullable FKs + `num_nonnulls` check ✅ |
| Audit only on flagged fields, only on update, per-module tables | No trail for creates, exports, downloads or logins; hard to view across the system | One append-only `audit_logs` incl. export/download/login ✅ |
| Security groups tag each record and inherit tags on save | Tags drift from reality (re-assigning a record doesn't re-tag it); an extra EXISTS subquery on every list | `team` scope computed from the owner, so nothing to keep in sync ✅. Add `record_shares` only on demonstrated need. |
| SQL built by concatenation with `->quote()` (≈470 `quote()` calls, ~6 prepared statements in `data/`, `include/`, `modules/`), `$_REQUEST` and `$current_user` globals read inside business logic | The pattern behind most of the injection and authorization bugs that force CRM security releases | Drizzle parameterised queries; `authedAction()` pipeline with Zod input (rule 2) ✅ |
| Workflows run synchronously in `after_save` | Slow saves, recursion guards, a failure in an automation breaks the user's save | Automations run **after commit**, off the request (pg_cron / outbox), idempotent per record |
| Global base currency fixed to USD | Wrong for AUD-first businesses | Tenant `default_currency` ✅ |
| 123 modules shown as tabs; admins switch modules on and off | Cluttered UI; customers have to assemble their own system | ADR-025: one workspace, navigation driven by role ✅ |
| Dropdown lists (stages, sources) as global language arrays | Renaming a stage is a language-file edit and shared by all users | Tables per tenant (ADR-016) ✅ |

---

## 5. Side-by-side

| Concern | SuiteCRM 7.15 | Meroidea (spec) |
|---|---|---|
| Tenancy | Single install per company | Multi-tenant, RLS, `{slug}.meroidea.app` |
| Person you sell to | Lead → converted to Contact | Contact + Opportunity in first stage |
| Deal | Opportunity (single stage dropdown) | Opportunity + **opportunity items** with their own pipeline |
| Stages | Global dropdown + probability map | `pipelines` / `pipeline_stages` per tenant, open/won/lost, stale threshold |
| Stage history | None | `stage_history` per visit |
| Custom fields | `_cstm` columns via ALTER | JSONB + `custom_field_definitions` |
| Access | Role × module × action at All/Owner/Group/None + record groups | Permission × scope own/team/all, `scopeFilter()`, sensitive-field masking |
| Audit | Per-module, flagged fields, updates only | Global append-only, all actions |
| Activities | 5 modules, polymorphic parent | 1 `activities` + `tasks`, explicit FKs |
| Documents | Documents + revisions, generic | Typed checklist at contact / opportunity / item level with verification |
| Automation | AOW (sync after_save + cron) | pg_cron jobs now; automation engine Stage 4 |
| Reports | Builder + charts + scheduled email | Fixed reports (M11); builder later |
| Quotes / invoices | AOS (full) | Stage 3 Finance; ledger in accounting system |
| API | JSON:API v8 + OAuth2 | Stage 4 public API + webhooks |
| Search | SQL / Lucene / Elasticsearch | Postgres tsvector + pg_trgm |

---

## 6. Proposals for the spec (need sign-off before any doc changes)

In priority order. Each one names the doc it would change.

1. **Mass-update permission.** Add `contacts.bulk_edit` and `opportunities.bulk_edit`, both
   scoped. Every row is still checked against scope, and a bulk run writes one audit row that
   points to the per-row changes. → `permissions.md`
2. **Assignment rules before Stage 4.** Give `web_forms` and `lead_intake_events` an
   `assignment_strategy`: fixed user / round robin within a team / least open opportunities, with a
   per-team cursor. Needed as soon as Meta Lead Ads arrive (Phase 2). → `database.md` §8
3. **Activity visibility.** Add `activities.is_internal boolean not null default true` now, so
   Stage 3 portals only show rows that were deliberately shared. → `database.md` §5
4. **Custom field flags.** Add to `custom_field_definitions`:
   - `is_importable` (default true)
   - `is_reportable` (default true)
   - `is_sensitive` (masks the value without `contacts.view_sensitive`; our seed already calls the
     passport number sensitive but the table has no column for it)
   - `depends_on jsonb`, e.g. show "English score" only when "English test" ≠ none

   → `database.md` §8
5. **Saved import mappings.** An `import_mappings(tenant_id, name, entity_type, column_mapping,
   options, partner_id)` table, so a partner's recurring spreadsheet maps in one click. → `database.md` §8
6. **FX snapshot at close (Phase 2).** Add `amount_in_tenant_currency numeric(14,2)` and
   `fx_rate numeric(18,8)` to opportunities and items, set when a record reaches won/lost.
   → `database.md` §4, `product-requirements.md` §J
7. **Recently viewed and favourites.** A `user_record_visits(tenant_id, user_id, entity_type,
   entity_id, visited_at)` table capped per user, plus `is_favourite`. Would be M9 "Work" UX.
   → `database.md` §8, `roadmap.md`
8. **Scheduled digest.** A weekly owner email with pipeline movement, stuck opportunities and
   follow-up compliance. This is AOR's scheduled report for "visibility without chasing people".
   Fits M11. → `roadmap.md`
9. **Multiple emails and phones per contact, with per-address opt-out / bounced (Phase 2, with
   email).** Keep `email` / `phone` as the primary copy for search and dedupe. → `database.md` §4
10. **Automation design note for Stage 4.** Structure: trigger (created / updated with *field
    changed* / stage entered / time-based) → conditions (AND/OR groups) → actions (update field,
    create task, assign, notify, send email). Runs after commit, logged in `automation_runs` with a
    dedupe key, and recursion is capped. → new ADR in `decisions.md`

## 7. Things we deliberately don't take

Bugs / Releases, Maps, Surveys, Events, Campaign mass-mailing, the knowledge base, runtime module
builder, per-module enable/disable, Lucene/Elasticsearch, SOAP/v4.1 APIs. Each either conflicts
with ADR-025 and the stack rules or has no measured need in `product-requirements.md`.
