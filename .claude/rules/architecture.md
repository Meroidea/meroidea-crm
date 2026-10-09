---
paths:
  - "src/**"
---

# Architecture rules

Full reference: `docs/architecture.md`.

- Modular monolith. One Next.js app. Business logic lives in `src/modules/<module>/`.
- A module exposes: `schemas.ts` (Zod), `queries.ts` (reads), `service.ts` (writes +
  business rules), `actions.ts` (thin `'use server'` wrappers), `components/`, `types.ts`.
- Pages (`src/app/**/page.tsx`) are thin: get context, call module queries, render.
- Modules call each other only through the other module's `service.ts` / `queries.ts`
  exports — never by importing its tables and writing to them directly. (Example: the
  activities module owns the `activities` table; opportunities calls `logSystemActivity()`.)
- Database access is server-side only. Client components receive data as props or call
  Server Actions. No direct Supabase DB queries from the browser.
- Route Handlers (`src/app/api/**`) are only for: webhooks, public web-form intake,
  cron callbacks, file streaming, and (later) the public `/api/v1`.
- UI text that names a CRM object uses the tenant's labels: `labels.contact.singular`,
  never a literal "Student"/"Lead".
- Mobile: every screen must work at 375px. The pipeline board falls back to a
  stage-grouped list on small screens.
