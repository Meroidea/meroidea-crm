# Meroidea Investor Pitch: Storyboard

**Runtime target:** 3:00–3:30 · **Format:** 1920×1080, 60 fps · **Narrator:** `en-AU-WilliamNeural` (Sydney company, Australian voice)
**Source of facts:** `SYSTEM_AUDIT.md`. Every number on screen is either counted from the repo or cited (ABS).
Business charts are marked *illustrative · synthetic data*, because no production metrics exist yet.

The narration text below is the single source of truth: `script.py` holds it, `build.py` voices it, and each
scene reads its measured audio length so the animation stays in step with the speech.

## Visual language

| Token | Value | Use |
|---|---|---|
| Background | `#0F1419` | every frame |
| Brand glow | `#8B8AF0` (lifted from product primary `#4B49AC`, which is too dark on slate) | core, key figures |
| Sky | `#98BDFF` / `#7DA0FA` | data flow, secondary nodes |
| Coral | `#F3797E` | chaos, risk, "lost" |
| Gold | `#F5C46B` | money, forecast |
| Mint | `#6EE7B7` | approved, won, safe |
| Text | `#E6EAF2`; muted `#8A94A6` | Pango `Text` only (no LaTeX) |

Motion: `smooth` easing by default, `there_and_back` for pulses, `LaggedStart` for groups, slow camera pushes with `MovingCameraScene`.
Nothing on screen is ever closer than 0.35 units to the frame edge or to another label.

## Script and shots

| # | Scene file | Narration | Visuals |
|---|---|---|---|
| 1 | `scene_01_problem.py` | "Every small business runs on a tangle. Leads in a spreadsheet. Customers in a shared inbox. The roster on a whiteboard, timesheets on paper, invoices in a template, and the real story in someone's WhatsApp. Every hand-off between them loses context, and every lost context costs money." | Six tool nodes drift in. Coral Bezier wires tangle between them and jitter. Small "context" dots fall off the wires and fade. The camera slowly pushes in. End caption: *every hand-off loses context*. |
| 2 | `scene_02_solution.py` | "Meroidea pulls it into one place. One login. One record of every customer and every staff member. One database, hosted in Sydney. Each business gets its own sealed workspace, and the platform switches on only the features that business needs. There are twenty-six of them today." | The wires straighten and ReplacementTransform into sky-blue flow lines into a glowing hexagonal core, **MEROIDEA**. Sydney tag `ap-southeast-2`. The core splits into three sealed tenant cells. A 26-dot feature grid lights up a different subset in each cell. |
| 3 | `scene_03_architecture.py` | "Isolation isn't a promise in our code; the database enforces it. Every table carries a tenant ID behind row-level security, so Postgres itself refuses another business's rows. Every change passes the same eight gates: authenticate, resolve the tenant, check permission and scope, validate, apply business rules, commit, audit, and refresh. Nothing writes around it." | Left: a table with a `tenant_id` column. A query from Tenant B hits an RLS shield and bounces back in coral. Right: an eight-gate pipeline. A request packet travels gate to gate, each gate flashing mint as it passes. The audit gate drops a log line. |
| 4 | `scene_04_crm.py` | "Sales starts with capture: web forms, imports, referrals and social channels. Imports flag duplicates by email and phone, and let you skip, merge or create each one. Routing rules hand leads out round robin, or to the least-loaded rep. On the board, every stage carries a win probability, so the weighted forecast is simple arithmetic: each deal's value times its stage probability, summed. And MeroAI suggests the next best action, which a person approves before anything changes." | Sources on the left flow into a funnel. Duplicate rows glow amber, with three chips *skip · merge · create*. Leads fan out to reps. Kanban columns appear with probability badges (10 · 30 · 60 · 90 %). Cards morph into the term `value × p`, and terms stack into **Σ = weighted forecast** (gold counter). An AI suggestion card appears with an **Approve** button that turns mint. |
| 5 | `scene_05_people.py` | "People are where most CRMs stop. Meroidea keeps going. Admins, managers and staff each see exactly their scope: their own records, their team's, or everything. Rosters cost themselves live against the award, with weekend and public-holiday loadings. Approved timesheets flow into payslips. And one rule is built in: nobody signs off their own pay." | Nested sets *own ⊂ team ⊂ all* grow out from a dot, with Staff, Manager and Admin badges. A roster grid fills; the Sat, Sun and holiday cells glow gold and a cost counter climbs. An arrow from Timesheet to Payslip. A self-approval loop arrow is struck through in coral. |
| 6 | `scene_06_finance.py` | "Work runs from My Day: overdue, due today, upcoming. Documents live in a private library, with versions and in-browser editing. Money is kept honest by a double-entry ledger that only the database can write, so every entry balances to the cent. And above it all, an executive dashboard: open pipeline, weighted forecast, win rate, and a live audit trail of who changed what." | Three My Day columns. Debit and credit columns fill a balance beam that settles level (✓ balanced). Then a dashboard: four KPI tiles, a win-rate ring sweeping to 42 %, revenue-vs-forecast bars (*illustrative*), and audit lines ticking upward. |
| 7 | `scene_07_inbox.py` | "Customers reach a business everywhere, so the inbox meets them there. Facebook, Instagram, WhatsApp, TikTok, email and live chat arrive in one conversation list, matched to the right contact. AI drafts the reply. A person sends it." | Six channel orbs orbit, then stream into one inbox list. A message links to a contact card. A draft bubble labelled AI is approved by a human tick. |
| 8 | `scene_08_moat.py` | "Our moat is configuration over customisation. The same core becomes a migration agency's case board or a restaurant's catering pipeline, just by changing labels, stages and fields. No developer quote required. Underneath: one hundred and twelve tables, one hundred and ninety-six security policies, eighty-five permissions and one hundred and thirteen test files. All Australian-hosted, and exportable on request." | One board; its labels **Transform** from *Student → Application → Enrolled* to *Customer → Event → Booked*. Then four big counters roll up: 112 · 196 · 85 · 113. A Sydney pin and an *Export CSV* arrow. |
| 9 | `scene_09_vision.py` | "Australia has more than two point seven million actively trading businesses, and nearly a million of them employ staff. Most still run on that tangle. Meroidea is the one platform they can grow into. Built in Sydney. Ready to scale. Let's build it together." | A dot field with ~2.7 M scale caption (ABS, June 2025). The ~994 k employing businesses light up. The dots converge into the Meroidea core. Final card: **MEROIDEA**, *One platform for the whole business*, `crm.meroidea.com`. |

## Audio

- Voice: one MP3 per scene from edge-tts, its length measured with mutagen. Each scene is held at least as long as its voice, plus 0.6 s of tail.
- Music: a procedural ambient pad (A-minor drone, slow LFO, soft pulse) generated with numpy/scipy, unless
  `assets/bgm.mp3` exists, in which case that file is used.
- Mix: music sits around −20 dB under the voice, with sidechain ducking (`sidechaincompress`) and a 2 s fade in and out.
