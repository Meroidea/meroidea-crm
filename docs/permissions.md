# Permissions

## Model

```
auth user → users → tenant_memberships (tenant, role, team) → roles → role_permissions (permission, scope)
```

- **Permission** — a string key from the code catalog (`src/lib/permissions/catalog.ts`).
- **Scope** — for record permissions only:
  - `own` — records where `owner_user_id = me` (tasks: `assigned_to = me`)
  - `team` — records owned by members of my team(s) or teams I manage, plus `own`
  - `all` — every record in the tenant
- Child records inherit the parent's access: you can see an opportunity's activities,
  tasks, and documents if you can see the opportunity (subject to their own permission, e.g. `documents.download`).
- Unassigned records (`owner_user_id is null`) are visible to `all` scope, and to `own`/`team`
  scope when `tenant.settings.consultantCanSeeUnassigned` is true (a shared "claim a lead" queue).
- Roles are editable per tenant. The `owner` role is a system role and always keeps `users.manage`
  and `settings.manage` so a tenant can't lock itself out.

## Enforcement points

```ts
const ctx = await getTenantContext();                    // who, which tenant, grants
requirePermission(ctx, 'opportunities.edit');            // has the permission at any scope?
const where = scopeFilter(ctx, 'opportunities.view', opportunities);   // SQL condition for lists
await assertCanAccess(ctx, 'opportunities.edit', opp);  // single-record check → NOT_FOUND if outside scope
canViewField(ctx, 'contacts.view_sensitive');            // mask sensitive fields in DTOs
```

Every one of these lives in `src/lib/permissions/` and has unit tests. Modules never
re-implement scope logic.

## Features come first (ADR-029)

Each permission family belongs to a feature the platform owner switches on per business
(`src/lib/features.ts`): `contacts`, `opportunities`, `revenue`, `activities`, `documents`,
`partners`, `organizations`, `products`, `reports` → **crm**; `tasks` → **tasks**; `rosters` →
**roster**; `timeoff` → **timeoff**; `timesheets` → **timesheets**; `reviews` → **reviews**; `tickets` → **helpdesk**; `recruitment`, `projects`, `productivity`, `expenses` → features of the same name; `employees` → **staff**; `inventory`, `purchasing`, `invoices`, `payroll`, `files` → features
of the same name. `settings`, `users`, `roles` and `audit` are always available. A grant whose
feature is off is dropped when the context is built, for every role including Owner, and the
database enforces the same rule: `app.has_permission` refuses it and the feature's own tables
hide their rows (ADR-038). The SQL copy of this map is `app.permission_feature`; a DB test keeps
the two identical.

**Platform owners** are not a role inside a business. They are named in `PLATFORM_ADMIN_EMAILS`
and work in `/platform`; inside a business they hold a temporary Owner seat marked as support.

## Catalog

| Key | Scoped | Meaning |
|---|---|---|
| `contacts.view` | ✓ | See contacts and their timeline |
| `contacts.create` | | Create contacts (owner defaults to self) |
| `contacts.edit` | ✓ | Edit contact fields |
| `contacts.delete` | ✓ | Soft-delete contacts |
| `contacts.assign` | ✓ | Change owner (within scope) |
| `contacts.view_sensitive` | | See DOB, passport number, and fields flagged sensitive |
| `contacts.import` | | Run CSV/Excel imports |
| `contacts.export` | | Export contact lists (audited) |
| `contacts.merge` 🟡 | | Merge duplicates |
| `opportunities.view` | ✓ | See opportunities, board, list |
| `opportunities.create` | | Create opportunities |
| `opportunities.edit` | ✓ | Edit fields and move stages |
| `opportunities.delete` | ✓ | Soft-delete |
| `opportunities.assign` | ✓ | Change owner |
| `opportunities.export` | | Export (audited) |
| — opportunity items | | Follow the parent: view/create/edit/delete an application = the same permission on its opportunity. Ops staff who own an item's processing still need access to the parent. |
| `revenue.view` | ✓ | See service fees, tuition, commission rates and expected revenue (masked otherwise) |
| `revenue.manage` 🟡 | | Record invoices/receipts in the revenue ledger |
| `activities.create` | | Log calls, emails, meetings, messages, notes on records you can see |
| `activities.edit_any` | | Edit/delete others' activities (own are editable for 24h by default) |
| `tasks.view` | ✓ | See tasks (`own` = assigned to me) |
| `tasks.manage` | ✓ | Create, edit, complete, cancel tasks |
| `tasks.assign_others` | | Assign tasks to other users |
| `documents.view` | | See the checklist and file names |
| `documents.upload` | | Upload files |
| `documents.download` | | Download/preview files (audited) |
| `documents.verify` | | Mark requirements verified / rejected / waived |
| `documents.delete` | | Soft-delete files |
| `partners.view` | | See partners and partner panels |
| `partners.manage` | | Create/edit partners and terms |
| `partners.view_commission` | | See commission terms and amounts |
| `organizations.view` / `organizations.manage` | | Organizations |
| `products.manage` | | Products |
| `files.view` | | See the document library, open documents read-only, download any version |
| `files.edit` | | Edit documents in the browser editor |
| `files.manage` | | Upload, rename, move and delete documents. Enforced again by RLS on `library_documents` |
| `invoices.manage` | | Create, edit, send, mark paid and void invoices. Enforced again by RLS on `invoices` / `invoice_lines` |
| `timeoff.request` | | Ask for leave, see and withdraw your own requests |
| `timeoff.manage` | | See everyone's requests, approve or decline, cancel approved leave, enter leave for someone else, manage leave types. Enforced again by RLS on `leave_requests` |
| `timesheets.clock` | | Clock in and out, add your own time by hand, see your own entries |
| `timesheets.manage` | | See, correct, approve and reject everyone's time; needed with `payroll.manage` to pay from timesheets. Enforced again by RLS on `time_entries` |
| `recruitment.manage` | | Create and open jobs, read applicants and their résumés, move, rate, note and delete them. Enforced again by RLS |
| `projects.view` | | See projects and tasks, move your own tasks, time your own tasks |
| `projects.manage` | | Create and edit projects and tasks, assign people, move any task, see everyone's logged time |
| `productivity.view` | | Read the productivity report for everyone. Hours of a kind appear only if you may also see everyone's records of that kind |
| `reviews.view` | | Read customer reviews, the summary and the review links |
| `reviews.manage` | | Create and switch review links, mark reviews read or followed up, keep notes, remove a review |
| `tickets.work` | | See every ticket, create one, reply, add private notes, change status, priority, category and assignee |
| `tickets.manage` | | Switch the public contact form on or off, delete tickets |
| `payroll.manage` | | Authorise a roster for pay, enter tax withheld, release payslips, and read every payslip. Everyone can read their own released payslips without it (RLS on `payslips`) |
| `purchasing.manage` | | See and manage suppliers and their price lists, and place, re-send and cancel orders. Enforced again by RLS on `suppliers`, `supplier_items`, `purchase_orders`, `purchase_order_lines` |
| `inventory.view` | | See stock items, quantities, values and each item's history |
| `inventory.manage` | | Add and edit items, archive them, and record stock changes. Enforced again by RLS on the `inventory_*` tables |
| `employees.manage` | | Hire, see employment records and contracts, send and withdraw offers. Enforced again by RLS on `employees` / `employment_contracts` |
| `employees.view_sensitive` | | See that tax, bank and super details exist and reveal the numbers (each reveal audited). Enforced again by RLS on `employee_payroll_details` |
| `rosters.view` | | See your own shifts on published rosters |
| `rosters.view_all` | | See everyone's shifts on published rosters. Enforced by RLS on `roster_shifts` |
| `rosters.manage` | | Create, edit, publish and delete rosters and shifts; also sees drafts. Enforced again by RLS on `rosters` / `roster_shifts` |
| `reports.view` | ✓ | Dashboards and reports, limited to scope |
| `reports.export` | | Export report data |
| `settings.manage` | | Pipelines, stages, sources, lost reasons, document types, custom fields, labels, branding |
| `users.manage` | | Invite, deactivate, change role/team |
| `roles.manage` | | Edit roles and their permissions |
| `audit.view` | | Audit log viewer and export |

## Default role matrix (seed)

| Permission | Owner/Admin | Sales Manager | Consultant | Ops/Support |
|---|---|---|---|---|
| contacts.view | all | team | own | all |
| contacts.create | ✓ | ✓ | ✓ | |
| contacts.edit | all | team | own | all |
| contacts.delete | all | team | | |
| contacts.assign | all | team | | |
| contacts.view_sensitive | ✓ | ✓ | ✓ | ✓ |
| contacts.import | ✓ | ✓ | | |
| contacts.export | ✓ | ✓ | | |
| opportunities.view | all | team | own | all |
| opportunities.create | ✓ | ✓ | ✓ | |
| opportunities.edit | all | team | own | all |
| opportunities.delete | all | team | | |
| opportunities.assign | all | team | | |
| opportunities.export | ✓ | ✓ | | |
| revenue.view | all | team | own | |
| revenue.manage 🟡 | ✓ | | | |
| activities.create | ✓ | ✓ | ✓ | ✓ |
| activities.edit_any | ✓ | | | |
| tasks.view | all | team | own | own |
| tasks.manage | all | team | own | own |
| tasks.assign_others | ✓ | ✓ | | ✓ |
| documents.view / upload | ✓ | ✓ | ✓ | ✓ |
| documents.download | ✓ | ✓ | ✓ | ✓ |
| documents.verify | ✓ | ✓ | | ✓ |
| documents.delete | ✓ | | | |
| partners.view | ✓ | ✓ | ✓ | ✓ |
| partners.manage | ✓ | | | |
| partners.view_commission | ✓ | ✓ | | |
| organizations.view | ✓ | ✓ | ✓ | ✓ |
| organizations.manage | ✓ | ✓ | | |
| products.manage | ✓ | | | |
| files.view | ✓ | ✓ | ✓ | ✓ |
| files.edit | ✓ | ✓ | ✓ | ✓ |
| files.manage | ✓ | ✓ | | |
| invoices.manage | ✓ | | | |
| timeoff.request | ✓ | ✓ | ✓ | ✓ |
| timeoff.manage | ✓ | ✓ | | |
| timesheets.clock | ✓ | ✓ | ✓ | ✓ |
| timesheets.manage | ✓ | ✓ | | |
| recruitment.manage | ✓ | ✓ | | |
| projects.view | ✓ | ✓ | ✓ | ✓ |
| projects.manage | ✓ | ✓ | | |
| productivity.view | ✓ | ✓ | | |
| reviews.view | ✓ | ✓ | | |
| reviews.manage | ✓ | ✓ | | |
| tickets.work | ✓ | ✓ | ✓ | ✓ |
| tickets.manage | ✓ | ✓ | | |
| payroll.manage | ✓ | | | |
| purchasing.manage | ✓ | | | |
| inventory.view | ✓ | ✓ | ✓ | ✓ |
| inventory.manage | ✓ | ✓ | | |
| employees.manage | ✓ | | | |
| employees.view_sensitive | ✓ | | | |
| rosters.view | ✓ | ✓ | ✓ | ✓ |
| rosters.view_all | ✓ | ✓ | | |
| rosters.manage | ✓ | | | |
| reports.view | all | team | own | |
| reports.export | ✓ | ✓ | | |
| settings.manage | ✓ | | | |
| users.manage | ✓ | | | |
| roles.manage | ✓ | | | |
| audit.view | ✓ | | | |

Examples from the requirements, expressed in this model:
- *"Can view team's leads but not edit"* → `opportunities.view: team`, `opportunities.edit: own`.
- *"Can see reports but not contact details"* → `reports.view: all`, no `contacts.view_sensitive`
  (and optionally no `contacts.view` — reports show aggregates and owner names only).
- *Ops working on another consultant's application* → Ops role has `opportunities.edit: all`
  but no delete/assign/export. Record-level sharing (`record_shares`) is Phase 2 if needed.

## Required tests (tests/db/permissions.test.ts)

- Consultant A cannot list, open, edit, or export Consultant B's contact or opportunity (gets NOT_FOUND).
- Manager sees their team's opportunities, not another team's.
- Consultant without `contacts.view_sensitive` receives DTOs with DOB/passport masked.
- Duplicate check tells Consultant A "exists, owned by B" without returning B's record fields.
- User in tenant A cannot read any tenant B row (see `database.md` §11).
- Deactivated membership → UNAUTHENTICATED/FORBIDDEN on every action.
