# Sign-up, Provisioning & Onboarding

How a company becomes a Meroidea workspace, and how its people get in. This is the flow the
marketing site promises, so it is core product, not a Phase 3 extra (ADR-021).

```
meroidea.com (marketing)
        │  Start free
        ▼
 1. Create account        email + password (Supabase Auth), email verification
        │
 2. Tell us about the company   name · industry · team size · country/timezone/currency
        │
 3. Provisioning (one transaction)
        │   tenant + slug · industry template · owner membership · default team
        │   trial started · welcome email
        ▼
 4. Admin dashboard  ──►  setup checklist: brand it · shape the pipeline · invite the team · import
        │
 5. Invitations      ──►  branded email, one-time link (7 days)
        ▼
 6. {slug}.meroidea.app   the company's own branded entry page — never the Meroidea marketing site
        │   accept invite → set password → land in their workspace
        ▼
 7. Daily use, scoped by the role the admin chose
```

---

## 1. Create account

- Email + password via Supabase Auth (SSO later). Public sign-up is **open** on the marketing
  site; it is still closed inside existing workspaces, where only admins add people.
- Email verification is required before **invitations can be sent** or billing starts. The
  workspace itself is created straight away so the founder isn't left waiting.
- Abuse control: rate limit sign-ups per IP, block disposable-domain sign-ups, and cap
  unverified workspaces to a single seat.

## 2. Company profile (the questions that shape the workspace)

| Field | Stored as | Used for |
|---|---|---|
| Company name | `tenants.name` | Branding, emails, workspace title |
| Workspace address | `tenants.slug` | `{slug}.meroidea.app`, invite links |
| Industry / what the company does | `tenants.industry` | **Chooses the starting template** |
| Team size | `tenants.settings.teamSize` | Plan suggestion, seat default, onboarding copy |
| Country / timezone / currency | `tenants.default_country`, `timezone`, `default_currency` | Dates, money, phone parsing |
| How they work today (spreadsheet, another CRM, nothing) | `tenants.settings.migratingFrom` | Import prompts in the checklist |

Slug rules: lowercase, 3–40 chars, `[a-z0-9-]`, generated from the company name, collision gets
a numeric suffix, and a **reserved list** (`app`, `www`, `admin`, `api`, `help`, `status`,
`mail`, `billing`, `support`, `docs`, `blog`, `meroidea`…) is refused. Changing a slug later is
an admin action that keeps the old one redirecting for 30 days.

## 3. Provisioning

`provisionTenant(input)` runs with `adminDb` in **one transaction** — if any step fails, no
half-built workspace is left behind:

1. `tenants` row (name, slug, industry, locale settings, `status = 'trialing'`).
2. Apply the **industry template** (§3.1).
3. `users` row (if new) + `tenant_memberships` row with the system `owner` role, status `active`.
4. Default team named after the company; owner is its manager.
5. `tenant_subscriptions` row: plan `trial`, 14 days, no card required.
6. Optional sample data if the user ticks "add example records so I can look around" —
   tagged `is_sample = true` so **Settings → Remove sample data** deletes it in one click.
7. Audit entry `tenant.provisioned`, welcome email queued.

### 3.1 Industry templates

A template is a JSON pack in `src/lib/templates/`, versioned in code and applied as ordinary
tenant data — never as special-cased logic:

```
template = {
  labels:        { contact, opportunity, opportunityItem, organization, product },
  pipelines:     [{ name, objectType, stages[] }],
  leadSources:   [...], lostReasons: [...],
  documentTypes: [{ name, level, isRequired }],
  customFields:  [{ entityType, key, label, fieldType, options }],
  roles:         [owner, manager, member, support] + default scopes,
  sampleData:    optional
}
```

Shipped templates: **General business** (default), Education agency, Real estate, Recruitment,
Clinic/practice, Professional services. Picking one is a starting point, not a lock-in — every
label, stage and field stays editable, and an admin can switch template later (new objects are
added; nothing is deleted).

## 4. Admin dashboard — the CEO's first screen

Opens on a **setup checklist** with progress, each item deep-linking into settings:

1. Add your logo and brand colour → the workspace and its emails start looking like the company.
2. Check your pipeline stages → template stages shown, editable inline.
3. Add the fields you track → suggested fields from the template.
4. **Invite your team** → §5.
5. Import your contacts → CSV/Excel wizard.
6. Add billing → only needed before the trial ends.

Beyond the checklist the admin area holds: people & roles, teams, pipelines & stages, custom
fields, labels, document types, lead sources, branding, import/export, billing & seats, audit
log, and workspace settings (timezone, currency, data retention).

## 5. Inviting people

- Admin enters email(s), picks a **role** (which carries permission scopes) and an optional
  **team**; bulk paste and CSV are supported.
- Seat check runs first: at the seat limit, the invite is blocked with a clear upgrade path.
- An `invitations` row is created with a **hashed** single-use token, 7-day expiry.
- The email is sent by our transactional provider, **branded for the company** (their logo,
  their colour, "Sarah invited you to join *Company A* on Meroidea"), and links to
  `https://{slug}.meroidea.app/invite/{token}`.
- Admin can resend (rate-limited) or revoke; the list shows invited / accepted / expired.

### Accepting

1. Link opens the **company's branded page**, not the Meroidea marketing site.
2. Token is validated: exists, unexpired, unrevoked, unused. Failures show a "ask your admin to
   resend" page — never a message that reveals whether an email is registered.
3. The person sets a password (or signs in if they already have a Meroidea account, e.g. staff
   at two workspaces), accepts terms, and the membership flips to `active`.
4. They land in **their workspace**, scoped by the role the admin chose, with a short tour.
5. `invitations.accepted_at` set, audit entry `membership.accepted`.

## 6. The company's own front door

Every workspace answers on its own address; the Meroidea marketing site never appears to a
member of a workspace:

| Stage | Address | Notes |
|---|---|---|
| MVP | `{slug}.meroidea.app` | wildcard DNS + TLS; slug resolved in `proxy.ts` |
| Fallback | `meroidea.app/w/{slug}` | for environments without wildcard support |
| Later | `crm.companya.com` | custom domain via CNAME + verification, higher plan |

The entry page shows the company's logo, name and brand colour, a sign-in form, and password
reset — plus a discreet "Powered by Meroidea" that white-label plans can remove. Branding is
read from a small cached lookup (slug → id, name, logo, colour, status), so an unknown or
suspended slug renders a neutral page and never leaks another tenant's data.

## 7. Billing

- Stripe Checkout for subscription, Customer Portal for card/invoice self-service (ADR-024).
- 14-day trial, no card. Trial end: read-only mode for 14 days, then export-only, with reminder
  emails at day 3, 1 and 0 — nothing is deleted.
- Plan entitlements are enforced server-side from `tenant_subscriptions`: seats, pipelines,
  features (partners/commissions, white-label, API), storage.
- `/api/webhooks/stripe` (signature-verified) keeps status, seats and period end in sync.

## 8. Emails

Transactional email moves into Phase 1 because invitations are the product's front door.

- Sent through our own provider (Resend or SES) on a verified domain with SPF, DKIM and DMARC —
  **not** Supabase's built-in mailer, which is rate-limited and can't carry tenant branding.
- Auth links are generated server-side (`auth.admin.generateLink`) and delivered in **our**
  templates so every email carries the workspace's branding and address.
- Templates: welcome, invitation, invitation reminder, password reset, email verification,
  seat/plan notices, trial reminders. All logged with `message_id` for support.

## 9. Data model additions

See `database.md` for columns. New tables: `invitations`, `tenant_subscriptions`,
`plan_entitlements` (code-defined), `reserved_slugs` (code-defined), plus
`tenants.industry`, `tenants.status` (`trialing | active | past_due | suspended | cancelled`),
`tenants.onboarding` (checklist state jsonb) and `is_sample` flags on seeded demo rows.

## 10. Open questions

1. Does self-serve sign-up open publicly at launch, or stay invite-only while we pilot?
   (Recommended: invite-only for the first weeks, same code path, a feature flag.)
2. Card required to start the trial, or after? (Recommended: after — fewer abandoned sign-ups.)
3. Can one person belong to several workspaces with one login? (The data model already allows it.)
4. Who else besides the owner can invite — managers within their team?
5. Does the workspace need SSO (Google/Microsoft) at launch, or is email + password enough?
6. What happens to a workspace that cancels: export window, then delete after how long?
