# Contributing

Thank you for looking. A few things make a contribution easy to accept.

## Before you start

- For anything larger than a small fix, open an issue first and describe what you want to change.
- Read [`.claude/CLAUDE.md`](.claude/CLAUDE.md) and the files in [`.claude/rules/`](.claude/rules):
  they are the project's rules for people as much as for tools. The ones that are never bent:
  tenant isolation, one path for every change, no industry-specific words in core code, and
  schema changes only through Drizzle migrations.
- Do not add a runtime dependency without discussing it in an issue first.

## Making a change

1. Fork the repository and work on a branch. Your fork is yours: nothing you do there changes
   this repository. Changes arrive here only through a pull request that a maintainer merges.
2. Get it running locally (see the README).
3. Keep the change small and about one thing.
4. Anything that touches permissions or data access needs database tests: one showing another
   business cannot reach the data, and one showing a colleague without the right cannot.
5. Update the matching file in `docs/` when you change a table, a permission or a convention.
6. Before opening the pull request, these must pass:

   ```bash
   npm run lint && npm run typecheck && npm run format:check && npm test
   ```

Use made-up data only (`@example.com` addresses). Never include real people's details, real
credentials or a real business's data in code, tests, issues or screenshots.

## Licence of contributions

By contributing you agree that your contribution is licensed under the project's licence,
[AGPL-3.0](LICENSE).
