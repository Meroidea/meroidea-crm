---
paths:
  - "src/**"
  - "drizzle/**"
---

# Security rules

This CRM stores passports, transcripts, dates of birth and contact details. Treat every
change as touching sensitive personal data.

## Authentication

- Supabase Auth only. Never store passwords, hash passwords, or build sessions.
- On the server, trust `supabase.auth.getClaims()` / `getUser()` — never `getSession()`
  (its contents come from a cookie and are not verified).
- Public sign-up is disabled. People are added by an admin (`src/modules/access`, guarded by
  `users.manage`), who never sets or sees a password: the person gets a one-time link
  (`/auth/confirm` → `/set-password`) to choose their own. The link is emailed when email is set
  up; otherwise it is shown once to the admin and never stored.
- "Forgot password" always answers the same way, whether or not the address has a login.
- Deactivating a membership removes access at once (`loadTenantContext` needs `status = 'active'`)
  and keeps the person's history. A person cannot deactivate themselves.

## Authorization (every mutation and every sensitive read)

1. `getTenantContext()` → `{ userId, tenantId, membershipId, roleKey, permissions, teamIds }`.
   Throws `UNAUTHENTICATED` if no valid session, `FORBIDDEN` if no active membership.
2. `requirePermission(ctx, key)`; for records also `assertCanAccess(ctx, key, record)`.
3. Zod-parse all input. Never spread raw input into an insert/update.
4. Return `NOT_FOUND` (not `FORBIDDEN`) for records outside the user's scope — don't leak existence.

## Data exposure

- `src/server/**` and every `service.ts`, `queries.ts`, `actions.ts` start with `import 'server-only'`
  (actions files use `'use server'` which implies server, but still never import admin clients into them).
- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` may be public.
- Every table has RLS enabled with no `anon` policies. Supabase exposes the `public` schema
  over its REST API with the public key — a table without RLS is a public data leak.
- Select only the columns a view needs. Sensitive fields (DOB, passport number, document
  files) require `contacts.view_sensitive` / `documents.download`.
- Never put personal data in URLs, query strings, logs, or error messages.

## Files

- Storage bucket `documents` is private. No storage policies for `anon`/`authenticated`.
- Uploads: server checks permission, then issues a signed upload URL for a server-chosen
  path `{tenant_id}/{entity_type}/{entity_id}/{uuid}`. Client-supplied paths are never trusted.
- Downloads: server checks permission, writes an audit row, returns a signed URL valid ≤ 60s.
- Validate MIME type and size server-side (allow-list: pdf, jpg, png, webp, heic, docx; ≤ 15 MB).
- The document library (`src/modules/files`) accepts docx, xlsx, pptx and pdf only, and checks
  the file's leading bytes match its extension after upload; a mismatch is deleted from storage.
- The two editing-service endpoints under `src/app/api/documents/` have no session. Never relax
  their signature checks, and never fetch a callback's file from an address other than the
  editing service's own (ADR-030).

## Public endpoints (webhooks, web forms)

- Verify signatures (e.g. Meta `X-Hub-Signature-256`) before any DB write.
- Web forms: per-form secret key, honeypot field, rate limit, Zod validation.
- Store the raw payload in `lead_intake_events` for replay/audit; process idempotently on `external_id`.

## Recruitment (ADR-034)

- `src/modules/recruitment/public.ts` is the only recruitment code that may use `adminDb`. It
  starts from the job's token, serves only open jobs, and writes only a new application.
- Applicant details and résumés need `recruitment.manage`; every résumé download is audited.
- Never email or expose whether an address has already applied.

## Reviews and helpdesk (ADR-036, ADR-037)

- `src/modules/reviews/public.ts` and `src/modules/helpdesk/public.ts` are the only code in
  those modules that may use `adminDb`. Each starts from a token and never takes a business,
  review or ticket id from the caller.
- The customer's ticket page must never return `is_internal` messages or staff identities
  beyond a display name.
- Every public intake route keeps its honeypot, size limit, Zod parse, per-form hourly cap and
  per-sender limit (ADR-039). Read bodies with `readJsonBody` / `readFormBody`
  (`src/server/request.ts`), never `request.json()` after a `Content-Length` check: a chunked
  request declares no length. Count senders with `enforceRateLimit` (`src/server/rate-limit.ts`),
  which stores only a keyed hash of the address.

## Platform owners (ADR-029)

- `/platform` and every platform action call `requirePlatformAdmin()` / `assertPlatformAdmin()`
  first. Identity is the verified auth user; the allowed emails come only from the server-side
  `PLATFORM_ADMIN_EMAILS`. Non-owners get "not found".
- `src/modules/platform/service.ts` may use `adminDb` because it works across businesses. Every
  change to a business writes a row to that business's `audit_logs` with `actor_type = 'platform'`.
- Never add a way to read a business's data that skips membership. Support access is a real,
  visible membership (`is_support`) so RLS keeps applying; remove it when the owner leaves.
- A new permission family must be mapped to its feature in `src/lib/features.ts` and in
  `app.permission_feature`, or the feature switch will not hide it. A table owned by one feature
  gets a restrictive `feature_switch` policy (ADR-038).

## Location (ADR-033)

- A business's coordinates are set only through the platform console. Never accept them from a
  business's own users.
- The clock-in position comes from the client: validate it with Zod, use it only to measure the
  distance, and store the distance in metres, never the coordinates. Do not log positions.
- Any new way to record worked time must apply the same location rule or be manager-only.

## Employment and payroll data

- Tax file numbers, bank and super member numbers are stored only as ciphertext via
  `encryptField()` (`src/server/crypto.ts`). Never log them, put them in URLs, or select the
  ciphertext columns unless you are about to decrypt for an audited reveal.
- Reading them requires `employees.view_sensitive`; every reveal calls `audit()` first.
- Keys rotate without downtime (ADR-040): retiring keys go in `HR_ENCRYPTION_KEYS_PREVIOUS`,
  re-encryption runs from `/platform`, and only then is the old key removed. Never decrypt with
  a key that is not configured, and never overwrite a value that failed to open.
- The new hire's one-time link path (`src/modules/hiring/public.ts`) is the only place outside
  provisioning that may use `adminDb` in a request. It must start from the link's hash and never
  accept a tenant or record id from the caller (ADR-026).

## Audit

Call `audit()` inside the transaction for: create/update/delete/restore of business records,
owner changes, stage changes, permission/role/user changes, settings changes, exports,
imports, and document downloads.
