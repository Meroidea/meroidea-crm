// Before `drizzle-kit migrate` runs against a shared database (production), check that its
// migration history matches this repository's journal, and say exactly what will be applied
// (ADR-065). Drizzle applies every journal entry newer than the last row in
// drizzle.__drizzle_migrations, so a database whose history is missing or foreign would have
// migrations replayed onto live data. This refuses instead.
//
// Usage: DATABASE_URL_DIRECT=postgres://... node scripts/check-migrations.mjs
// Exit 0: safe to migrate (pending list printed). Exit 1: stop, with the reason.

import { appendFileSync, readFileSync } from 'node:fs';

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  console.error('DATABASE_URL_DIRECT is not set: no database to check.');
  process.exit(1);
}

const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url)));
const entries = journal.entries.map((entry) => ({ tag: entry.tag, when: Number(entry.when) }));

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

function report(lines) {
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
}

function stop(reason) {
  report(['### Migrations not applied', '', reason]);
  process.exitCode = 1;
}

try {
  const [{ history, app }] = await sql`
    select to_regclass('drizzle.__drizzle_migrations') is not null as history,
           to_regclass('public.tenants') is not null as app`;

  if (!history) {
    if (app) {
      stop(
        'This database has the app’s tables but no `drizzle.__drizzle_migrations` history, so ' +
          'Drizzle would replay every migration from the first one onto live data. Record the ' +
          'migrations already applied (a baseline) before running this job.',
      );
    } else {
      report([
        '### Migrations to apply',
        '',
        `Empty database: all ${entries.length} migrations will be applied.`,
      ]);
    }
  } else {
    const rows = await sql`
      select created_at::bigint as when from drizzle.__drizzle_migrations order by created_at`;
    const known = new Set(entries.map((entry) => entry.when));
    const foreign = rows.filter((row) => !known.has(Number(row.when)));
    const last = rows.length ? Number(rows[rows.length - 1].when) : null;

    if (rows.length === 0 && app) {
      stop(
        'The migration history table is empty but the app’s tables exist. Record a baseline ' +
          'before running this job.',
      );
    } else if (foreign.length) {
      stop(
        `The database has ${foreign.length} applied migration(s) this repository does not know ` +
          '(another branch, or edited history). Reconcile them before migrating.',
      );
    } else {
      const pending = entries.filter((entry) => last === null || entry.when > last);
      const lastTag = entries.find((entry) => entry.when === last)?.tag ?? 'none';
      report([
        '### Migrations to apply',
        '',
        `Last applied: \`${lastTag}\` (${rows.length} recorded).`,
        '',
        pending.length
          ? pending.map((entry) => `- \`${entry.tag}\``).join('\n')
          : 'Nothing to apply: the database is up to date.',
      ]);
    }
  }
} catch (error) {
  // Connection errors can include the host; never the password, which postgres.js leaves out.
  stop(`Could not read the database: ${error instanceof Error ? error.message : 'unknown error'}`);
} finally {
  await sql.end({ timeout: 5 });
}
