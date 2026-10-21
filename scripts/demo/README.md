# Demo onboarding runbook

One-off scripts that reset Meroidea and set up two example businesses the way the platform
owner would from `/platform`, then hire 11 people into each through the real hiring flow. They
call the app's own services (`createBusiness`, `createDepartment`, `createHire`,
`assignDepartment`, `sendContract`, `acceptOffer`, `submitPayrollDetails`) with inputs parsed by
the same Zod schemas the actions use. Nothing here reimplements business logic.

| File                    | Does                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `reset-businesses.ts`   | Exports, then deletes, every business and the logins left orphaned   |
| `onboard-businesses.ts` | Creates Sydney Cafe & Restaurant and Burwood Educational Consultancy |
| `hire-staff.ts`         | Hires, contracts and accepts 11 people per business                  |
| `data.ts`               | The businesses, people, roles and award classifications              |

## Before you start

Run from the repository root, in a shell whose environment holds the production values. The
scripts read `process.env` only and never print a secret, a link or a token.

Required: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_URL`,
`PLATFORM_ADMIN_EMAILS`, `HR_ENCRYPTION_KEY`, `RESEND_API_KEY` + `EMAIL_FROM` (so contracts and
login emails are really sent), and `FWC_API_KEY` (hire-staff stops without it).

The platform owner (first address in `PLATFORM_ADMIN_EMAILS`, or the one given with `--as`) must
already have a confirmed login. A service agreement must already be published (Platform →
Service agreement), or onboarding stops.

Every command below uses:

```sh
T="npx tsx --tsconfig scripts/demo/tsconfig.json"
```

`scripts/demo/tsconfig.json` maps `@/` to `src/` and `server-only` to an empty module, the same
way the Vitest config does. (`--conditions=react-server` does not work: `next/navigation` then
loads a React build without `createContext`.)

## 1. Reset: export, then delete every business

```sh
$T scripts/demo/reset-businesses.ts --out /tmp/meroidea-export-$(date +%F).json
```

This is a dry run. It prints each business (name, status, id, rows, memberships, stored files)
and the exact `--confirm` value to delete them. Read the list, then:

```sh
$T scripts/demo/reset-businesses.ts --out /tmp/meroidea-export-$(date +%F).json \
  --confirm "<the comma-separated names it printed>"
```

If `--confirm` does not name exactly the businesses found, nothing happens (exit code 2).
Otherwise it prints:

- `Export written and checked: <file>`: every row of every table with a `tenant_id`, each
  tenant row, its people's `users` rows and their logins' basic fields (no password hashes),
  plus copies of its stored files under `<file>.files/`. The file is read back and its row and
  file counts checked before anything is deleted. It is `chmod 600`: it holds personal data and
  encrypted payroll numbers. Move it somewhere safe and delete it when no longer needed.
- `Deleted N rows in one transaction.` Children before parents, ordered from the database's own
  foreign keys.
- `Deleted N of N stored files.` Through the Supabase storage API.
- `Deleted N logins with no membership; kept N platform owner login(s).` Platform owners'
  logins are never deleted.

`--only "Name A,Name B"` limits everything to those businesses.

## 2. Onboard the two businesses

```sh
$T scripts/demo/onboard-businesses.ts
```

Prints `created <tenant id> (restaurant, N features, ABN …)` for each, and whether the
service-agreement link was emailed. A business that already exists by name is skipped. If a
link was not emailed, get it from Platform → the business → Resend agreement link.

| Business                        | Admin                                      | Type          | ABN              |
| ------------------------------- | ------------------------------------------ | ------------- | ---------------- |
| Sydney Cafe & Restaurant        | Sujan Darji, `sujan.contact.214@gmail.com` | `restaurant`  | 51 824 753 556\* |
| Burwood Educational Consultancy | Sujan Darji, `burwood2801@gmail.com`       | `consultancy` | 18 123 456 789\* |

\* Example ABNs that pass the app's checksum. The first is the one the app's tests use; the
second was generated for this (check digits for body `123456789`). Neither is meant to be a
registered business. Each business gets its type's preset features and a clock-in location
(388 George Street, Sydney; 160 Burwood Road, Burwood) with a 100 m radius.

## 3. Human step: each admin accepts the service agreement

Each admin opens the emailed link, reads and accepts the agreement (typing "Sujan Darji"),
then chooses a password. Hiring refuses to start for a business until this is done.

## 4. Hire 11 people per business

```sh
$T scripts/demo/hire-staff.ts            # or --only "Sydney Cafe & Restaurant"
```

Acting as each business's own admin, for each business it creates the departments, then for
each person: looks up the award classification and its minimum in the Fair Work pay database,
creates the hire at a stated margin above that minimum with a start date of next Monday,
assigns the department, sends the contract by email, and accepts it the way the offer page
does (name typed, both boxes ticked), then submits synthetic payroll details. Accepting creates
their Manager or Staff login and emails them their "choose your password" link.

It prints one line per person: position, employment type, pay and how it was derived, login
role, `contract emailed` or `NOT emailed`, and any warnings the app recorded. People whose
email is already on staff are skipped, so it is safe to run again.

It stops, hiring nobody, when `FWC_API_KEY` is missing or a classification cannot be found. A
business still waiting for its agreement is reported and left alone (exit code 3).

**How the contract is really emailed and still accepted.** `sendContract` returns the offer
link only when it could not email it. While the script runs, it wraps `globalThis.fetch`: each
POST to `https://api.resend.com/emails` is read for the `/offer/<token>` link and then forwarded
unchanged, so the email still goes out as written. Without email set up, the link `sendContract`
returns is used instead.

**Synthetic payroll details.** Tax file number left blank (the form allows it), BSB `000-000`,
account `00000000`, account name "<name> (demo data)", super fund "Example Super Fund (demo)",
no member number. The BSB and account are encrypted at rest like real ones.

**Pay.** Restaurant roles use the Restaurant Industry Award 2020 (MA000119), matched on the
grade in the classification's name; consultancy admin roles use the Clerks – Private Sector
Award 2020 (MA000002) by level. Where several classifications match (Clerks Level 2 Year 1 and
Year 2), the highest minimum is used. Education counsellors are treated as award-free
professionals on a salary sized from the Clerks Level 5 rate plus a margin; the app records no
award for them and warns that the national minimum wage still applies. Assumptions to check:
the Restaurant Manager is classified as Food and beverage attendant grade 4 (the award's most
senior floor grade) and the Head Chef as Cook grade 5.

## Rolling back

Nothing restores automatically. The export file from step 1 holds every deleted row as JSON,
keyed by table, and `<file>.files/<bucket>/<path>` holds the stored files. To bring a business
back, re-insert its rows table by table in the reverse of the deletion order (parents first:
`tenants`, then `roles`, `teams`, `tenant_memberships`, …), recreate its people's logins with
the same ids through the Supabase admin API, and re-upload its files to the same paths. Its
people will need to reset their passwords.

To undo steps 2–4, run step 1 with `--only "Sydney Cafe & Restaurant,Burwood Educational
Consultancy"`.
