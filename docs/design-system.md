# Design System (implementation notes)

Visual source: `../blanxer_ui_design.md` (Skydash palette). This file says how to apply it in
a white-label CRM built on shadcn/ui + Tailwind.

## Tokens

The palette is the **default theme**. Tenants override `--primary` (and derived tokens) with
`tenants.primary_color`, injected as CSS variables in the app layout. Components use semantic
tokens only (`bg-primary`, `text-muted-foreground`, `border-destructive`) — never hex values.

| Semantic token (shadcn) | Default | Source |
|---|---|---|
| `--background` | `#F5F7FF` | page ground |
| `--card`, `--popover` | `#FFFFFF` | surfaces |
| `--foreground` | `#1F2937` | primary text |
| `--primary` | `#4B49AC` | CTAs, active nav, key figures |
| `--primary-foreground` | `#FFFFFF` | |
| `--secondary` / `--accent` | `#98BDFF` at low opacity | hover, selected rows, active nav tint |
| `--info` (custom) | `#7978E9` | badges, counters |
| `--chart-1…5` | `#4B49AC`, `#98BDFF`, `#7DA0FA`, `#7978E9`, `#F3797E` | charts (validate with the dataviz skill before shipping) |
| `--destructive` | `#F3797E` fill; darker shade for text | delete, errors, negative trends |
| `--radius` | `12px` cards, `8px` inputs/buttons | |

## Accessibility corrections to the palette

Checked against WCAG AA (4.5:1 for normal text on white):

- `#4B49AC` on white ≈ 7.4:1 — fine for text.
- `#F3797E` (coral) on white ≈ 2.7:1, `#7DA0FA` ≈ 2.5:1, `#7978E9` ≈ 3.7:1 — **not readable as
  small text** (and white text on them fails too). Use them for fills, icons, and chart marks.
  For text (error messages, trend labels, badge text) use darker shades — coral → `#C2383F`
  (5.3:1), blue → `#3159C9` (6.2:1) — defined as `--destructive-text` / `--positive-text`.
- `#98BDFF` is a background tint only; never text.
- Don't signal state with colour alone: trend arrows, status badges with labels.
- Tenant brand colours are user input — compute a readable foreground automatically and fall
  back to the default primary if contrast is too low.

## CRM-specific patterns

- **Pipeline board**: one column per stage, header shows count + sum amount; stage colour as a
  4px top border, not a full fill. Cards: contact name, opportunity name, owner avatar, days in
  stage (amber when past `stale_after_days`), next task due, partner badge.
- **Record page**: header (name, stage stepper, owner, key actions) → two columns on desktop
  (details + custom fields | timeline with composer for call/email/note/task); tabs on mobile.
- **My Day**: sections Overdue (coral indicator) · Today · Upcoming · Stale opportunities.
- **Tables**: density toggle, sticky header, column chooser, saved filters in URL.
- **Status count bar** (from `research/selma-analysis.md`): above every list, one chip per
  status/stage/type with its count under the current search and filters; clicking filters the list
  through the URL. Colour is a 3px side bar only — label and number carry the meaning.
  `src/components/data/status-count-bar.tsx`. Below `md` the list becomes stacked rows.
- **Record header**: identity + status badge + one-line context (owner, source, added) → quick
  actions (Email, Call) → primary **Edit** → one **Actions** menu for everything else (delete with
  confirm). `src/components/data/record-actions-menu.tsx`.
- **Privacy blur**: eye toggle in the top bar (`Shift+P`) blurs anything marked `data-sensitive`
  while screen sharing. Display aid only; masking stays server-side (`contacts.view_sensitive`).
- **Warnings** (duplicates, do-not-contact, later stale/expiry): `--warning` fill,
  `--warning-border`, `--warning-text` (#6B4200 on #FFF6E0, 7.9:1). Never raw Tailwind ambers.
- **Mobile**: bottom-anchored primary action on record pages (log activity / add task),
  thumb-reachable per the source design doc.
- Typography: Inter (fallback system-ui). Numbers in KPI cards semibold, `--primary`.
- **Public website background**: marketing and sign-in pages sit on a fixed 20px dot grid
  (`--dot`), faded towards the screen edges (`src/components/layout/dot-background.tsx`). Not
  used inside the signed-in app, where it would compete with tables and forms.
- Dark mode: not in MVP; tokens make it a later addition.
