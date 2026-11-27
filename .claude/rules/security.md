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

- `public.users.email` is a profile copy. Anything that decides who a login is (password links,
  linking a hire to an existing login, platform owners) reads the verified email from Supabase
  Auth (`auth.users` / `auth.admin.getUserById` / `auth.getUser()`), never `public.users` (ADR-059).
- Security headers live in `next.config.ts`: no page may be framed by another site except website
  forms (`/f/*`), and pages whose address carries a one-time secret send no referrer.
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
- Response targets (ADR-069):
  - Only the `tickets_sla` trigger and `app.sla_sweep` write the SLA columns of `tickets`. Never
    grant them to sessions. Application code passes only the ADR-037 fallback `response_due_at`,
    which the trigger replaces whenever a policy applies. Keep `first_response_at` set once, by
    the trigger, to the moment it happens.
  - `app.business_add` / `app.business_minutes_between` refuse a signed-in person outside the
    hours' business; keep that check if they change.
  - SLA notices name the ticket number and the target, never its subject or what the customer
    wrote.
  - A ticket's channel reply goes through `replyToConversation`, which needs `social.reply` and
    the channel's own checks. A ticket from a conversation never sends an email.
  - Following up a customer's message (matching, tickets) runs in a savepoint after the message
    is stored, so a failure there never loses the message.

## Platform owners (ADR-029)

- `/platform` and every platform action call `requirePlatformAdmin()` / `assertPlatformAdmin()`
  first. Identity is the verified auth user; the allowed emails come only from the server-side
  `PLATFORM_ADMIN_EMAILS`. Non-owners get "not found".
- `src/modules/platform/service.ts` may use `adminDb` because it works across businesses. Every
  change to a business writes a row to that business's `audit_logs` with `actor_type = 'platform'`.
- Deleting a business (ADR-056) is `deleteBusiness` in `src/modules/platform/service.ts` only: the
  business must already be suspended, its name typed exactly, and every row goes in one
  transaction ordered by the database's foreign keys, with a `platform_audit_logs` row. Never
  delete a platform owner's login, or one that belongs to another business.
- Never add a way to read a business's data that skips membership. Support access is a real,
  visible membership (`is_support`) so RLS keeps applying; remove it when the owner leaves.
- A new permission family must be mapped to its feature in `src/lib/features.ts` and in
  `app.permission_feature`, or the feature switch will not hide it. A table owned by one feature
  gets a restrictive `feature_switch` policy (ADR-038).

## Service agreement and business identity (ADR-047)

- A business's name, legal name, ABN and primary contact are written only by
  `src/modules/platform/service.ts`. Never add them to a schema a business's own user submits.
- Nobody sets or sees a business admin's password, the platform owner included. The admin
  accepts the service agreement through a one-time link, then chooses a password via ADR-031.
- `src/modules/platform/agreement-public.ts` may use `adminDb`. It starts from the link's hash,
  never takes a tenant or record id from the caller, and clears the hash once accepted.
- Never grant `authenticated` the `token_hash`, `accepted_ip` or `accepted_user_agent` columns
  of `tenant_agreements`. Published `service_agreements` rows are never updated.
- A business in `awaiting_agreement` is closed to its own people in `requireTenantContext` and
  `authedAction`, exactly like `suspended`.

## Questions and concerns (ADR-049)

- A question sent to the admin only must never reach a manager (managers cannot see pay). That
  rule lives in the RLS policies on `concerns` / `concern_messages`; never read them through
  `adminDb` or widen `concerns.handle` to cover them.
- A question may link only the asker's own released payslip; keep both the service check and the
  insert policy. A manager answering never gets the payslip itself, only that one is linked.
- What a question says never goes into `audit_logs`, emails or logs. Notification emails say only
  that a question is waiting.
- Nobody can change what was asked, to whom or about which payslip (column grants). The asker may
  set only `open` or `resolved`.

## Training (ADR-050)

- The right answers to quiz questions live only in `training_question_keys`. Never select them in
  a query a learner's page uses, never send them to the browser outside the module editor, and
  never mark answers anywhere but `app.submit_training_module`.
- Results (`training_completions`) are written only by that function; keep `authenticated`
  without insert or update grants on the table.
- Writing or assigning training needs `training.manage`; a learner sees a course only when it is
  published and assigned to them, enforced by RLS.

## Bookkeeping (ADR-060)

- Only the `app.ledger_*` functions write `ledger_entries` and `ledger_lines`. Never grant
  `authenticated` insert, update or delete on them, never write them through `adminDb`, and never
  weaken the balance, immutability or lock-date checks.
- Entries posted from an invoice or payslip change only through that document. Call the hooks in
  `src/modules/books/hooks.ts` inside the document's own transaction.
- Entries from payroll stay `payroll = true` and hidden without `books.view_payroll`. Never show
  pay amounts from the books in a query that skips RLS.

## Social inbox (ADR-064)

- `src/modules/social/webhooks.ts` (and `key-rotation.ts`, for platform owners) are the only social
  code that may use `adminDb`. Store a Meta event only after `verifyMetaSignature` passes on the raw
  bytes. Never store a TikTok notification's content: it only names a conversation to read again
  through TikTok's API with the account's own token.
- Account tokens are sealed with `encryptField` and live only in `social_account_credentials`,
  which `authenticated` has no grants on. Read and write them through the `app.social_*`
  functions; never log them, put them in a URL (send them in headers or bodies), or return them to
  the browser.
- Connecting Meta and TikTok runs only through the state cookie check in
  `/api/social/oauth/[provider]`, as the signed-in person with `social.manage`; the code is never
  logged or redirected onwards. WhatsApp's Embedded Signup returns its code to the page instead
  (below).
- One live business per account (`social_accounts_live_key`): never relax it, or one business's
  customers' messages could reach another.
- Message content never goes into `audit_logs`, logs or error messages.
- Realtime (ADR-065): broadcasts carry ids only, never content; the browser re-reads through
  RLS. Channels are private `social:<tenant>`, joined only through `app.social_channel_allowed`.
  Never broadcast to a public channel or put a message's words in a payload.
- Media go into the private `social-media` bucket only through `src/modules/social/media.ts`:
  https, the platforms' media hosts, redirects checked at each hop, size cap, leading bytes
  matched to an accepted type. Never fetch an address from a payload any other way, and serve
  files only through `/api/social/media` and `/api/social/avatar` (permission check, one-minute
  link).
- A TikTok notification whose signature fails is treated as unsigned, never as verified; read
  receipts need a valid signature.
- WhatsApp (ADR-066):
  - Connecting runs through Embedded Signup and `connectWhatsAppAction` (`social.manage`). The
    account and number ids come from the browser: trust them only after the business's own new
    token finds that number in that account (`findWhatsAppNumber`).
  - Meta's SDK loads on Connected accounts only, after a click. Never load it anywhere else.
  - The number's two-step PIN is sealed in the credentials row and never shown or logged.
  - WhatsApp media are fetched only through `media.ts`. The token goes only to Meta's file
    hosts, checked at every redirect; never pass it to `downloadMedia` for any other host.
  - History imported from the WhatsApp Business app never opens the 24-hour window: keep
    `opensWindow: false` for anything older than the connection.
- Files in replies (ADR-067):
  - Only through `startMediaUpload` (a ticket for a path under
    `{tenant}/social/{conversation}/outbound/` that the server chose) and `sendMediaReply`.
  - `sendMediaReply` re-checks the path prefix, the leading bytes and the platform's type and
    size, and deletes what it refuses. Never send a path the browser made up.
  - Meta gets a ten-minute signed link to that one object, never a longer or broader one.
- An assignment notice never contains what the customer wrote.
- Inbox foundations (ADR-068):
  - Private notes are `social_messages` with `direction = 'note'`. Every customer-facing read
    (email, live chat, any public page) must exclude them. Keep `social_messages_note_author` and
    never add `body` to the update grants.
  - Account settings are written only through `app.social_set_account_settings` (`social.manage`).
    Never grant the `settings` column to sessions.
  - The presence channel `social-presence:<tenant>` carries ids and a typing flag only. Never put
    a draft, a note or a message in a presence payload.
  - Matching a sender to a contact links exactly one match, never the first of several, and never
    overrides `contact_match = 'manual'`. A lead made from a channel stores the conversation id,
    never the message.

## Email inbox (ADR-070)

- `/api/webhooks/resend` reads nothing before `verifyResendSignature` passes on the raw bytes
  (Svix: `id.timestamp.body`, HMAC-SHA256 with the key after `whsec_`, five minutes). Keep the
  body cap and the 500-on-failure (Resend retries); storing is idempotent on Resend's email id.
- Only `src/modules/social/webhooks.ts` writes received email, `email_message_id` and
  `email_meta`, through `adminDb` after the signature check. Never grant those columns to
  sessions: `email_meta.verified` decides whether a sender may be linked to a contact.
- An email's From address can be forged. Link a sender to a contact, or make them a lead, only
  when Resend reports DKIM or DMARC `pass`; otherwise only offer the match.
- A message joins a thread by its reply token or Message-ID **and** only when it comes from that
  thread's customer. Never relax that, or anyone could write into another customer's thread.
- Received HTML is reduced to text and shown as text; never render an email's HTML. Outgoing
  bodies are escaped (`emailHtml`).
- Reply tokens are 24 random characters from `newReplyToken`; never derive them from ids.
- Attachment links are fetched only through `media.ts`, from `inbound-cdn.resend.com`; a file
  from anywhere else is refused.
- Nothing an email says goes into logs, audit rows or error messages.
- The Email area's "Not a customer" rules (ADR-073) only sort threads into Filtered; they never
  stop an email being received or stored. Keep `created_by = auth.uid()` on insert and no update
  grant, and never put the address in an audit row.

## Knowledge base (ADR-071)

- `src/modules/kb/public.ts` is the only knowledge base code that may use `adminDb`. It starts
  from the business's slug and serves only an open business with the feature on, an open portal,
  and published, live articles. It never takes a business, article or contact id from a visitor.
- Article Markdown is rendered only through `Markdown` (`skipHtml`, react-markdown's URL filter,
  https-only pictures without a referrer). Never add `rehype-raw` or render an article's HTML.
- Drafts are for `kb.manage` only, in RLS as well as in queries. Never widen `kb_articles_read`.
- A tracked link carries a random token; only its sha256 is stored. The token never names a person
  or record, and the page drops it from the address bar after reporting the read.
- A linked read counts only when the token, the business and the article all match and the link is
  live. Reads are reported from the browser, so mail scanners that do not run scripts are not
  counted; they can still count where they do.
- The portal's public routes keep their size caps, Zod parsing, honeypot and per-sender limits.
- Erasing a person deletes their `kb_article_views` and `kb_article_links`.

## Electronic signatures (ADR-089)

- `src/modules/esign/public.ts` is the only esign code that may use `adminDb`. It starts from the
  signer's link hash and never takes a tenant, request or signer id from the caller; field ids are
  checked against that signer's own fields.
- The browser never sends a PDF. Stamping reads the pinned original from storage and refuses it
  unless its SHA-256 matches `original_sha256`. Keep the last signature and the stamping in one
  transaction, and remove uploaded images if it fails.
- Never grant sessions `token_hash`, `otp_*`, `session_hash`, `signed_ip` or `signed_user_agent`
  on `sign_request_signers` for reading, or any write to `signed_*`, `completed_at`,
  `declined_at`, field values or signers' events. Keep the insert policies that require those
  columns empty and the `sign_requests_guard` trigger; `/verify` is only as trustworthy as they are.
- Codes: 6 digits from `crypto.randomInt`, stored only as the keyed hash, 10 minutes, 5 tries,
  send limits per signer and per connection. A right code opens a session only through the
  HttpOnly `msign_*` cookie whose hash matches. Never weaken any of these or accept a code
  without the cookie step.
- A signing link is shown to staff only when it could not be emailed. Never log it, store it, or
  put a signer's details in a URL; `/sign/*` and `/api/esign/sign/*` send no referrer and are kept
  out of the request log.
- Signature images are accepted only as PNGs (header checked, size and dimensions capped), stored
  under `{tenant}/esign/{request}/`, and only paths under that prefix are read back for stamping.
- pdf.js loads only through `PdfPages` (worker from our own origin, `isEvalSupported: false`, no
  XFA). Never load it, or its worker, from a CDN.

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
- Accepting an offer creates the login chosen at hire through `src/modules/access/hire-login.ts`
  (ADR-048), which may use `adminDb`. It is called only after the acceptance is committed, with
  ids read from the link's own contract. Choosing a login at hire needs `users.manage` as well as
  `employees.manage`, and the Admin (`owner`) role is never given this way.

## Audit

Call `audit()` inside the transaction for: create/update/delete/restore of business records,
owner changes, stage changes, permission/role/user changes, settings changes, exports,
imports, and document downloads.

Reading `audit_logs` needs `audit.view` (policy `audit_read`, ADR-063). A feature that needs part
of the log without that permission gets a `security definer` function returning only that part
(as `app.record_field_changes` returns field names, never values); never widen the policy and
never read the log through `adminDb` in a request.
