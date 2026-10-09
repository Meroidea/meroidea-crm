---
paths:
  - "src/db/**"
  - "drizzle/**"
  - "src/modules/**/queries.ts"
  - "src/modules/**/service.ts"
---

# Database rules

Full reference: `docs/database.md`. Update it in the same change as any schema change.

## Table checklist (every tenant-owned table)

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id)` — first column after `id`
- `unique (tenant_id, id)` so child tables can use composite FKs
- References to other tenant-owned rows use **composite FKs**:
  `foreign key (tenant_id, contact_id) references contacts (tenant_id, id)`.
  This makes a cross-tenant reference impossible at the database level.
- References to users go through memberships:
  `foreign key (tenant_id, owner_user_id) references tenant_memberships (tenant_id, user_id)`
- `created_at`, `updated_at` (timestamptz, default now()); `created_by`, `updated_by` where
  a human creates the row; `deleted_at` for business records (contacts, organizations,
  opportunities, activities, tasks, documents, partners, products).
- Indexes lead with `tenant_id`. Partial indexes use `where deleted_at is null`.
- RLS enabled + the standard tenant policy in the same migration (see `docs/database.md` §RLS).
- **Grants in the same migration too.** A policy alone leaves `authenticated` with no privileges,
  because `auto_expose_new_tables` is off: `grant select, insert, update, delete on <table> to
  authenticated` (narrower where the table is read-only to users, e.g. `tenants`).

## Queries

- User-driven reads/writes: `withRls(ctx, (tx) => …)` only.
- Always filter explicitly by `tenant_id = ctx.tenantId` even though RLS also does —
  RLS is the safety net, not the query planner's hint.
- Apply record scope with `scopeFilter(ctx, 'opportunities.view', table)`.
- Add `isNull(table.deletedAt)` unless deliberately reading deleted rows.
- Lists use keyset (cursor) pagination, default page size 50. No unbounded `select *`.
- Multi-step writes run in one transaction; the `audit()` insert is inside that transaction.

## Custom fields

- Stored in the entity's `custom_fields jsonb not null default '{}'`, keyed by
  `custom_field_definitions.key`. Never create an EAV value table.
- Validate with the Zod schema built by `buildCustomFieldSchema(definitions)` on every write.
- Definition `key` is immutable once created. Deactivate, don't delete.

## Migrations

- `npm run db:generate` after editing `src/db/schema/*`; review the SQL before committing.
- RLS policies, SQL functions, triggers, pg_cron jobs: `npx drizzle-kit generate --custom --name=<name>`.
- Never edit a migration that has been applied anywhere. Write a new one.
- Destructive changes (drop/rename column) need a two-step migration and explicit approval.
