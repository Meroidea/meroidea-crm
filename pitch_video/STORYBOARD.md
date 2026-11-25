# Meroidea Investor Pitch: Storyboard (v2)

**Runtime:** about 2:00 · **Format:** 1920×1080, 60 fps · **Narrator:** `en-AU-WilliamNeural` at +16% (brisk)
**Focus:** the problems a small business has, and how Meroidea makes running it easier. No tech stack.
Every feature shown exists in the codebase (`SYSTEM_AUDIT.md`). Business figures in the UI mock-ups are illustrative.

**Pacing rules (v2):** beats of 7–14 s; something moves in every frame (ambient particles, a slow camera push,
punch-ins on key moments); kinetic type for hooks; whip transitions between scenes; cues land on the spoken word.

## Visual language: identical to the Meroidea website

Every token comes from the site's code (`src/app/globals.css`, `src/app/layout.tsx`, `public/icon.svg`,
`src/components/layout/dot-background.tsx`, `src/components/motion/wavy-background.tsx`), not from a mood board.

| Element | Website source | Video |
|---|---|---|
| Ground | `--background #F5F7FF` with the dotted grid: 1 px `--dot #CFD4E6` dots on a 20 px pitch, radially faded | Same plate behind every frame |
| Hero texture | 32 noise lines, chart palette, opacity 0.085, width 3 | Opening title and end card |
| Typeface | Inter (`next/font`), semibold headings; JetBrains Mono for figures and code | Same |
| Text | `--foreground #1F2937`, `--muted-foreground #5B6474` | Same |
| Surfaces | `--card #FFFFFF`, `--border #E3E7F2`, `--muted #EEF1FA`, `--accent #E8F1FF` | Same |
| Brand | `--primary #4B49AC` (section labels, key figures), `--info #7978E9`, charts `#98BDFF` `#7DA0FA`, coral `#F3797E` | Same |
| Readable shades | `#C2383F`, `#3159C9`, warning `#6B4200` on `#FFF6E0` | Applied automatically when a light colour would be text (`ink()`) |
| Logo | gradient tile `#4B49AC→#7978E9`, white M, `#98BDFF` dot, with the "Meroidea" wordmark | Core of scenes 2 and 9 |
| Tagline | "One workspace to / run your business", gradient `primary→info→primary`, `chart-2` underline | End card |
| Channels | `--channel-facebook #0866FF`, `instagram #FF0069`, `whatsapp #25D366`, `tiktok #111111`, `email #7DA0FA`, `livechat #7978E9` | Inbox scene |

Motion: `smooth` easing, `there_and_back` pulses, `LaggedStart` groups, a slow camera push in scene 1.

## Script and shots

| # | Scene | Narration | Visuals |
|---|---|---|---|
| 1 | `scene_01_problem.py` | Monday. Nine a.m. Three missed calls. Forty unread messages. A roster that doesn't add up, and an invoice nobody sent. Sound familiar? Most small businesses still run on spreadsheets, sticky notes and memory. | MONDAY slams in with a camera shake. A clock spins to 9:00. A phone fills with missed calls (badge 3). A message avalanche bounces in (counter to 40). `roster_FINAL_v7.xlsx` shows #REF! cells. A NOT SENT stamp slams. A veil and push-in for "Sound familiar?". Kinetic words, with sticky notes raining down. |
| 2 | `scene_02_solution.py` | Meroidea replaces the pile with one workspace. Customers, sales, staff, rosters, payroll, invoices and the books. All connected. One login. Shaped around how your business already works. | The pile swirls and is sucked into the logo, with ripple rings. A workspace window opens out of the logo. Module tiles pop in on each spoken word. Wires light up with racing packets. "One login" appears. Tiles reshuffle into a new layout. |
| 3 | `scene_03_inbox.py` | Never miss a customer again. Facebook, Instagram, WhatsApp, email and website chat all land in one inbox. Each message is matched to the right customer, new leads go to the right person, and a reply is drafted, ready to send. | Channel orbs (the site's channel colours) pop on each name, then fire messages along arcs into the inbox. A punch-in shows the contact card with "matched". A lead chip flies to Sam, with a ripple. An AI draft types itself; Send pulses. |
| 4 | `scene_04_sales.py` | Your pipeline shows every deal, and exactly where it's stuck. Drag a deal forward, and the forecast updates instantly. Meroidea even tells you who to call next, and why. | Kanban cards cascade in. A stuck deal wiggles with a "12 days" tag. A cursor lifts it and arcs it into the next stage; the forecast counts up (+$2,880 = $9,600 × 30% step). The MeroAI next-best-action card slides in with a sparkle. |
| 5 | `scene_05_myday.py` | Follow-ups, reminders and overdue tasks arrive on one screen, called My Day. Nothing slips through the cracks. | Task notifications fly in from both sides into a phone. The bell wiggles on "overdue". Tasks tick off in a cascade: "All caught up". |
| 6 | `scene_06_team.py` | Next week's roster? One click. Shifts fit your trading hours, every cost is checked against the award, and staff get their shifts on their phones. Clock-ins become approved timesheets, and timesheets become payslips. | A cursor clicks Instant build; shifts fill in a diagonal wave. The trading-hours band grows. The wage cost counts up, "award checked". Phones receive "Shifts published". A conveyor runs Clock-in → Timesheet approved → Payslip. |
| 7 | `scene_07_money.py` | Type, invoice Acme for forty catering boxes, and the invoice drafts itself. Overdue? The reminder is written for you. And every payment flows straight into your books, with GST, profit and loss, and the balance sheet always up to date. | The prompt types itself; the invoice assembles line by line (40 × $18 = $720 + GST $72 = $792). OVERDUE slams. A reminder email flies out; the payment flies back and the stamp turns to PAID. Coins flow into the books. GST, P&L bars and a balance scale settle level. |
| 8 | `scene_08_control.py` | Everyone sees exactly what they should. Staff, their own work. Managers, their team. Owners, everything. And every change is recorded, so you always know who did what. | A field of records. Rings for Staff, Managers and Owners grow on their words and recolour the records inside them. A live activity feed streams entries. |
| 9 | `scene_09_anybusiness.py` | A restaurant. A migration agency. A retail shop. Meroidea shapes itself to each one, with its own stages, fields and words. Switch on what you need today, and grow into the rest. | Three business cards pop. One board morphs: Bookings → Cases → Orders, with its stages and fields. Feature toggles flip on: four today, then the rest. |
| 10 | `scene_10_close.py` | Australia has more than two point seven million businesses, and most are still buried in the pile. Meroidea gives them one workspace to run their business. Built in Sydney. Ready to scale. | A dot field counts to 2,729,648 (ABS, June 2025), then collapses into a coral heap with a shake. The heap streams up into the logo. The site's hero line appears over its waves, then the chips and `crm.meroidea.com`. |

## Audio

- Voice: edge-tts per scene, with per-word timestamps driving every cue.
- Music: an Am–F–C–G progression at 100 bpm (pad, plucked eighth-note arpeggio, soft kick) that swells in over the first 4 s, or `assets/bgm.mp3` if you add one.
- Mix: music about 18 dB under the voice, sidechain-ducked under speech, static master gain to −16 LUFS.
