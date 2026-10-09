# Product Requirements

Condensed from the business concept document. Terminology per `terminology.md`.

## 1. Context

We run an education consulting business based in **Sydney, Australia**: Sales Consultants
take prospective students (onshore and offshore) from first contact to enrolment at
institutions in Australia and overseas. Each student can apply to **several universities/colleges**.
We earn **both** service fees from students and commissions from institutions. We need a
Salesforce-style CRM, scaled to basic–intermediate, built so that it can grow without a rebuild.

**Secondary goal (6–12 months):** resell the CRM to other businesses. Terminology, pipeline
stages, and fields must be configurable per tenant, not hardcoded to education.

## 2. Objectives

1. Consultants get an organized daily workspace for their contacts, opportunities and tasks.
2. Owners get full visibility into every consultant's pipeline and activity without chasing people.
3. Lean and affordable to build and run.
4. Architecture ready for: multi-tenancy, relabelling for other industries, advanced features
   (automation, AI lead scoring, integrations).

## 3. Roles

| Role | Access | Phase |
|---|---|---|
| Owner / Admin | Everything, all consultants, all reports, settings | 1 |
| Sales Consultant | Own contacts/opportunities/tasks only (configurable) | 1 |
| Sales Manager | Their team's records and reports | 1 (role exists; teams UI may be simple) |
| Support / Ops | Document handling and application processing, task-based | 1 (seed role) |
| Partner (external) | Read-only view of opportunities they referred | 3 |

Permissions must support rules like "can view team's records but not edit" and "can see
reports but not contact details". See `permissions.md`.

## 4. Modules

### A. Contacts & lead capture
- Capture from: manual entry, web form, referral, walk-in, partner, CSV/Excel import; later social ads.
- Store contact details, source, interest (via custom fields: preferred country/course/intake).
- Assign to a consultant (owner). Reassignment is audited.
- **Duplicate detection** on create and import: same email or phone → strong warning showing the
  current owner; similar name + same DOB → soft warning. Duplicates are warned, not blocked
  (families often share a phone/email).

### B. Pipeline / opportunity tracking
- Kanban board per pipeline, filterable by owner, source, partner, date. List view too.
- Default education stages: New Lead → Contacted → Consultation Booked → Consultation Done →
  Application in Progress → Application Submitted → Offer Received → Enrolled (won) /
  Lost (lost, reason required).
- Stage changes are recorded with timestamps (time-in-stage, conversion reports).
- Stages are fully editable per tenant (names, order, colours, won/lost category, stale threshold).

### B2. Applications (opportunity items)
- One opportunity (the student's case) holds **many applications**, each to one institution
  for one course and intake.
- Each application has its own status track, configurable per tenant. Education default:
  Preparing → Submitted → Conditional Offer → Unconditional Offer → Offer Accepted →
  CoE Issued → Enrolled (won) / Rejected (lost) / Withdrawn (lost) / Deferred (open).
- An application reaching a milestone can move the case forward automatically (e.g. first
  "Submitted" application → case moves to "Application Submitted"), never backwards.
- Per application: institution, course, intake, campus, onshore/offshore, tuition fee,
  commission rate, expected commission, institution's application/student IDs.
- Institutions see many students; students apply to many institutions — both views exist
  (institution page lists all its applications).

### C. Tasks & activity
- Tasks: call / email / meeting / follow-up / other, with assignee, due date, priority.
- "My Day": overdue, due today, upcoming; overdue tasks flagged.
- Activity timeline per contact and opportunity.

### D. Communication log
- Every touchpoint (call notes, email summary, meeting notes, WhatsApp/Viber/Messenger
  message summary) is an activity: timestamped, attributed, visible on the record's timeline.

### E. Documents
- Upload/store files per contact or opportunity.
- Checklist per opportunity from configurable document types: pending / received / verified /
  rejected / waived. Verification records who and when.

### F. Reporting & dashboards
- Leads (opportunities created) per consultant
- Conversion rate by stage (funnel)
- Leads and win rate by source
- Follow-up compliance (tasks done on time; open opportunities with a next step scheduled)
- Time-in-stage and currently-stuck opportunities
- CSV export (permission-gated, audited)

### G. Notifications
- In-app notification centre: task due soon, task overdue, new assignment, stale opportunity
  (no activity in X days, configurable per tenant and per stage).

### H. Admin settings
- Invite / deactivate users; assign roles and teams.
- Edit pipelines and stages, lead sources, lost reasons, document types.
- Custom fields on contacts, opportunities, organizations, products.
- Rename objects (labels) and set branding (logo, primary colour).
- Audit log viewer and export.

### I. Partners (resale / B2B referral model)
- A partner is an organization that sends us contacts/opportunities.
- When an opportunity's source is a partner, it carries `partner_id` and the opportunity page
  shows a **Partner panel** (partner, their reference number, commission terms).
- Partner page: all referred opportunities, conversion, expected and earned commission.
- Partner terms say what their share is based on: our institution commission, our service
  fee, both, or a fixed amount per enrolment.
- Phase 2: commission ledger (pending → approved → paid) for revenue sharing.

### J. Revenue (both streams)
- **Service fees** charged to the student — on the case (opportunity), optionally from a
  service package product.
- **Institution commissions** — per application: typically tuition fee × commission rate,
  often paid per study period after census date, sometimes with bonuses.
- MVP: expected revenue per case = service fee + expected commission of the best live application
  (a student enrols at one institution — applications are alternatives, not additive);
  pipeline value, weighted forecast, and revenue by institution / consultant / partner / source.
- Phase 2: revenue ledger — expected → invoiced → received per instalment (per term), write-offs,
  refunds; partner payables calculated from what was actually received. Invoicing and GST stay in
  the accounting system (Xero integration later), not rebuilt in the CRM.
- Multi-currency: AUD default; UK/Canada institutions may pay in GBP/CAD. MVP reports total per
  currency; FX conversion to AUD in Phase 2.

## 5. Stated wishes that shape the roadmap

- Leads should come in automatically from social media ads (Meta Lead Ads) — Phase 2.
- Mass upload of medium–large lead lists, then clean-up (dedupe/merge) — import in MVP, merge in Phase 2.
- Email/calendar integration "would be really good to have" — BCC logging address early,
  full Gmail/Outlook sync later (see `decisions.md` ADR-014).
- Business users must manage configuration themselves, without a programmer.
- Resale in 6–12 months → tenant isolation is built from day one, not retrofitted.

## 6. Non-functional

- Low starting cost, pay-as-you-grow hosting.
- Sensitive personal data: access control, private storage, audit, backups.
- Mobile-friendly for consultants.
- We own the code and data (no no-code lock-in).

## 7. Decisions and open questions

### Answered (2026-09-11)
| Question | Answer | Effect |
|---|---|---|
| Where does the business operate? | Sydney, Australia | Tenant default `Australia/Sydney`, AUD, AU phone parsing; hosting in Sydney (Supabase `ap-southeast-2`, Vercel `syd1`); Australian Privacy Act / APPs apply (see `architecture.md` §14) |
| Opportunity per journey or per application? | Students apply to multiple universities/colleges | Opportunity = student case; **opportunity items = applications**, each with its own status track (ADR-018) |
| Revenue source? | Both service fees and institution commissions | Fee on the opportunity, commission on each application; ledger in Phase 2 (ADR-019) |

### Still open
1. Initial number of consultants and 12-month growth?
2. Who verifies documents — consultants or ops staff?
3. Which channels do students actually use (WhatsApp, Viber, Messenger, WeChat, phone)?
4. Are service fees charged in stages (e.g. deposit + balance on visa grant)? Affects the Phase 2 ledger.
5. Do sub-agent partners send one student at a time, or batches? (Batches → bulk import with partner preset.)
6. Budget and build model (in-house with Claude Code assumed).
7. Australian education-agent rules have been tightening (e.g. around commissions for onshore
   students changing providers). Confirm current obligations with your advisor; the data model
   records onshore/offshore status per application so reporting and commission eligibility can follow the rules.
