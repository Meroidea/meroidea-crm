"""The narration, scene by scene: the single source of truth for voice and animation cues.

v2: problem → outcome. Every feature named here exists in the codebase (see SYSTEM_AUDIT.md):
one inbox for Facebook/Instagram/WhatsApp/email/live chat (ADR-064–073), sender-to-contact
matching and lead routing (ADR-051, ADR-068), pipeline + weighted forecast + MeroAI next actions
(ADR-074), My Day, one-click Instant build rosters over trading hours (ADR-076, ADR-079), award
costing (ADR-043), timesheets → payslips (ADR-044/046), invoices drafted from a sentence and
overdue chasing (ADR-077), ledger posted from invoices and payroll with GST/P&L/Balance Sheet
(ADR-060), Own/Team/All scopes and the audit trail, per-business features and labels (ADR-029).
"""

# Kokoro-82M voice. af_heart is the model's highest-graded voice (A); for a male narrator use
# am_michael or am_fenrir (graded C+), or bm_george for British English.
VOICE = "af_heart"
SPEED = 1.1

SCENES = [
    {
        "id": "s01",
        "module": "scene_01_problem",
        "cls": "Problem",
        "text": (
            "Monday. Nine a.m. Three missed calls. Forty unread messages. A roster that doesn't add "
            "up, and an invoice nobody sent. Sound familiar? Most small businesses still run on "
            "spreadsheets, sticky notes and memory."
        ),
    },
    {
        "id": "s02",
        "module": "scene_02_solution",
        "cls": "Solution",
        "text": (
            "Meroidea replaces the pile with one workspace. Customers, sales, staff, rosters, "
            "payroll, invoices and the books. All connected. One login. Shaped around how your "
            "business already works."
        ),
    },
    {
        "id": "s03",
        "module": "scene_03_inbox",
        "cls": "Inbox",
        "text": (
            "Never miss a customer again. Facebook, Instagram, WhatsApp, email and website chat all "
            "land in one inbox. Each message is matched to the right customer, new leads go to the "
            "right person, and a reply is drafted, ready to send."
        ),
    },
    {
        "id": "s04",
        "module": "scene_04_sales",
        "cls": "Sales",
        "text": (
            "Your pipeline shows every deal, and exactly where it's stuck. Drag a deal forward, and "
            "the forecast updates instantly. Meroidea even tells you who to call next, and why."
        ),
    },
    {
        "id": "s05",
        "module": "scene_05_myday",
        "cls": "MyDay",
        "text": (
            "Follow-ups, reminders and overdue tasks arrive on one screen, called My Day. Nothing "
            "slips through the cracks."
        ),
    },
    {
        "id": "s06",
        "module": "scene_06_team",
        "cls": "Team",
        "text": (
            "Next week's roster? One click. Shifts fit your trading hours, every cost is checked "
            "against the award, and staff get their shifts on their phones. Clock-ins become "
            "approved timesheets, and timesheets become payslips."
        ),
    },
    {
        "id": "s07",
        "module": "scene_07_money",
        "cls": "Money",
        "text": (
            "Type, invoice Acme for forty catering boxes, and the invoice drafts itself. Overdue? "
            "The reminder is written for you. And every payment flows straight into your books, "
            "with GST, profit and loss, and the balance sheet always up to date."
        ),
    },
    {
        "id": "s08",
        "module": "scene_08_control",
        "cls": "Control",
        "text": (
            "Everyone sees exactly what they should. Staff, their own work. Managers, their team. "
            "Owners, everything. And every change is recorded, so you always know who did what."
        ),
    },
    {
        "id": "s09",
        "module": "scene_09_anybusiness",
        "cls": "AnyBusiness",
        "text": (
            "A restaurant. A migration agency. A retail shop. Meroidea shapes itself to each one, "
            "with its own stages, fields and words. Switch on what you need today, and grow into "
            "the rest."
        ),
    },
    {
        "id": "s10",
        "module": "scene_10_close",
        "cls": "Close",
        "text": (
            "Australia has more than two point seven million businesses, and most are still buried "
            "in the pile. Meroidea gives them one workspace to run their business. Built in Sydney. "
            "Ready to scale."
        ),
    },
]
