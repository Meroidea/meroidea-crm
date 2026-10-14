import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { FEATURE_KEYS } from '@/lib/features';
import { inviteMemberSchema } from '@/modules/access/schemas';
import { inviteMember } from '@/modules/access/service';
import { getConcern, listConcerns } from '@/modules/concerns/queries';
import { raiseConcernSchema } from '@/modules/concerns/schemas';
import { raiseConcern, replyToConcern, setConcernStatus } from '@/modules/concerns/service';
import { hasPermission, type TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

/*
 * ADR-049: staff raise concerns with a manager or with the admin alone. One raised with the admin
 * must never reach a manager, at the database as well as in the service.
 */

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
const alphaUsers: string[] = [];
const betaUsers: string[] = [];
let admin: TenantContext;
let manager: TenantContext;
let casey: TenantContext;
let drew: TenantContext;
let outsider: TenantContext;
let withManager: string;
let withAdmin: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
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

const raise = (overrides: Record<string, unknown> = {}) =>
  raiseConcernSchema.parse({
    raisedWith: 'manager',
    category: 'roster',
    subject: 'Back-to-back closing shifts',
    details: 'I have been rostered to close and then open five times this month.',
    ...overrides,
  });

/** What a person can see of a concern straight from the database, past the service. */
const visibleRows = async (ctx: TenantContext, id: string) => {
  const rows = (await withRls(ctx, (tx) =>
    tx.execute(sql`select
      (select count(*)::int from concerns where id = ${id}) as concerns,
      (select count(*)::int from concern_messages where concern_id = ${id}) as messages`),
  )) as unknown as { concerns: number; messages: number }[];
  return rows[0];
};

beforeAll(async () => {
  const alpha = await createWorkspace('Concerns Cafe', mail('concerns-alpha'));
  const beta = await createWorkspace('Concerns Bistro', mail('concerns-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  alphaUsers.push(alpha.ownerId);
  betaUsers.push(beta.ownerId);
  admin = await contextFor(alpha.ownerId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);

  const roleIds = (await adminDb().execute(
    sql`select key, id from roles where tenant_id = ${alphaTenant}`,
  )) as unknown as { key: string; id: string }[];
  const roleId = (key: string) => roleIds.find((role) => role.key === key)?.id ?? '';
  const add = async (fullName: string, email: string, key: string) => {
    const { userId } = await inviteMember(
      admin,
      inviteMemberSchema.parse({ fullName, email, roleId: roleId(key) }),
    );
    alphaUsers.push(userId);
    return userId;
  };
  const managerId = await add('Morgan Manager', mail('c-morgan'), 'manager');
  const caseyId = await add('Casey Crew', mail('c-casey'), 'member');
  const drewId = await add('Drew Crew', mail('c-drew'), 'member');
  manager = await contextFor(managerId, alphaTenant);
  casey = await contextFor(caseyId, alphaTenant);
  drew = await contextFor(drewId, alphaTenant);

  withManager = (await raiseConcern(casey, raise())).id;
  withAdmin = (
    await raiseConcern(
      casey,
      raise({
        raisedWith: 'admin',
        category: 'conduct',
        subject: 'How my manager speaks to me',
        details: 'This is about Morgan, so I am raising it with the admin only.',
      }),
    )
  ).id;
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('who may do what', () => {
  it('lets everyone raise; managers answer; only the admin answers everything', () => {
    expect(hasPermission(casey, 'concerns.raise')).toBe(true);
    expect(hasPermission(casey, 'concerns.handle')).toBe(false);
    expect(hasPermission(manager, 'concerns.handle')).toBe(true);
    expect(hasPermission(manager, 'concerns.handle_all')).toBe(false);
    expect(hasPermission(admin, 'concerns.handle_all')).toBe(true);
  });
});

describe('a concern raised with a manager', () => {
  it('reaches managers and the admin', async () => {
    expect((await listConcerns(manager, 'raised')).map((row) => row.id)).toContain(withManager);
    expect((await listConcerns(admin, 'raised')).map((row) => row.id)).toContain(withManager);
    expect((await getConcern(manager, withManager))?.canHandle).toBe(true);
  });

  it('is the raiser’s own to follow', async () => {
    const mine = await listConcerns(casey, 'mine');
    expect(mine.map((row) => row.id)).toEqual(expect.arrayContaining([withManager, withAdmin]));
    const detail = await getConcern(casey, withManager);
    expect(detail?.canHandle).toBe(false);
    expect(detail?.messages[0]?.body).toMatch(/close and then open/);
  });

  it('is invisible to other staff, in the service and at the database', async () => {
    expect(await listConcerns(drew, 'mine')).toEqual([]);
    expect(await getConcern(drew, withManager)).toBeNull();
    expect(await visibleRows(drew, withManager)).toEqual({ concerns: 0, messages: 0 });
    await expectCode(() => replyToConcern(drew, { id: withManager, body: 'Me too' }), 'NOT_FOUND');
  });

  it('is invisible to another business', async () => {
    expect(await getConcern(outsider, withManager)).toBeNull();
    expect(await visibleRows(outsider, withManager)).toEqual({ concerns: 0, messages: 0 });
  });
});

describe('a concern raised with the admin only', () => {
  it('reaches the admin', async () => {
    expect((await listConcerns(admin, 'raised')).map((row) => row.id)).toContain(withAdmin);
    expect((await getConcern(admin, withAdmin))?.canHandle).toBe(true);
  });

  it('never reaches a manager, in the service or at the database', async () => {
    expect((await listConcerns(manager, 'raised')).map((row) => row.id)).not.toContain(withAdmin);
    expect(await getConcern(manager, withAdmin)).toBeNull();
    expect(await visibleRows(manager, withAdmin)).toEqual({ concerns: 0, messages: 0 });
    await expectCode(
      () => replyToConcern(manager, { id: withAdmin, body: 'Let us talk' }),
      'NOT_FOUND',
    );
    await expectCode(
      () => setConcernStatus(manager, { id: withAdmin, status: 'resolved' }),
      'NOT_FOUND',
    );
    const changed = (await withRls(manager, (tx) =>
      tx.execute(sql`update concerns set status = 'resolved', resolved_at = now()
                     where id = ${withAdmin} returning id`),
    )) as unknown as unknown[];
    expect(changed).toHaveLength(0);
  });
});

describe('the conversation', () => {
  it('moves an open concern to being looked at when the business answers', async () => {
    await replyToConcern(manager, { id: withManager, body: 'Thanks, I will change next week.' });
    await replyToConcern(casey, { id: withManager, body: 'Thank you.' });
    const detail = await getConcern(casey, withManager);
    expect(detail?.status).toBe('in_progress');
    expect(detail?.messages.map((message) => message.body)).toEqual([
      expect.stringMatching(/close and then open/),
      'Thanks, I will change next week.',
      'Thank you.',
    ]);
    expect(detail!.lastActivityAt.getTime()).toBeGreaterThan(detail!.createdAt.getTime());
  });

  it('does not let the raiser close or reopen it themselves', async () => {
    await expectCode(
      () => setConcernStatus(casey, { id: withManager, status: 'resolved' }),
      'FORBIDDEN',
    );
    const changed = (await withRls(casey, (tx) =>
      tx.execute(sql`update concerns set status = 'resolved', resolved_at = now()
                     where id = ${withManager} returning id`),
    )) as unknown as unknown[];
    expect(changed).toHaveLength(0);
  });

  it('never lets anyone rewrite what was raised or whom it was raised with', async () => {
    const message = await rejectionMessage(() =>
      withRls(admin, (tx) =>
        tx.execute(sql`update concerns set raised_with = 'manager' where id = ${withAdmin}`),
      ),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it('does not let anyone raise a concern in someone else’s name', async () => {
    const message = await rejectionMessage(() =>
      withRls(drew, (tx) =>
        tx.execute(sql`insert into concerns (tenant_id, raised_by, raised_with, category, subject)
                       values (${alphaTenant}, ${casey.userId}, 'manager', 'other', 'Not mine')`),
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it('closes replies once resolved, and opens them again when reopened', async () => {
    await setConcernStatus(manager, { id: withManager, status: 'resolved' });
    expect((await getConcern(casey, withManager))?.resolvedAt).toBeInstanceOf(Date);
    await expectCode(
      () => replyToConcern(casey, { id: withManager, body: 'It happened again' }),
      'CONFLICT',
    );
    await setConcernStatus(admin, { id: withManager, status: 'open' });
    expect((await getConcern(casey, withManager))?.resolvedAt).toBeNull();
    await replyToConcern(casey, { id: withManager, body: 'It happened again' });
  });

  it('records changes in the audit log without what was said', async () => {
    const rows = (await adminDb().execute(sql`
      select action, changes::text as changes, context::text as context from audit_logs
      where tenant_id = ${alphaTenant} and entity_type = 'concern' and entity_id = ${withManager}
      order by created_at`)) as unknown as { action: string; changes: string; context: string }[];
    expect(rows[0]?.action).toBe('create');
    expect(rows.some((row) => row.changes?.includes('resolved'))).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/close and then open|happened again/);
  });
});

describe('the feature switch', () => {
  it('hides concerns entirely while the feature is off, and brings them back', async () => {
    const without = FEATURE_KEYS.filter((key) => key !== 'concerns');
    await adminDb().execute(
      sql`update tenants set features = ${sql.raw(`array[${without.map((key) => `'${key}'`).join(',')}]::text[]`)} where id = ${alphaTenant}`,
    );
    const off = await contextFor(admin.userId, alphaTenant);
    expect(hasPermission(off, 'concerns.raise')).toBe(false);
    await expectCode(() => listConcerns(off, 'raised'), 'FORBIDDEN');
    expect(await visibleRows(off, withAdmin)).toEqual({ concerns: 0, messages: 0 });

    await adminDb().execute(
      sql`update tenants set features = array_append(features, 'concerns') where id = ${alphaTenant}`,
    );
    const on = await contextFor(admin.userId, alphaTenant);
    expect((await listConcerns(on, 'raised')).map((row) => row.id)).toContain(withAdmin);
  });
});
