# Meroidea — Technical Architecture Specification v1.0

Status: **Draft for review** · Date: 2026-09-11 (name and positioning updated 2026-09-12)

**Meroidea** is a configurable, multi-tenant CRM platform, sold and built as industry-neutral:
people, organisations, opportunities and the work attached to them. A tenant's industry shows
up only in its own configuration after sign-in. First tenant: our education consulting business
in Sydney.

| Document | Covers |
|---|---|
| [onboarding.md](onboarding.md) | Sign-up → provisioning → admin dashboard → invitations → each company's own branded workspace |
| [product-requirements.md](product-requirements.md) | Business context, roles, modules, open questions |
| [terminology.md](terminology.md) | The words the code uses, and per-industry labels |
| [architecture.md](architecture.md) | Layers, folder structure, request lifecycle, API conventions, custom fields, board, documents, import, lead intake, reporting, notifications, environments, costs |
| [database.md](database.md) | ERD, every table/column/index/FK, tenant config, business rules, RLS strategy, cron jobs, seed data |
| [permissions.md](permissions.md) | Permission catalog, scopes, default role matrix, required tests |
| [decisions.md](decisions.md) | ADRs — including where and why this spec departs from the original stack proposal |
| [roadmap.md](roadmap.md) | Milestones 0–13 (MVP), Phase 2, Phase 3, non-goals |
| [design-system.md](design-system.md) | How the Skydash palette maps to theme tokens, with accessibility fixes |

Claude Code's standing instructions live in `.claude/CLAUDE.md` and `.claude/rules/`.

## Review checklist before milestone 1

- [ ] Answer or accept defaults for the open questions in `product-requirements.md` §7
- [ ] Confirm default role matrix in `permissions.md`
- [ ] Confirm seed pipeline stages, sources, custom fields, document types (`database.md` §13)
- [ ] Pick Supabase region (closest to users) and confirm hosting budget (`architecture.md` §13)
- [ ] Start Meta business verification if social lead import matters for Phase 2
