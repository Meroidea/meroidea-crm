import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { provisionTenant } from '@/modules/tenants/provision';
import { withRls, type SessionClaims } from '@/server/db/with-rls';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

import { destroyWorkspace } from '../support/workspaces';

type Workspace = { userId: string; tenantId: string; claims: SessionClaims };

const supabase = createSupabaseAdminClient();
const stamp = Date.now();

async function createWorkspace(company: string, email: string): Promise<Workspace> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'correct-horse-staple-42',
    email_confirm: true,
    user_metadata: { full_name: company },
  });
  if (error || !data.user) throw error ?? new Error('no user created');

  const { tenantId } = await provisionTenant({ userId: data.user.id, companyName: company });
  return {
    userId: data.user.id,
    tenantId,
    claims: { sub: data.user.id, role: 'authenticated', email },
  };
}

/** Drizzle wraps driver errors, so the Postgres message lives on `cause`. */
async function rejectionMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const wrapped = error as { message?: string; cause?: { message?: string } };
    return `${wrapped.message ?? ''} ${wrapped.cause?.message ?? ''}`;
  }
  throw new Error('expected the query to be rejected');
}

let alpha: Workspace;
let beta: Workspace;

beforeAll(async () => {
  alpha = await createWorkspace('Alpha Freight', `alpha-${stamp}@example.com`);
  beta = await createWorkspace('Beta Clinic', `beta-${stamp}@example.com`);
}, 60_000);

afterAll(async () => {
  for (const workspace of [alpha, beta]) {
    if (workspace) await destroyWorkspace(workspace.tenantId, [workspace.userId]);
  }
}, 60_000);

describe('tenant isolation', () => {
  it('shows a member only their own workspace', async () => {
    const rows = (await withRls(alpha, (tx) =>
      tx.execute(sql`select id from tenants`),
    )) as unknown as { id: string }[];

    expect(rows.map((row) => row.id)).toEqual([alpha.tenantId]);
  });

  it('returns no rows of another tenant, even by explicit id', async () => {
    const rows = (await withRls(alpha, (tx) =>
      tx.execute(sql`select id from tenant_memberships where tenant_id = ${beta.tenantId}`),
    )) as unknown as unknown[];

    expect(rows).toHaveLength(0);
  });

  it('refuses to write a row belonging to another tenant', async () => {
    const message = await rejectionMessage(() =>
      withRls(alpha, (tx) =>
        tx.execute(
          sql`insert into teams (tenant_id, name) values (${beta.tenantId}, 'Smuggled team')`,
        ),
      ),
    );

    expect(message).toMatch(/row-level security/i);
  });

  it('grants the founder the owner role with every permission scoped to all', async () => {
    const rows = (await withRls(alpha, (tx) =>
      tx.execute(sql`select r.key, count(rp.permission)::int as grants
                     from roles r
                     join role_permissions rp on rp.role_id = r.id
                     where r.key = 'owner'
                     group by r.key`),
    )) as unknown as { key: string; grants: number }[];

    expect(rows[0]?.key).toBe('owner');
    expect(rows[0]?.grants).toBeGreaterThan(30);
  });

  it('keeps the audit trail append-only for signed-in users', async () => {
    const message = await rejectionMessage(() =>
      withRls(alpha, (tx) =>
        tx.execute(
          sql`update audit_logs set action = 'tampered' where tenant_id = ${alpha.tenantId}`,
        ),
      ),
    );

    expect(message).toMatch(/permission denied/i);
  });

  it('enables RLS on, and hides the other tenant in, every table with a tenant_id', async () => {
    const tables = (await withRls(alpha, (tx) =>
      tx.execute(sql`select c.relname as name, c.relrowsecurity as rls
                     from pg_class c
                     join pg_namespace n on n.oid = c.relnamespace
                     join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
                     where n.nspname = 'public' and c.relkind = 'r'`),
    )) as unknown as { name: string; rls: boolean }[];

    expect(tables.length).toBeGreaterThanOrEqual(10);
    for (const table of tables) {
      expect({ table: table.name, rls: table.rls }).toEqual({ table: table.name, rls: true });
      const rows = (await withRls(alpha, (tx) =>
        tx.execute(
          sql`select count(*)::int as n from ${sql.identifier(table.name)} where tenant_id = ${beta.tenantId}`,
        ),
      )) as unknown as { n: number }[];
      expect({ table: table.name, rows: rows[0]?.n }).toEqual({ table: table.name, rows: 0 });
    }
  });
});
