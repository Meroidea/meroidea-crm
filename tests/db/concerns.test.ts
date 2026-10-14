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
 * ADR-049: staff ask a manager or the admin about their pay, hours, shifts, leave or anything
 * else. Managers cannot see pay, so a question sent to the admin only must never reach a
 * manager, at the database as well as in the service.
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
let toManagers: string;
let toAdmin: string;
let caseyPayslip: string;
let drewPayslip: string;

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

const ask = (overrides: Record<string, unknown> = {}) =>
  raiseConcernSchema.parse({
    raisedWith: 'manager',
    category: 'roster',
    subject: 'Swap my Saturday shift',
    details: 'Can I swap my Saturday close with someone? I have an exam on Sunday morning.',
    ...overrides,
  });

/** What a person can see of a question straight from the database, past the service. */
const visibleRows = async (ctx: TenantContext, id: string) => {
  const rows = (await withRls(ctx, (tx) =>
    tx.execute(sql`select
      (select count(*)::int from concerns where id = ${id}) as concerns,
      (select count(*)::int from concern_messages where concern_id = ${id}) as messages`),
  )) as unknown as { concerns: number; messages: number }[];
  return rows[0];
};

/** A released payslip for someone, as payroll would leave it. Test fixture, written directly. */
async function releasedPayslip(userId: string, name: string) {
  const db = adminDb();
  const [roster] = (await db.execute(sql`
    insert into rosters (tenant_id, starts_on, ends_on)
    values (${alphaTenant}, '2031-03-03', '2031-03-09') returning id`)) as unknown as {
    id: string;
  }[];
  const [employee] = (await db.execute(sql`
    insert into employees (tenant_id, user_id, first_name, last_name, email, status)
    values (${alphaTenant}, ${userId}, ${name}, 'Crew', ${mail(name.toLowerCase())}, 'active')
    returning id`)) as unknown as { id: string }[];
  const [payslip] = (await db.execute(sql`
    insert into payslips (tenant_id, roster_id, employee_id, user_id, period_start, period_end,
      payment_date, employee_name, minutes, hourly_rate, gross, net, super_rate, super_amount,
      currency, status, released_at)
    values (${alphaTenant}, ${roster!.id}, ${employee!.id}, ${userId}, '2031-03-03', '2031-03-09',
      '2031-03-12', ${name}, 1200, '30.00', '600.00', '600.00', '12.00', '72.00', 'AUD',
      'released', now())
    returning id`)) as unknown as { id: string }[];
  return payslip!.id;
}

beforeAll(async () => {
  const alpha = await createWorkspace('Questions Cafe', mail('questions-alpha'));
  const beta = await createWorkspace('Questions Bistro', mail('questions-beta'));
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
  const managerId = await add('Morgan Manager', mail('q-morgan'), 'manager');
  const caseyId = await add('Casey Crew', mail('q-casey'), 'member');
  const drewId = await add('Drew Crew', mail('q-drew'), 'member');
  manager = await contextFor(managerId, alphaTenant);
  casey = await contextFor(caseyId, alphaTenant);
  drew = await contextFor(drewId, alphaTenant);
  caseyPayslip = await releasedPayslip(caseyId, 'Casey');
  drewPayslip = await releasedPayslip(drewId, 'Drew');

  toManagers = (await raiseConcern(casey, ask())).id;
  toAdmin = (
    await raiseConcern(
      casey,
      ask({
        raisedWith: 'admin',
        category: 'pay',
        subject: 'Hours on my payslip',
        details: 'My approved timesheet says 22 hours but the payslip pays 20. Can you check?',
        payslipId: caseyPayslip,
      }),
    )
  ).id;
}, 120_000);

afterAll(async () => {
  if (alphaTenant) {
    await adminDb().execute(sql`delete from concern_messages where tenant_id = ${alphaTenant}`);
    await adminDb().execute(sql`delete from concerns where tenant_id = ${alphaTenant}`);
    await adminDb().execute(sql`delete from payslips where tenant_id = ${alphaTenant}`);
    await adminDb().execute(sql`delete from employees where tenant_id = ${alphaTenant}`);
    await adminDb().execute(sql`delete from rosters where tenant_id = ${alphaTenant}`);
    await destroyWorkspace(alphaTenant, alphaUsers);
  }
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('who may do what', () => {
  it('lets everyone ask; managers answer; only the admin answers everything', () => {
    expect(hasPermission(casey, 'concerns.raise')).toBe(true);
    expect(hasPermission(casey, 'concerns.handle')).toBe(false);
    expect(hasPermission(manager, 'concerns.handle')).toBe(true);
    expect(hasPermission(manager, 'concerns.handle_all')).toBe(false);
    expect(hasPermission(admin, 'concerns.handle_all')).toBe(true);
  });
});

describe('a question sent to managers', () => {
  it('reaches managers and the admin', async () => {
    expect((await listConcerns(manager, 'raised')).map((row) => row.id)).toContain(toManagers);
    expect((await listConcerns(admin, 'raised')).map((row) => row.id)).toContain(toManagers);
    expect((await getConcern(manager, toManagers))?.canHandle).toBe(true);
  });

  it('is the asker’s own to follow', async () => {
    const mine = await listConcerns(casey, 'mine');
    expect(mine.map((row) => row.id)).toEqual(expect.arrayContaining([toManagers, toAdmin]));
    const detail = await getConcern(casey, toManagers);
    expect(detail?.canHandle).toBe(false);
    expect(detail?.messages[0]?.body).toMatch(/exam on Sunday/);
  });

  it('is invisible to other staff, in the service and at the database', async () => {
    expect(await listConcerns(drew, 'mine')).toEqual([]);
    expect(await getConcern(drew, toManagers)).toBeNull();
    expect(await visibleRows(drew, toManagers)).toEqual({ concerns: 0, messages: 0 });
    await expectCode(() => replyToConcern(drew, { id: toManagers, body: 'Me too' }), 'NOT_FOUND');
    await expectCode(
      () => setConcernStatus(drew, { id: toManagers, status: 'resolved' }),
      'NOT_FOUND',
    );
  });

  it('is invisible to another business', async () => {
    expect(await getConcern(outsider, toManagers)).toBeNull();
    expect(await visibleRows(outsider, toManagers)).toEqual({ concerns: 0, messages: 0 });
  });
});

describe('a question about a payslip, sent to the admin only', () => {
  it('reaches the admin with the payslip it is about', async () => {
    expect((await listConcerns(admin, 'raised')).map((row) => row.id)).toContain(toAdmin);
    const detail = await getConcern(admin, toAdmin);
    expect(detail?.canHandle).toBe(true);
    expect(detail?.payslip).toMatchObject({ id: caseyPayslip, periodStart: '2031-03-03' });
  });

  it('shows the asker their own payslip', async () => {
    expect((await getConcern(casey, toAdmin))?.payslip?.id).toBe(caseyPayslip);
  });

  it('never reaches a manager, in the service or at the database', async () => {
    expect((await listConcerns(manager, 'raised')).map((row) => row.id)).not.toContain(toAdmin);
    expect(await getConcern(manager, toAdmin)).toBeNull();
    expect(await visibleRows(manager, toAdmin)).toEqual({ concerns: 0, messages: 0 });
    await expectCode(
      () => replyToConcern(manager, { id: toAdmin, body: 'Let us talk' }),
      'NOT_FOUND',
    );
    await expectCode(
      () => setConcernStatus(manager, { id: toAdmin, status: 'resolved' }),
      'NOT_FOUND',
    );
    const changed = (await withRls(manager, (tx) =>
      tx.execute(sql`update concerns set status = 'resolved', resolved_at = now()
                     where id = ${toAdmin} returning id`),
    )) as unknown as unknown[];
    expect(changed).toHaveLength(0);
  });

  it('can only be about the asker’s own payslip', async () => {
    await expectCode(
      () => raiseConcern(casey, ask({ category: 'pay', payslipId: drewPayslip })),
      'VALIDATION',
    );
    // Not even someone who runs payroll can file one about another person's payslip.
    await expectCode(
      () => raiseConcern(admin, ask({ category: 'pay', payslipId: caseyPayslip })),
      'VALIDATION',
    );
    const message = await rejectionMessage(() =>
      withRls(casey, (tx) =>
        tx.execute(sql`insert into concerns
          (tenant_id, raised_by, raised_with, category, subject, payslip_id)
          values (${alphaTenant}, ${casey.userId}, 'admin', 'pay', 'Not mine', ${drewPayslip})`),
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });
});

describe('the conversation', () => {
  it('moves a question to being looked at when the business answers', async () => {
    await replyToConcern(manager, { id: toManagers, body: 'Yes, Sam can take it. Swapped.' });
    await replyToConcern(casey, { id: toManagers, body: 'Thank you!' });
    const detail = await getConcern(casey, toManagers);
    expect(detail?.status).toBe('in_progress');
    expect(detail?.messages.map((message) => message.body)).toEqual([
      expect.stringMatching(/exam on Sunday/),
      'Yes, Sam can take it. Swapped.',
      'Thank you!',
    ]);
    expect(detail!.lastActivityAt.getTime()).toBeGreaterThan(detail!.createdAt.getTime());
  });

  it('lets the asker mark it resolved once answered, but not move it along for the business', async () => {
    await expectCode(
      () => setConcernStatus(casey, { id: toManagers, status: 'in_progress' }),
      'CONFLICT',
    );
    await setConcernStatus(casey, { id: toManagers, status: 'resolved' });
    expect((await getConcern(manager, toManagers))?.resolvedAt).toBeInstanceOf(Date);
    // At the database too: the asker may set only open or resolved.
    const message = await rejectionMessage(() =>
      withRls(casey, (tx) =>
        tx.execute(sql`update concerns set status = 'in_progress', resolved_at = null
                       where id = ${toManagers}`),
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it('reopens a resolved question when someone replies to it', async () => {
    await replyToConcern(casey, { id: toManagers, body: 'Sorry, one more thing about Sunday.' });
    const reopened = await getConcern(casey, toManagers);
    expect(reopened).toMatchObject({ status: 'open', resolvedAt: null });
    await setConcernStatus(manager, { id: toManagers, status: 'resolved' });
    await replyToConcern(manager, { id: toManagers, body: 'Happy to help.' });
    expect((await getConcern(casey, toManagers))?.status).toBe('in_progress');
  });

  it('never lets anyone rewrite what was asked, whom it was sent to or which payslip', async () => {
    for (const change of [
      sql`update concerns set raised_with = 'manager' where id = ${toAdmin}`,
      sql`update concerns set payslip_id = null where id = ${toAdmin}`,
      sql`update concerns set subject = 'Changed' where id = ${toAdmin}`,
    ]) {
      expect(await rejectionMessage(() => withRls(admin, (tx) => tx.execute(change)))).toMatch(
        /permission denied/i,
      );
    }
  });

  it('does not let anyone ask in someone else’s name', async () => {
    const message = await rejectionMessage(() =>
      withRls(drew, (tx) =>
        tx.execute(sql`insert into concerns (tenant_id, raised_by, raised_with, category, subject)
                       values (${alphaTenant}, ${casey.userId}, 'manager', 'other', 'Not mine')`),
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it('records changes in the audit log without what was said', async () => {
    const rows = (await adminDb().execute(sql`
      select action, changes::text as changes, context::text as context from audit_logs
      where tenant_id = ${alphaTenant} and entity_type = 'concern' and entity_id = ${toManagers}
      order by created_at`)) as unknown as { action: string; changes: string; context: string }[];
    expect(rows[0]?.action).toBe('create');
    expect(rows.some((row) => row.changes?.includes('resolved'))).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/exam on Sunday|Swapped|one more thing/);
  });
});

describe('the feature switch', () => {
  it('hides questions entirely while the feature is off, and brings them back', async () => {
    const without = FEATURE_KEYS.filter((key) => key !== 'concerns');
    await adminDb().execute(
      sql`update tenants set features = ${sql.raw(`array[${without.map((key) => `'${key}'`).join(',')}]::text[]`)} where id = ${alphaTenant}`,
    );
    const off = await contextFor(admin.userId, alphaTenant);
    expect(hasPermission(off, 'concerns.raise')).toBe(false);
    await expectCode(() => listConcerns(off, 'raised'), 'FORBIDDEN');
    expect(await visibleRows(off, toAdmin)).toEqual({ concerns: 0, messages: 0 });

    await adminDb().execute(
      sql`update tenants set features = array_append(features, 'concerns') where id = ${alphaTenant}`,
    );
    const on = await contextFor(admin.userId, alphaTenant);
    expect((await listConcerns(on, 'raised')).map((row) => row.id)).toContain(toAdmin);
  });
});
