# Lead management — B2B and B2C

How Meroidea captures, qualifies, hands over and converts leads, for businesses that sell to
other businesses (B2B), to individuals (B2C), or both. Decisions and trade-offs are in
[ADR-051](decisions.md#adr-051--lead-management-a-lead-is-a-contact-being-qualified);
tables in [database.md §4a](database.md#4a-lead-management-); permissions in
[permissions.md](permissions.md).

## 1. What a lead is

There is no separate Lead table. **A lead is a contact with a lead status** (`contacts.lead_status_id`
is set). A person can be added as a plain contact or as a lead; the new-contact form ticks
"Add as a lead" by default. Every lead has a **lead type**: `b2b` (selling to a business) or
`b2c` (selling to a person). The business's workflow setting decides which types exist:
B2B only, B2C only, or both side by side.

Labels follow the business (Settings → Fields & labels): "Contact", "Organization" (shown as
Account to B2B teams if they rename it) and "Opportunity" are the tenant's words, never
hard-coded industry terms.

### Lead statuses

Each status has a **kind**, which drives behaviour; the name and colour are the business's.

| Kind | Meaning | Defaults |
|---|---|---|
| `new` | Just arrived, nobody has contacted it | New |
| `working` | Being qualified | Working, Contacted, Engaged, Meeting agreed, Consultation booked |
| `pending_acceptance` | Handed to a sales rep, waiting for their answer (B2B) | Pending acceptance |
| `returned` | The rep sent it back with a reason | Returned |
| `converted` | Became an opportunity | Accepted, Qualified |
| `closed` | Dropped | Not interested, Unresponsive, Disqualified |

**System statuses** (one per kind and lead type) are the ones the system moves leads into:
New on arrival, Pending acceptance on handover, Returned on rejection, Accepted/Qualified on
conversion. They can be renamed but not removed. Statuses marked *requires a reason*
(Not interested, Disqualified) need a disqualification reason and accept a note.

## 2. Configuration (Settings)

Everything below is per business, by an Admin (`settings.manage`), with no code change:

- **Leads tab** — workflow (B2B / B2C / both), whether B2C leads go through the SDR step,
  whether B2C conversion needs approval, SLAs (hours unassigned, hours to first contact, business
  days to accept a handover, days before a lead is "quiet"), the fields that make up the
  completeness score, the fields required before handover, call outcomes, contact roles on an
  opportunity, household relationships.
- **Sources** — sources and their sub-sources; lead statuses; disqualification and rejection
  reasons. Lists are switched off, never deleted, so history keeps its labels.
- **Routing** — intake and handover rules (§4.2).
- **Pipeline** — several pipelines, their stages and each stage's rules (§4.8); lost reasons.
- **Fields** — the business's own fields for contacts, organizations and opportunities (text,
  long text, number, date, yes/no, choice, multi-choice, email, phone, link), required or not,
  shown in lists or not. A field's key never changes once created.
- **Outreach** — email templates and sequences (§4.4).
- **Forms** — website forms (§3.1).
- **Roles** — role templates for a sales team (§6.2).

## 3. Capturing leads

### 3.1 Channels

| Channel | Where | Notes |
|---|---|---|
| Manual | New contact form | Source and sub-source required for a lead; duplicate check as you type |
| Upload | Imports (Excel `.xlsx` or CSV) | One **upload batch** per file (below) |
| Website form | `/f/<key>`, embed, or plain HTML post | Public, no sign-in (below) |
| Events, campaigns | Manual or upload | Campaign / event name kept on the lead |
| Referrals | Manual | Referral source and sub-source (customer, partner, staff) |

**Uploads.** The file is read in the browser (first sheet of a workbook; first row is column
names; up to 10,000 rows, 10 MB). Columns are mapped to contact fields and to the business's own
fields (a choice may be given by its label). One set of choices applies to every row and is kept
on the batch, so it cannot change half-way: import as leads or as plain contacts, lead type,
source, sub-source, campaign or event name, what to do with duplicates (**skip**, **merge** into
the existing record, filling only its gaps, or **create anyway**), and who gets the leads (the
importer, the routing rules, or the unassigned queue). Rows are sent in chunks of 200, each
validated with the same rules as the form and written in one transaction. A required custom
field missing from the file does not reject the row (it is a gap to fill later); a value that is
there is still checked. Each row's outcome (created, merged, skipped, created despite a duplicate,
error with the column at fault) is stored on the batch; the report page lists them and downloads
as CSV. Reasons name the column, never the value. When the upload finishes, each person who
received leads gets one notice with the count. Every lead keeps its batch (shown on the contact
page with who added it and when).

**Website forms.** The business's admin builds each form (Settings → Website forms → New form,
`/settings/forms/<id>`; needs `settings.manage`):

- **About the form:** its name for the team, the lead type, source and sub-source its leads get,
  the heading and introduction visitors see, the button text and the thank-you message.
- **Fields:** the questions, in order. Each has its own wording, optional help text, and can be
  required or not. The admin picks from the standard contact fields (name, email, phone, city,
  state, preferred language, company, job title, company website and size, industry, interest,
  message, marketing consent) and from the business's own contact fields. **New question** makes
  a new contact field (short or long answer, choose one, choose several, tick box, date, number,
  email, phone, web address) and puts it on the form, so every answer is saved on the lead and can
  be searched, filtered, routed and reported on. Nothing is kept only on the form.
- **Rules:** a required first name, and a required email or phone so the team can reply; each
  field once; at most 30. They are checked when the form is saved and again when it is published.
- **Preview:** the form exactly as visitors will see it, beside the builder, updating as it is
  edited. It cannot be sent.
- **Draft and published:** a new form is a draft, and nobody outside the team can open or post to
  it. **Save and publish** puts it live; saving a published form changes it live; **Take offline**
  turns it back into a draft. A question whose contact field is switched off later drops out of
  the live form, and the form cannot be published again until it is removed.

Once published, a form has an unguessable key and three ways to use it: the hosted page
(`/f/<key>`), an iframe embed (`?embed=1`), or a plain HTML form posting to `/api/forms/<key>`
(it redirects back to the hosted thank-you page; the builder's **Copy HTML form** writes it with
the form's own fields and choices). UTM tags on the page address (`utm_source`, `utm_medium`,
`utm_campaign`, `utm_term`, `utm_content`) travel with the enquiry; `utm_campaign` becomes the
campaign name.

Answers are checked against the form as built, and problems come back against each field in the
form's own words. A new person becomes a New lead, routed by the intake rules using what the form
asked (state, industry, company size, language, interest), or left in the queue, in which case the
form's creator is told. The same person writing again, found by email (or by phone on a form that
asks no email), does not make a duplicate: the enquiry is added to their timeline, their owner is
told, and the answers fill only fields that were blank; nothing on file is overwritten, and an
earlier yes to marketing is never taken away. The enquiry on the timeline shows the message and
every other answer. Fields the form does not ask for are dropped even if a script sends them.
Every submission is kept as received in `lead_intake_events`. Protection: a honeypot field, 5
submissions per sender per hour, 300 per form per hour, a 32 KB body limit, and nothing in the
answer reveals whether the person was already known.

### 3.2 Source and sub-source

Both are required for a lead (the sub-source when the source has any) and both are the
business's lists. Defaults:

- Manual entry
- Marketing — workshop, expo or seminar, Meta ads, Google ads, email campaign
- Data upload — LinkedIn, Instagram, purchased or partner list, other import
- Website — contact us, feedback, enquiry or landing page, live chat
- Referral — existing customer, partner or agent, staff referral
- Walk-in — walk-in, inbound call
- Partner, Social media, Import, Other

A sub-source always belongs to its source (enforced by a composite foreign key).

### 3.3 What a lead holds

Identity (name, email, phone, job title, LinkedIn, language), company (name, website, size,
industry) for B2B, location, interest, source / sub-source / campaign / UTM tags / upload batch,
created by and when, owner, consent (marketing consent with its source and date, do not email,
do not call), and the business's own fields.

### 3.4 Duplicates and merging

A new or uploaded person is checked against the whole business on **email**, **phone**, **a
similar name with the same date of birth**, and **a similar name at the same company**. The
search runs in a security-definer function, so it sees every record; the person is shown the
match only if their scope covers it, otherwise just who owns it. On the form the choice is: open
the existing record, **merge** these details into it, or **create anyway**.

Two existing records are merged from the contact page's **Possible duplicates** card
(`contacts.merge`, and edit access to both). The kept record takes the other's details only where
it has none (email with its normalised form, phone likewise, source with its sub-source as a
pair); privacy choices take the stricter answer (do not email / do not call / do not contact),
and the most recent consent answer stands. Timeline, tasks, opportunities and their contact
roles, organizations, household links, sequences, website submissions, support tickets and
reviews move to the kept record; links that would repeat are dropped; a sequence running on both
keeps one run. The other record is soft-deleted, and both get an audit entry.

## 4. B2B workflow

### 4.1 The lead queue

`/leads` has views: **Mine** (owned or handed to me), **Unassigned**, **Awaiting acceptance**,
**Returned**, **Overdue** (no first contact within the SLA, or a handover past its deadline) and
**All**, filtered by status, source, type and owner. Each row shows the completeness score and an
overdue flag. Bulk assignment needs `contacts.assign`.

### 4.2 Routing

A lead is assigned by hand (the form's owner field), by the **routing rules**, or left
**unassigned** in the queue (needs `contacts.assign` with all scope). Rules apply at **intake**
(new leads) and at **handover** (choosing the rep). Each rule has conditions (lead type, source,
sub-source, country, region, industry, company size, language, interest; empty means any), a
method (**round robin** or **least loaded**: fewest open leads) and a pool of people or a team.
The first matching active rule in order wins; the rule row is locked while choosing, so two leads
arriving together are not both given to the same person by round robin. Support seats and
inactive people are never chosen. With no matching rule a manual lead stays with whoever added
it, and a website lead goes to the queue. The new owner is notified (in the app and by email).

### 4.3 Enrichment

The lead's company fields are filled in by hand. The **completeness** score (0–100 %) counts the
fields the business chose; it shows in the queue and on the lead.

### 4.4 Outreach

- **Email from the CRM** — written or from a template with merge fields
  (`{{contact.first_name}}`, `{{contact.last_name}}`, `{{contact.company}}`, `{{user.name}}`,
  `{{business.name}}`; unknown fields become empty). Sent from the platform's address under
  "<person> at <business>", replies go to the sender's own inbox, logged on the timeline. Refused
  for do-not-email, do-not-contact or erased people. 200 per person per day.
- **Calls** — logged in two clicks with an outcome from the business's list.
- **Tasks**, and **sequences**: a named list of steps (day, type, title, optional template);
  starting one creates its tasks, due at 9am on their day in the business's timezone, for the
  lead's owner or a chosen person. Stopping cancels the open ones.
- The first outbound call, email, meeting or message records **first contacted** and moves a New
  lead to the first Working status.

### 4.5 Handover to a sales rep

The SDR/BDR hands a qualified lead to a rep (chosen, or by the handover routing rules) with a
summary, an optional meeting date and the business's required fields filled. The lead becomes
**Pending acceptance**; the SDR is kept as **originator**, the rep sees the lead, and the
acceptance deadline is set in business days (Monday to Friday).

### 4.6 Accept or return

The rep (or someone with assign rights over them) **accepts** — converting the lead (§4.7) — or
**returns** it with a reason from the business's list and an optional note. A returned lead goes
back to the originator in the Returned status. Past the deadline, the rep, the originator and the
people who can assign leads are alerted (§6.4). Acceptance rates are in the reports (§7).

### 4.7 Conversion

Accepting creates or links an **organization** (the account). Existing organizations with the
same name or website domain are offered; creating a new one when a match exists needs
confirmation. The contact is linked with a **contact role** (decision maker, influencer, user…)
and an **opportunity** is opened in the B2B pipeline, owned by the rep, carrying the lead's
source, sub-source, campaign and originator. The lead becomes Accepted.

### 4.8 Pipelines

A business can have **several pipelines** (for example one per product line, or one for B2B
and one for B2C), each with its own stages. The board has a pipeline switcher; an opportunity can
only move between stages of its own pipeline. Each stage can have:

- a **stage owner** (a person or a team, round robin within the team) who, on entry, is
  notified, made the owner, or given a task;
- **required fields** (value, expected close date, product, next step, or the business's own);
- a **checklist** that must be done before moving forward (moving back is always allowed);
- **approval**: someone without `opportunities.approve` moving into it creates a request that a
  manager in scope approves (moving it) or declines.

Lost needs a lost reason. Won can hand the opportunity on as a task to a stage owner. Every move
is in the stage history (time in stage is reported), and stages can mark opportunities as quiet
after a number of days (§6.4).

## 5. B2C workflow

### 5.1 Routing
B2C leads use the same intake routing (§4.2), usually straight to whoever will sell.

### 5.2 Optional SDR step
With "B2C leads go through the SDR step" on, B2C leads use the B2B handover (§4.5–4.6).

### 5.3 Households and groups
People can be linked as a household or group (parent, child, partner, sibling, guardian…; the
business's list), shown on each person's page.

### 5.4 Direct conversion
Without the SDR step, a B2C lead is converted directly into an opportunity in the B2C pipeline,
owned by whoever converts it or someone they may assign to. With "B2C conversion needs approval"
on, the lead is instead **submitted for approval** to a chosen person (or by the handover routing
rules): it waits as Pending acceptance with the same deadline and alerts as a handover, and the
approver accepts (converting it) or returns it with a reason.

## 6. Cross-cutting

### 6.1 Configurability
See §2. Nothing about a vertical is in code: words, stages, statuses, reasons, sources and fields
are the business's.

### 6.2 Roles
Admin (`owner`), Manager and Staff exist in every business (ADR-048). Settings → Roles adds roles
from **templates** for a sales team — SDR / BDR, Sales Rep, Customer Relations, Stage staff,
Read-only — or from scratch, each permission with its scope (own / team / all). A lead is visible
to its owner, its originator and the rep it was handed to, each within their own scope; anything
outside scope reads as "not found".

### 6.3 Timeline and audit
A contact's timeline shows calls, emails, meetings, messages, notes, enquiries, status changes,
assignments, handovers and decisions, conversions, merges and approvals, plus field changes from
the audit log (field names only; values can be personal data). Every change is in `audit_logs`.

### 6.4 Notifications and SLAs
Notices appear under the bell and on `/notifications`; important ones are also emailed. Emails
never contain the lead's details, only that something is waiting and a link. Nobody is notified
about their own action.

`app.sweep_lead_alerts` checks a business's SLAs and writes alerts, each with a dedupe key so it
lands once:

| Alert | Who | Email |
|---|---|---|
| Leads unassigned longer than the SLA (one summary a day) | People who can assign leads (all scope) | Yes |
| No first contact within the SLA | The owner | Yes |
| Handover past its deadline | The rep, the originator, the people who can assign leads | Yes |
| Lead quiet for N days (again after new activity goes quiet) | The owner | No |
| Opportunity quiet past its stage's limit | The owner | No |
| Task gone overdue (last 7 days) | The assignee | No |

It runs from the app (after a page is sent, at most every 15 minutes per business) and daily from
Vercel Cron (`/api/cron/lead-alerts`, 20:40 UTC, authorised by `CRON_SECRET`). Alert emails are
claimed (`emailed_at`) before sending, so two runs never send the same one; emails for notices
already read or older than 48 hours are not sent.

### 6.5 Privacy
- Consent: marketing consent with its source and date, do not email, do not call, do not contact.
  A website form can record a new "yes" but never removes an earlier one.
- **Erase personal data** (`contacts.anonymize`, Admin): for a request to be forgotten. Clears
  name (shown as "Erased"), email, phone, address, date of birth, job title, LinkedIn, language,
  interest, the business's own fields and notes; redacts the text of calls, emails, meetings,
  messages, notes and enquiries and the wording of tasks; erases the stored website submissions,
  the support-ticket requester's name and email, what they wrote on their tickets (and the first
  message when staff logged a request for them; staff replies are kept) and the review's name and
  email; and masks the values (not the fact) of past changes in the audit log. Any record merged
  into theirs is erased the same way, since a merge keeps it. The record stays, marked
  do-not-contact, so opportunities and reports still add up. It cannot be undone and is audited.
- Multi-tenant isolation as everywhere (ADR-001): every table has `tenant_id` and row-level
  security; the lead tables also switch off with the CRM feature.

## 7. Reports and export

**Reports → Leads** (`reports.view`, within its scope), over 30 / 90 / 365 days:

- SLA tiles as things stand: unassigned past the SLA, no first contact in time, handovers past
  their deadline, quiet leads (each opens the matching lead view).
- Funnel of leads captured in the period: captured → contacted → qualified (handed over or
  converted) → converted → won.
- By source and sub-source: leads, contacted, qualified, converted, won, closed, conversion rate.
- SDR / BDR performance, by whoever worked the lead first: leads, contacted, average time to first
  contact, share within the SLA, handed over, accepted, returned, acceptance rate.
- Sales rep handovers, from the timeline events in the period: received, accepted, returned,
  acceptance rate, average time to decide, waiting now, past deadline now.
- Why leads were closed (disqualification reasons) and why handovers were returned.
- Leads by owner as they stand today, by status kind.

**Reports → Sales** keeps the opportunity reports: funnel, sources and win rate, by owner (rep
performance), time in stage, follow-up discipline, activity, lost reasons.

**Export.** Report tables download as CSV with `reports.export`. The leads list exports as CSV
with `contacts.export`, using the current view and filters and the viewer's scope (up to 5,000
rows; never dates of birth). Every export is audited.

## 8. Not included yet

These need an outside account or service first:

- Two-way sync with Gmail or Microsoft 365 mailboxes, and email open/click tracking.
- Automatic call logging from a phone system.
- Automatic enrichment from a data provider (company size, industry, LinkedIn).
- WhatsApp and SMS outreach.

Today email is sent from the CRM and logged; calls and enrichment are entered by hand.
