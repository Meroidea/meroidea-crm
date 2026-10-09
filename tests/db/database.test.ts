import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    'DATABASE_URL is not set — start Supabase (`npx supabase start`) and copy .env.example to .env.local',
  );

const sql = postgres(url, { prepare: false, max: 1 });

afterAll(async () => {
  await sql.end();
});

describe('local database', () => {
  it('runs Postgres 17 like the hosted project', async () => {
    const [row] = await sql<
      { version: number }[]
    >`select current_setting('server_version_num')::int as version`;

    expect(row?.version).toBeGreaterThanOrEqual(170000);
  });

  it('offers the extensions the schema depends on', async () => {
    const rows = await sql<{ name: string }[]>`
      select name from pg_available_extensions where name in ('pgcrypto', 'pg_trgm', 'citext', 'pg_cron')`;

    expect(rows.map((row) => row.name).sort()).toEqual([
      'citext',
      'pg_cron',
      'pg_trgm',
      'pgcrypto',
    ]);
  });

  it('has the Supabase auth schema and authenticated role that RLS relies on', async () => {
    const [row] = await sql<{ hasAuthUid: boolean; hasAuthenticated: boolean }[]>`
      select
        exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'auth' and p.proname = 'uid') as "hasAuthUid",
        exists (select 1 from pg_roles where rolname = 'authenticated') as "hasAuthenticated"`;

    expect(row).toEqual({ hasAuthUid: true, hasAuthenticated: true });
  });
});
