# Meroidea

An open-source, multi-tenant business platform for small businesses: restaurants, grocery and
retail shops, consultancies and service businesses. One codebase, one login per business, and
each business gets only the features switched on for it.

> **Status: early and under active development.** It runs and is covered by tests, but it has
> not been through an independent security review or a production deployment. Read
> [What it does not do](#what-it-does-not-do) before relying on it.

## What is in it

| Area                    | Features                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sales and customers** | Contacts, organisations, opportunities, a configurable pipeline, follow-up tasks, partners, CSV import, reports                                                                                                            |
| **Customer voice**      | Review links with QR codes and a review inbox; a helpdesk with tickets, a public contact form and a page where customers follow their request                                                                              |
| **People**              | Hiring with employment contracts and one-time signing links, staff directory and departments, recruitment with a public apply page, weekly and fortnightly rosters, time off, clock in/out with an optional location check |
| **Money**               | Invoices, expense claims with receipts, pay runs and payslips from rostered or clocked hours                                                                                                                               |
| **Operations**          | Inventory with a stock ledger, suppliers with spreadsheet price lists, purchase orders                                                                                                                                     |
| **Work**                | Projects, a task board, task timers and a productivity report                                                                                                                                                              |
| **Documents**           | A document library with in-browser editing of Word, Excel, PowerPoint and PDF files (through a self-hosted OnlyOffice server)                                                                                              |
| **Platform**            | A console for the platform owner to onboard businesses, switch features per business, suspend them, and enter one with audited support access                                                                              |

How it is built to keep businesses apart:

- Every table that belongs to a business carries its `tenant_id`, and Postgres row-level security
  enforces isolation in the database itself, not only in application code.
- Every change goes through one path: sign-in check, permission check, input validation, a
  database transaction, and an audit log entry.
- Permission-sensitive code ships with tests that run against a real database, including "another
  business cannot read this" and "a colleague cannot read this" for each module.

The full specification is in [`docs/`](docs/README.md): [architecture](docs/architecture.md),
[database](docs/database.md), [permissions](docs/permissions.md) and the
[decision records](docs/decisions.md) that explain why things are the way they are.

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind · shadcn/ui · Supabase (Postgres, Auth,
Storage) · Drizzle ORM · Zod · Vitest · Playwright.

## Run it locally

You need Node 24 (`nvm use`) and Docker Desktop.

```bash
npm install
npx supabase start          # Postgres, Auth and Storage in Docker
cp .env.example .env.local  # then paste the keys printed by `npx supabase status`
npm run db:migrate
npm run dev                 # http://localhost:3000
```

Then set yourself up as the platform owner:

1. Add your email to `PLATFORM_ADMIN_EMAILS` in `.env.local`.
2. Set `ALLOW_PUBLIC_SIGNUP=true` once, sign up at `/signup` with that email, then remove the
   setting again. Public sign-up is off by default: businesses are onboarded from the console.
3. Open `/platform` to create businesses and choose their features.

Optional pieces, each described in `.env.example`:

- `HR_ENCRYPTION_KEY` — required before storing tax, bank or super details. To rotate it, see
  ADR-040 in [`docs/decisions.md`](docs/decisions.md): the old key goes in
  `HR_ENCRYPTION_KEYS_PREVIOUS` while `/platform` re-encrypts.
- `RESEND_API_KEY` and `EMAIL_FROM` — to send email. Without them nothing is sent, and links
  (contracts, password setup, ticket pages) are shown for you to pass on.
- OnlyOffice — `docker compose -f docker-compose.onlyoffice.yml up -d` for document editing.

## Commands

| Command                                                       | Does                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run dev`                                                 | Development server                                                         |
| `npm run lint` / `npm run typecheck` / `npm run format:check` | Static checks                                                              |
| `npm run test:unit`                                           | Pure logic tests, no database                                              |
| `npm run test:db`                                             | Tests against the local Supabase database (must be running)                |
| `npm test`                                                    | Unit and database tests                                                    |
| `npm run test:e2e`                                            | Playwright against local Supabase (`npx playwright install chromium` once) |
| `npm run db:generate`                                         | Generate a migration from `src/db/schema`                                  |
| `npm run db:migrate`                                          | Apply migrations                                                           |

## Layout

```
src/app          routes: (app) is the signed-in workspace, /platform the owner console
src/modules      one folder per module: schemas, queries, service, actions, components
src/db/schema    Drizzle schema, one file per area
src/server       server-only code: tenant context, database clients, email, storage
src/lib          pure helpers shared by server and client
drizzle          SQL migrations, including every row-level security policy
tests            unit/ · db/ · e2e/
docs             the specification
```

## What it does not do

Being plain about this matters more than a long feature list:

- **It is not legal, tax or payroll advice.** Contract wording is a starting template, not
  lawyer-reviewed. Payslips do not calculate tax, penalty rates, overtime or leave loading; tax
  withheld is typed in. The employment rules it knows about are Australian.
- **The clock-in location check deters, it does not prove.** The position comes from the
  person's own device.
- **Customer reviews are unverified** and are not published anywhere.
- **No incoming email.** Customers reply to tickets on their ticket page, not by email.
- **No accounting ledger, point of sale or online store.**
- **Productivity reports show recorded time and finished work.** Nothing monitors devices.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, follow
[SECURITY.md](SECURITY.md) and please do not open a public issue.

## Licence

[GNU Affero General Public License v3.0](LICENSE). You may use, study, change and share this
software. If you run a modified version as a service that other people use over a network, you
must make your modified source available to them under the same licence.

Copyright © 2026 Meroidea.
