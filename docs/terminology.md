# Terminology

The core uses these words in code, schema, and docs. Tenants can rename any object in the
UI via `tenants.labels`, but the **code name never changes**.

| Code name | Meaning | Education label (seed) | Real-estate label (example) |
|---|---|---|---|
| **Tenant** | A company using the CRM. All data belongs to exactly one tenant. | — | — |
| **User** | A person who can sign in. Global; joins tenants via memberships. | Staff | Agent |
| **Membership** | A user's seat in one tenant, with a role and optional team. | — | — |
| **Role** | Named bundle of permissions with scopes (Owner, Consultant, …). | — | — |
| **Team** | Group of memberships led by a manager. Drives `team` scope. | Branch / Team | Office |
| **Contact** | A person we sell to or work with. There is **no separate Lead object**. | Student | Buyer / Renter |
| **Organization** | A company/institution. Can be a partner, an institution, or a B2B client. | Institution / Agency | Agency / Developer |
| **Opportunity** | One sales journey for a contact, moving through a pipeline. Holds the direct fee. | Case | Deal |
| **Opportunity item** | One specific thing pursued inside an opportunity, with **its own status track** and its own value (e.g. commission). Points at an organization and optionally a product. | Application (to one institution, course, intake) | Offer (on one property) |
| **Pipeline** | An ordered set of stages, for either opportunities or opportunity items. A tenant can have several. | Study Abroad (cases) · Applications (items) | Sales / Rentals |
| **Stage** | One step in a pipeline. Category is `open`, `won`, or `lost`. | e.g. Consultation Booked | e.g. Inspection |
| **Lost reason** | Why an opportunity ended in a `lost` stage. | Visa refused, Chose competitor | Finance fell through |
| **Lead source** | Where a contact/opportunity came from (Facebook, Walk-in, Partner…). | — | — |
| **Partner** | An organization that refers business to us and may earn commission. | Sub-agent / Referral partner | Referral agency |
| **Product** | What is being sold or placed. Optional on an opportunity (e.g. service package) and on an item (e.g. course). `type` distinguishes them. | Service package · Course | Service · Property listing |
| **Revenue** | Money expected/received. Direct (`opportunities.amount`, e.g. service fee) and item-level (`opportunity_items.expected_revenue`, e.g. institution commission). | Service fee · Commission | Fee · Commission |
| **Activity** | Something that **happened**: call, email, meeting, message, note, or a system event. Immutable history. | Interaction | — |
| **Task** | Something that **should happen**: a follow-up with an assignee and due date. | Follow-up | — |
| **Document type** | A kind of file a tenant tracks (Passport, Transcript). | — | Contract, ID |
| **Document requirement** | A checklist item on an opportunity: type + status (pending/received/verified/rejected/waived). | Checklist item | — |
| **Document** | An uploaded file. May satisfy a requirement. | — | — |
| **Custom field** | Tenant-defined field on Contact/Opportunity/Organization/Product. | Preferred country, IELTS score, Intake | Budget, Bedrooms |
| **Library document** | A Word, Excel, PowerPoint or PDF file in a business's shared library, with every saved version kept. Distinct from *Document* (a file attached to a contact or opportunity checklist). | — | — |
| **Invoice** | A numbered bill to a customer: draft, then sent, then paid or void. Cannot be edited once sent. | — | — |
| **Payslip** | One employee's pay for one authorised roster period: draft until released, then visible to that employee and fixed. | — | — |
| **Supplier** | A business the workspace buys from, with a price list, delivery days and an ordering lead time. | — | — |
| **Purchase order** | A numbered order to one supplier for one delivery date, sent through that supplier's order channel (email today). | — | — |
| **Inventory item** | Something the workspace keeps in stock, with a running quantity on hand in a unit of the tenant's choosing. | — | — |
| **Stock movement** | One change to an item's quantity: received, used, wasted, a correction, or a stocktake. Never edited or removed. | — | — |
| **Employee** | A person the workspace has hired or offered work to. Not a login: an employee may never sign in. | — | — |
| **Department** | A named group of employees. The tenant decides what it stands for: department, division, site. | — | — |
| **Employment contract** | The terms offered to an employee, frozen once sent and accepted through a one-time link. | — | — |
| **Roster** | A week or a fortnight of planned shifts for the workspace. A draft until published. | — | — |
| **Shift** | One person's planned block of work on a roster, with a break and an optional free-text tag. | — | — |
| **Owner** | The user responsible for a contact or opportunity. Drives `own` scope. | Consultant | Agent |
| **Scope** | How far a permission reaches: `own`, `team`, or `all`. | — | — |

## Words to avoid in code

| Don't write | Write |
|---|---|
| lead (as a table/type) | contact (+ opportunity in the first stage) |
| deal, case (as a table/type) | opportunity |
| application, offer, submission (as a table/type) | opportunity item |
| course, package | product |
| customer, student, client, prospect | contact |
| account, company, university, agency | organization |
| note, log, interaction, communication | activity (type `note`, `call`, …) |
| reminder, follow-up (as a table) | task |
| agent (for referrers) | partner |
| status (for pipeline position) | stage |

"Lead" is still fine as **UI copy** and in report names ("Leads by source" = opportunities
created in a period, grouped by source) — it is just not a data object.
