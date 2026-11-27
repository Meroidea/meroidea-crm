"""Vertical reel (TikTok / Instagram Reels / Facebook Reels), 1080x1920, about 50 s.

Hook in the first two seconds, burned-in word-by-word captions (most feeds play muted), and only
claims the codebase supports:
- one platform: CRM, social inbox, rosters, timesheets, payslips, invoices, books (SYSTEM_AUDIT.md §6)
- Australia: award pay rates from the Fair Work pay database (ADR-042), GST, ATO 2026-27 tax tables
  on payslips (ADR-046), data hosted in Sydney (architecture.md §14)
- shapes itself per business: labels, stages, fields, feature switches (ADR-029)
- AI drafts, a person approves (ADR-074); businesses sealed off + every change recorded (ADR-038/063)
- set up with you: the platform owner onboards each business (ADR-029, ADR-047)
"""

VOICE = "af_heart"
SPEED = 1.1

SCENES = [
    {"id": "r01", "module": "reel_01_hook", "cls": "Hook",
     "text": "Your business runs on too many apps. And none of them talk to each other."},
    {"id": "r02", "module": "reel_02_pain", "cls": "Pain",
     "text": "Messages get missed. Rosters blow the budget. Invoices go unpaid."},
    {"id": "r03", "module": "reel_03_reveal", "cls": "Reveal",
     "text": "Meet Meroidea. One workspace for your entire business."},
    {"id": "r04", "module": "reel_04_features", "cls": "Features",
     "text": ("Every customer message, in one inbox. Rosters built in one click, and costed against the award. "
              "Timesheets turn into payslips. And invoices flow straight into your books.")},
    {"id": "r05", "module": "reel_05_different", "cls": "Different",
     "text": ("So what makes it different? It's built for Australia, with award rates, GST and tax tables built in. "
              "It shapes itself to your business, in your own words. No developers. "
              "And its AI drafts the work, but a person always approves it.")},
    {"id": "r06", "module": "reel_06_close", "cls": "Close",
     "text": ("Your data stays in Australia, sealed off, and every change is recorded. We set it up with you. "
              "Meroidea. One workspace to run your business.")},
]
