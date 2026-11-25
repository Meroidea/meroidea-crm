"""The narration, scene by scene: the single source of truth for voice and animation cues.

Numbers are written as words so the narrator reads them naturally. Every claim is backed by
SYSTEM_AUDIT.md (repository counts) or the ABS figure cited there.
"""

VOICE = "en-AU-WilliamNeural"
RATE = "+0%"

SCENES = [
    {
        "id": "s01",
        "module": "scene_01_problem",
        "cls": "Problem",
        "text": (
            "Every small business runs on a tangle. Leads in a spreadsheet. Customers in a shared "
            "inbox. The roster on a whiteboard, timesheets on paper, invoices in a template, and "
            "the real story in someone's WhatsApp. Every hand-off between them loses context, and "
            "every lost context costs money."
        ),
    },
    {
        "id": "s02",
        "module": "scene_02_solution",
        "cls": "Solution",
        "text": (
            "Meroidea pulls it into one place. One login. One record of every customer and every "
            "staff member. One database, hosted in Sydney. Each business gets its own sealed "
            "workspace, and the platform switches on only the features that business needs. "
            "There are twenty-six of them today."
        ),
    },
    {
        "id": "s03",
        "module": "scene_03_architecture",
        "cls": "Architecture",
        "text": (
            "Isolation isn't a promise in our code; the database enforces it. Every table carries "
            "a tenant ID behind row-level security, so Postgres itself refuses another business's "
            "rows. Every change passes the same eight gates: authenticate, resolve the tenant, "
            "check permission and scope, validate, apply business rules, commit, audit, and "
            "refresh. Nothing writes around it."
        ),
    },
    {
        "id": "s04",
        "module": "scene_04_crm",
        "cls": "Crm",
        "text": (
            "Sales starts with capture: web forms, imports, referrals and social channels. Imports "
            "flag duplicates by email and phone, and let you skip, merge or create each one. "
            "Routing rules hand leads out round robin, or to the least-loaded rep. On the board, "
            "every stage carries a win probability, so the weighted forecast is simple arithmetic: "
            "each deal's value times its stage probability, summed. And MeroAI suggests the next "
            "best action, which a person approves before anything changes."
        ),
    },
    {
        "id": "s05",
        "module": "scene_05_people",
        "cls": "People",
        "text": (
            "People are where most CRMs stop. Meroidea keeps going. Admins, managers and staff "
            "each see exactly their scope: their own records, their team's, or everything. Rosters "
            "cost themselves live against the award, with weekend and public-holiday loadings. "
            "Approved timesheets flow into payslips. And one rule is built in: nobody signs off "
            "their own pay."
        ),
    },
    {
        "id": "s06",
        "module": "scene_06_finance",
        "cls": "Finance",
        "text": (
            "Work runs from My Day: overdue, due today, upcoming. Documents live in a private "
            "library, with versions and in-browser editing. Money is kept honest by a double-entry "
            "ledger that only the database can write, so every entry balances to the cent. And "
            "above it all, an executive dashboard: open pipeline, weighted forecast, win rate, and "
            "a live audit trail of who changed what."
        ),
    },
    {
        "id": "s07",
        "module": "scene_07_inbox",
        "cls": "Inbox",
        "text": (
            "Customers reach a business everywhere, so the inbox meets them there. Facebook, "
            "Instagram, WhatsApp, TikTok, email and live chat arrive in one conversation list, "
            "matched to the right contact. AI drafts the reply. A person sends it."
        ),
    },
    {
        "id": "s08",
        "module": "scene_08_moat",
        "cls": "Moat",
        "text": (
            "Our moat is configuration over customisation. The same core becomes a migration "
            "agency's case board or a restaurant's catering pipeline, just by changing labels, "
            "stages and fields. No developer quote required. Underneath: one hundred and twelve "
            "tables, one hundred and ninety-six security policies, eighty-five permissions and one "
            "hundred and thirteen test files. All Australian-hosted, and exportable on request."
        ),
    },
    {
        "id": "s09",
        "module": "scene_09_vision",
        "cls": "Vision",
        "text": (
            "Australia has more than two point seven million actively trading businesses, and "
            "nearly a million of them employ staff. Most still run on that tangle. Meroidea is the "
            "one platform they can grow into. Built in Sydney. Ready to scale. Let's build it "
            "together."
        ),
    },
]
