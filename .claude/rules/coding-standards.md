---
paths:
  - "src/**"
  - "tests/**"
---

# Coding standards

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any`; use `unknown` + Zod.
- Named exports. File names kebab-case; React components PascalCase.
- Server Actions return `ActionResult<T>`:
  `{ ok: true, data: T } | { ok: false, error: { code: AppErrorCode, message: string, fieldErrors?: Record<string, string[]> } }`.
  They never throw to the client. Codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
  `VALIDATION`, `CONFLICT`, `DUPLICATE`, `INTERNAL`.
- Forms: React Hook Form + the same Zod schema the action uses (import from `schemas.ts`).
- Dates: store UTC; format with the tenant timezone via `formatDateTime(ctx, date)`.
- Money: keep as string/decimal end-to-end; never JS floating-point arithmetic on amounts.
- Components: shadcn/ui primitives in `src/components/ui` (generated, edit sparingly);
  shared composites in `src/components/*`; module-specific ones in the module folder.
- Colours via theme tokens (`bg-primary`, `text-destructive`), never raw hex in components.
- No comments that restate code. Comment the *why* for non-obvious business rules.
- Tests: `tests/unit` (pure logic), `tests/db` (permissions/RLS against local Supabase),
  `tests/e2e` (Playwright). Name tests after the behaviour: `consultant cannot view another consultant's opportunity`.
