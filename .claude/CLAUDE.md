# Meroidea — Project Rules

**Meroidea** is a configurable, multi-tenant CRM platform. It is industry-neutral by design:
the marketing site and the core code sell and model a pipeline, not a vertical. An industry
only appears *after* sign-in, from the tenant's own configuration — labels, pipeline stages,
custom fields, document types and roles.

**One platform, features switched on per business (ADR-029, replacing parts of ADR-021 and
ADR-025).** Meroidea is run by its owner as a service for client businesses: restaurants,
grocery stores, retail shops, education and migration consultancies, and small service
businesses. Every feature is built into the one codebase, and the platform owner switches on the
ones each business needs (`tenants.features`, catalogue in `src/lib/features.ts`). Inside a
business, roles and scopes then decide what each person sees.

**Onboarding is done by the platform owner, not by self-serve sign-up.** After a meeting, the
owner creates the business and its first admin login in the platform console (`/platform`),
chooses its features, and hands the login over. That admin adds staff and sets the business up
their own way. Businesses never see each other. The platform owner can list every business,
change its features, suspend it, and enter it through audited support access.

A permission whose feature is switched off counts as not granted, in `loadTenantContext` and in
the database (ADR-038). A new feature must add its permission family to `src/lib/features.ts`
and to `app.permission_feature` (new migration), and each table it alone owns gets a
restrictive `feature_switch` policy.

Target clients, by configuration and never by forking code: restaurants, grocery stores, retail
shops, education and migration consultancies, small service businesses.

## Source of truth

Read the relevant doc before working on a module. If code and docs disagree, stop and ask.

- `docs/README.md` — index of the Technical Architecture Specification v1.0
- `docs/product-requirements.md` — what the business needs
- `docs/terminology.md` — **use these words exactly** (Contact, Opportunity, …)
- `docs/architecture.md` — layers, folder structure, request flow, API conventions
- `docs/database.md` — every table, column, index, FK, RLS policy
- `docs/permissions.md` — permission catalog, scopes, default role matrix
- `docs/decisions.md` — why things are the way they are (ADRs)
- `docs/roadmap.md` — milestones and what is explicitly out of scope
- `blanxer_ui_design.md` + `docs/design-system.md` — colour palette and UI rules

## Stack (do not add to it without explicit approval)

Next.js (App Router) · TypeScript strict · Tailwind · shadcn/ui · Lucide · Supabase
(Postgres, Auth, Storage, pg_cron) · Drizzle ORM + Drizzle Kit · Zod · React Hook Form ·
TanStack Table · dnd-kit · Recharts · Papa Parse · Vitest · Playwright.
TanStack Table and Recharts are approved but not installed yet: add them when a screen first
needs them, not before.

One separate service is approved: OnlyOffice Document Server, for editing documents (ADR-030).

Never introduce: microservices, Redis, GraphQL, tRPC, Prisma, Redux/Zustand, TanStack
Query, Kafka/queues, Elasticsearch/Meilisearch, a second database, or a second migration
tool. Ask first before adding **any** runtime dependency.

Framework versions move fast. Before using a Next.js, Supabase, Drizzle, Tailwind, or
shadcn API, check the installed version in `package.json` and its current docs — do not
rely on memory (e.g. Next 16 renamed `middleware.ts` to `proxy.ts`).

## Non-negotiable rules

1. **Tenant isolation.** Every tenant-owned table has `tenant_id uuid not null`. Every
   query on tenant data runs through `withRls(ctx, …)` (see `docs/architecture.md`).
   The privileged `adminDb` client is only for migrations, seeds, cron, and verified
   webhooks — never in a request path that acts on behalf of a user.
2. **Every mutation** goes through `authedAction()` / a module service, which does, in
   order: authenticate → resolve tenant context → check permission + record scope →
   Zod-validate input → business rules → DB transaction → `audit()` → revalidate.
   Server Actions are public HTTP endpoints; a page-level check does not protect them.
3. **Never hardcode industry words** ("Student", "University", "IELTS") in core code or
   schema. Industry specifics live in seed/config: labels, pipeline stages, custom fields.
4. **Record scope** (own / team / all) is applied with the shared `scopeFilter()` helper
   — never re-implemented inline.
5. **Secrets** (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, integration tokens) only in
   files that `import 'server-only'`. Only `NEXT_PUBLIC_*` values may reach the browser.
6. **Schema changes** only via Drizzle schema + `drizzle-kit generate`. Hand-written SQL
   (RLS policies, functions, triggers) goes in `drizzle-kit generate --custom` migrations.
   Never edit an applied migration. Never change the cloud database by hand.
7. **Every new table** gets RLS enabled in the same migration that creates it.
8. Money is `numeric(14,2)` + `currency char(3)`. Timestamps are `timestamptz` (UTC),
   rendered in the tenant's timezone. IDs are `uuid`.
9. Soft delete (`deleted_at`) for business records; queries exclude deleted rows by default.
10. Use synthetic data only (`@example.com`). Never commit real student data.

## Working style

- Work one milestone (see `docs/roadmap.md`) or one module at a time. Small, reviewable diffs.
- Permission-sensitive code ships with tests (Vitest against the local Supabase DB, not mocks).
  A cross-tenant read and a cross-owner read must each have a failing-access test.
- Update the relevant doc in the same change when you change a table, permission, or convention.
- Commands: `npm run dev`, `npm run lint`, `npm run typecheck`, `npm run format:check`,
  `npm test` (= `test:unit` + `test:db`), `npm run test:e2e`, `npm run db:generate`,
  `npm run db:migrate`, `npx supabase start`. `npm run db:seed` arrives with milestone 2.
