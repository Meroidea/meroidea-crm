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

// ADR-007: the API roles hold only what the migrations grant, whatever the project's defaults.
describe('API role grants', () => {
  it('gives anon nothing on any table and keeps RLS on every table', async () => {
    const rows = await sql<{ table: string; anon: boolean; rls: boolean }[]>`
      select c.relname as table,
        (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
          or has_any_column_privilege('anon', c.oid, 'select, insert, update, references')) as anon,
        c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.anon || !row.rls)).toEqual([]);
  });

  it('never lets a signed-in user truncate, or hard-delete a soft-deleted record', async () => {
    const rows = await sql<{ table: string }[]>`
      select c.relname as table
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and (has_table_privilege('authenticated', c.oid, 'truncate')
          or (has_table_privilege('authenticated', c.oid, 'delete')
              and exists (select 1 from pg_attribute a
                          where a.attrelid = c.oid and a.attname = 'deleted_at' and not a.attisdropped)))`;

    expect(rows).toEqual([]);
  });

  it('keeps a question’s wording and an agreement’s link out of a signed-in user’s reach', async () => {
    const [row] = await sql<{ editSubject: boolean; editStatus: boolean; readHash: boolean }[]>`
      select
        has_column_privilege('authenticated', 'public.concerns', 'subject', 'update') as "editSubject",
        has_column_privilege('authenticated', 'public.concerns', 'status', 'update') as "editStatus",
        has_column_privilege('authenticated', 'public.tenant_agreements', 'token_hash', 'select') as "readHash"`;

    expect(row).toEqual({ editSubject: false, editStatus: true, readHash: false });
  });
});
