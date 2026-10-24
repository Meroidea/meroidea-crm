import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { publicEnv } from '@/lib/env.public';
import { setMemberStatus } from '@/modules/access/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import {
  contextFor,
  createAuthUser,
  createWorkspace,
  destroyWorkspace,
} from '../support/workspaces';

// Deactivating a person must close every way in, not only loadTenantContext (covered in
// access.test.ts). A request that loaded its context before the switch, and a browser that still
// holds a valid session token for up to an hour, both reach Postgres; RLS is what stops them.

const stamp = Date.now();
const rileyEmail = `deactivated-riley-${stamp}@example.com`;

let tenantId: string;
let ownerId: string;
let rileyId: string;
let owner: TenantContext;
/** Loaded while Riley was active and kept, as a long request would keep it. */
let riley: TenantContext;
let browser: SupabaseClient;
let contactId: string;

async function one<T>(query: ReturnType<typeof sql>): Promise<T> {
  const rows = (await adminDb().execute(query)) as unknown as T[];
  return rows[0]!;
}

async function tenantTables(): Promise<string[]> {
  const rows = (await adminDb().execute(sql`
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
    order by 1`)) as unknown as { name: string }[];
  return rows.map((row) => row.name);
}

/** Rows of this business each table shows Riley, through the stale context. */
async function visibleToRiley(tables: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const column = table === 'tenants' ? 'id' : 'tenant_id';
    const rows = (await withRls(riley, (tx) =>
      tx.execute(
        sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${tenantId}`,
      ),
    )) as unknown as { n: number }[];
    counts[table] = rows[0]?.n ?? 0;
  }
  return counts;
}

/** Drizzle wraps driver errors, so the Postgres code lives on `cause`. */
async function sqlState(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const wrapped = error as { code?: string; cause?: { code?: string } };
    return wrapped.cause?.code ?? wrapped.code ?? 'unknown';
  }
  return 'OK';
}

beforeAll(async () => {
  const workspace = await createWorkspace(
    `Deactivated Co ${stamp}`,
    `deactivated-owner-${stamp}@example.com`,
  );
  tenantId = workspace.tenantId;
  ownerId = workspace.ownerId;

  // Riley holds the owner role, so whatever stays visible after deactivation is not hidden by
  // scope or a missing permission, only by the membership being switched off.
  rileyId = await createAuthUser(rileyEmail, 'Riley Leaving');
  await adminDb().execute(sql`
    insert into tenant_memberships (tenant_id, user_id, role_id, status)
    select ${tenantId}, ${rileyId}, r.id, 'active'
    from roles r where r.tenant_id = ${tenantId} and r.key = 'owner'`);

  // Rows that are Riley's own: the policies must not let ownership outlive the membership.
  contactId = (
    await one<{ id: string }>(sql`
      insert into contacts (tenant_id, first_name, last_name, owner_user_id)
      values (${tenantId}, 'Jordan', 'Example', ${rileyId}) returning id`)
  ).id;
  await adminDb().execute(sql`
    insert into tasks (tenant_id, title, assigned_to, contact_id)
    values (${tenantId}, 'Call Jordan back', ${rileyId}, ${contactId})`);
  await adminDb().execute(sql`
    insert into notifications (tenant_id, user_id, type, title)
    values (${tenantId}, ${rileyId}, 'task_assigned', 'Call Jordan back')`);

  owner = await contextFor(ownerId, tenantId);
  riley = await contextFor(rileyId, tenantId);

  browser = createClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await browser.auth.signInWithPassword({
    email: rileyEmail,
    password: 'correct-horse-staple-42',
  });
  if (error) throw error;
});

afterAll(async () => {
  await browser?.auth.signOut();
  if (tenantId) await destroyWorkspace(tenantId, [ownerId, rileyId]);
});

describe('a deactivated person', () => {
  it('saw the business, its records and their own work while active', async () => {
    const counts = await visibleToRiley(['tenants', 'contacts', 'tasks', 'notifications', 'roles']);
    for (const [table, n] of Object.entries(counts)) {
      expect({ table, visible: n > 0 }).toEqual({ table, visible: true });
    }
  });

  describe('once deactivated', () => {
    beforeAll(async () => {
      await setMemberStatus(owner, { userId: rileyId, status: 'deactivated' });
    });

    it('sees no row of the business in any table with a tenant_id, through a context loaded earlier', async () => {
      const tables = await tenantTables();
      expect(tables.length).toBeGreaterThan(50);
      const counts = await visibleToRiley(tables);
      for (const table of tables) {
        expect({ table, rows: counts[table] }).toEqual({ table, rows: 0 });
      }
      const tenants = (await withRls(riley, (tx) =>
        tx.execute(sql`select id from tenants`),
      )) as unknown as unknown[];
      expect(tenants).toHaveLength(0);
    });

    it('cannot add or change records through a context loaded earlier', async () => {
      expect(
        await sqlState(() =>
          withRls(riley, (tx) =>
            tx.execute(
              sql`insert into contacts (tenant_id, first_name) values (${tenantId}, 'Smuggled')`,
            ),
          ),
        ),
      ).toBe('42501');

      const changed = (await withRls(riley, (tx) =>
        tx.execute(
          sql`update contacts set first_name = 'Changed' where id = ${contactId} returning id`,
        ),
      )) as unknown as unknown[];
      expect(changed).toHaveLength(0);
      const kept = await one<{ first_name: string }>(
        sql`select first_name from contacts where id = ${contactId}`,
      );
      expect(kept.first_name).toBe('Jordan');
    });

    it('gets nothing from the database functions a signed-in person may call', async () => {
      const context = (await withRls(riley, (tx) =>
        tx.execute(sql`select * from app.my_context(${tenantId})`),
      )) as unknown as unknown[];
      expect(context).toHaveLength(0);

      const progress = (await withRls(riley, (tx) =>
        tx.execute(sql`select * from app.training_progress()`),
      )) as unknown as unknown[];
      expect(progress).toHaveLength(0);

      const duplicates = (await withRls(riley, (tx) =>
        tx.execute(
          sql`select * from app.find_company_contact_duplicates(null, 'Jordan Example', null)`,
        ),
      )) as unknown as unknown[];
      expect(duplicates).toHaveLength(0);

      expect(
        await sqlState(() =>
          withRls(riley, (tx) => tx.execute(sql`select app.erase_contact_traces(${contactId})`)),
        ),
      ).toBe('42501');
      expect(
        await sqlState(() =>
          withRls(riley, (tx) =>
            tx.execute(sql`select app.merge_contact_references(${contactId}, ${contactId})`),
          ),
        ),
      ).toBe('42501');
    });

    // ADR-007: the Data API does not serve the public schema, so a session token kept in the
    // browser after deactivation has no route to business data that skips the server.
    it('cannot use a session token issued while active to reach any table through the Data API', async () => {
      for (const table of ['tenants', 'contacts', 'tasks', 'notifications', 'tenant_memberships']) {
        const { data, error } = await browser.from(table).select('id');
        expect({ table, code: error?.code, data }).toEqual({ table, code: 'PGRST106', data: null });
      }
      const { error } = await browser
        .from('contacts')
        .insert({ tenant_id: tenantId, first_name: 'Smuggled' });
      expect(error?.code).toBe('PGRST106');
    });

    it('gets exactly their access back when reactivated', async () => {
      await setMemberStatus(owner, { userId: rileyId, status: 'active' });
      const counts = await visibleToRiley(['tenants', 'contacts', 'tasks', 'notifications']);
      expect(counts).toEqual({ tenants: 1, contacts: 1, tasks: 1, notifications: 1 });
    });
  });
});
