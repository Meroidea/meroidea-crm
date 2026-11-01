import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.HR_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

import { AppError } from '@/lib/errors';
import { listHireLoginRoles } from '@/modules/access/queries';
import { inviteMemberSchema } from '@/modules/access/schemas';
import { inviteMember } from '@/modules/access/service';
import { acceptOffer, getOfferByToken } from '@/modules/hiring/public';
import { acceptOfferSchema, createHireSchema } from '@/modules/hiring/schemas';
import { createHire, sendContract } from '@/modules/hiring/service';
import { updateProfileSchema } from '@/modules/hiring/staff-schemas';
import { updateEmployeeProfile } from '@/modules/hiring/staff-service';
import { listTasks } from '@/modules/tasks/queries';
import { createTaskSchema } from '@/modules/tasks/schemas';
import { createTask } from '@/modules/tasks/service';
import { loadTenantContext, type TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';

import {
  contextFor,
  createAuthUser,
  createWorkspace,
  destroyWorkspace,
  handedOver,
} from '../support/workspaces';

/*
 * ADR-048: a business's roles are Admin, Manager and Staff; everyone added joins the business's
 * team so a Manager's `team` scope covers the staff they assign work to; and a new hire gets the
 * login chosen when they were hired as soon as they accept their offer.
 */

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

let alphaTenant: string;
let betaTenant: string;
const alphaUsers: string[] = [];
const betaUsers: string[] = [];
let admin: TenantContext;
let outsider: TenantContext;
let managerRoleId: string;
let staffRoleId: string;
let ownerRoleId: string;
let alphaTeamId: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const roleIdOf = async (tenantId: string, key: string) => {
  const rows = (await adminDb().execute(
    sql`select id from roles where tenant_id = ${tenantId} and key = ${key}`,
  )) as unknown as { id: string }[];
  return rows[0]?.id ?? '';
};

const membershipOf = async (tenantId: string, userId: string) => {
  const rows = (await adminDb().execute(sql`
    select m.team_id, m.status, r.key as role_key
    from tenant_memberships m join roles r on r.id = m.role_id
    where m.tenant_id = ${tenantId} and m.user_id = ${userId}`)) as unknown as {
    team_id: string | null;
    status: string;
    role_key: string;
  }[];
  return rows[0] ?? null;
};

const userIdOf = async (email: string) => {
  const rows = (await adminDb().execute(
    sql`select id from auth.users where email = ${email}`,
  )) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
};

const employeeLogin = async (employeeId: string) => {
  const rows = (await adminDb().execute(
    sql`select user_id from employees where id = ${employeeId}`,
  )) as unknown as { user_id: string | null }[];
  return rows[0]?.user_id ?? null;
};

const hire = (name: string, overrides: Record<string, unknown> = {}) =>
  createHireSchema.parse({
    firstName: name,
    lastName: 'Newstart',
    email: mail(name.toLowerCase()),
    employmentType: 'casual',
    positionTitle: 'Barista',
    startDate: '2031-03-03',
    payBasis: 'hourly',
    payRate: '35.50',
    awardCode: 'MA000119',
    awardName: 'Restaurant Industry Award 2020',
    classification: 'Level 2',
    minimumRate: '31.20',
    ...overrides,
  });

/** Hires, sends the contract and accepts it as the new hire would. Returns what was made. */
async function hireAndAccept(name: string, overrides: Record<string, unknown> = {}) {
  const created = await createHire(admin, hire(name, overrides));
  const sent = await sendContract(admin, created.contractId);
  const token = handedOver(sent).split('/offer/')[1] ?? '';
  await acceptOffer(
    acceptOfferSchema.parse({
      token,
      fullName: `${name} Newstart`,
      readContract: true,
      readStatements: true,
    }),
    META,
  );
  const userId = await employeeLogin(created.employeeId);
  if (userId) alphaUsers.push(userId);
  return { employeeId: created.employeeId, token, userId };
}

beforeAll(async () => {
  const alpha = await createWorkspace('Roles Cafe', mail('roles-alpha'));
  const beta = await createWorkspace('Roles Bistro', mail('roles-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  alphaUsers.push(alpha.ownerId);
  betaUsers.push(beta.ownerId);
  admin = await contextFor(alpha.ownerId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);
  managerRoleId = await roleIdOf(alphaTenant, 'manager');
  staffRoleId = await roleIdOf(alphaTenant, 'member');
  ownerRoleId = await roleIdOf(alphaTenant, 'owner');
  const teams = (await adminDb().execute(
    sql`select id from teams where tenant_id = ${alphaTenant}`,
  )) as unknown as { id: string }[];
  alphaTeamId = teams[0]?.id ?? '';
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('roles in a new business', () => {
  it('are Admin, Manager and Staff, and nothing else', async () => {
    const rows = (await adminDb().execute(sql`
      select key, name from roles where tenant_id = ${alphaTenant} order by key`)) as unknown as {
      key: string;
      name: string;
    }[];
    expect(rows).toEqual([
      { key: 'manager', name: 'Manager' },
      { key: 'member', name: 'Staff' },
      { key: 'owner', name: 'Admin' },
    ]);
    expect(admin.roleName).toBe('Admin');
  });

  it('offer a hire Staff first, then Manager, and never Admin', async () => {
    expect((await listHireLoginRoles(admin)).map((role) => role.name)).toEqual([
      'Staff',
      'Manager',
    ]);
  });
});

describe('a manager and their staff', () => {
  let manager: TenantContext;
  let casey: TenantContext;
  let drew: TenantContext;

  beforeAll(async () => {
    const add = async (fullName: string, email: string, roleId: string) => {
      const { userId } = await inviteMember(
        admin,
        inviteMemberSchema.parse({ fullName, email, roleId }),
      );
      alphaUsers.push(userId);
      return contextFor(userId, alphaTenant);
    };
    manager = await add('Morgan Manager', mail('morgan'), managerRoleId);
    casey = await add('Casey Crew', mail('casey'), staffRoleId);
    drew = await add('Drew Crew', mail('drew'), staffRoleId);
    // A context is built per request; rebuild the manager's now that the others have joined.
    manager = await contextFor(manager.userId, alphaTenant);
  }, 60_000);

  it('are all put in the business’s team when an admin adds them', async () => {
    for (const person of [manager, casey, drew]) {
      expect((await membershipOf(alphaTenant, person.userId))?.team_id).toBe(alphaTeamId);
    }
    expect(manager.teamUserIds).toEqual(expect.arrayContaining([casey.userId, drew.userId]));
  });

  it('lets the manager assign a task to staff and keep seeing it', async () => {
    await createTask(
      manager,
      createTaskSchema.parse({ title: 'Restock the cold room', assignedTo: casey.userId }),
    );
    const managerView = await listTasks(manager, {});
    expect(managerView.map((task) => task.title)).toContain('Restock the cold room');
    const caseyView = await listTasks(casey, {});
    expect(caseyView.map((task) => task.title)).toContain('Restock the cold room');
  });

  it('does not show one staff member another’s task', async () => {
    const drewView = await listTasks(drew, {});
    expect(drewView.map((task) => task.title)).not.toContain('Restock the cold room');
  });

  it('does not let staff assign work to others', async () => {
    await expectCode(
      () =>
        createTask(
          casey,
          createTaskSchema.parse({ title: 'Do my shift', assignedTo: drew.userId }),
        ),
      'FORBIDDEN',
    );
  });

  it('does not show another business the task', async () => {
    const theirs = await listTasks(outsider, {});
    expect(theirs.map((task) => task.title)).not.toContain('Restock the cold room');
  });
});

describe('a login when a hire accepts their offer', () => {
  it('gives a Staff login, in the business’s team, linked to their employee record', async () => {
    const { employeeId, token, userId } = await hireAndAccept('Sky', {
      loginRoleId: staffRoleId,
    });
    expect(userId).not.toBeNull();
    expect(await membershipOf(alphaTenant, userId!)).toEqual({
      team_id: alphaTeamId,
      status: 'active',
      role_key: 'member',
    });
    const ctx = await loadTenantContext({ sub: userId!, role: 'authenticated' }, alphaTenant);
    expect(ctx).toMatchObject({ roleKey: 'member', roleName: 'Staff' });
    expect((await getOfferByToken(token))?.loginEmail).toBe(mail('sky'));

    const logged = (await adminDb().execute(sql`
      select actor_type, context ->> 'fromHire' as from_hire from audit_logs
      where tenant_id = ${alphaTenant} and context ->> 'loginCreated' = 'true'
        and context ->> 'fromHire' = ${employeeId}`)) as unknown as {
      actor_type: string;
      from_hire: string;
    }[];
    expect(logged).toEqual([{ actor_type: 'employee_link', from_hire: employeeId }]);
  });

  it('gives a Manager login when that was chosen', async () => {
    const { userId } = await hireAndAccept('Remy', { loginRoleId: managerRoleId });
    expect((await membershipOf(alphaTenant, userId!))?.role_key).toBe('manager');
  });

  it('gives no login when none was chosen', async () => {
    const { userId, token } = await hireAndAccept('Noor');
    expect(userId).toBeNull();
    expect(await userIdOf(mail('noor'))).toBeNull();
    expect((await getOfferByToken(token))?.loginEmail).toBeNull();
  });

  it('never gives the Admin role or another business’s role through hiring', async () => {
    await expectCode(
      () => createHire(admin, hire('Ola', { loginRoleId: ownerRoleId })),
      'VALIDATION',
    );
    const betaStaff = await roleIdOf(betaTenant, 'member');
    await expectCode(
      () => createHire(admin, hire('Ola', { loginRoleId: betaStaff })),
      'VALIDATION',
    );
  });

  it('lets only someone who may give logins choose one', async () => {
    const hiringOnly: TenantContext = {
      ...admin,
      grants: new Map([...admin.grants].filter(([key]) => key !== 'users.manage')),
    };
    await expectCode(
      () => createHire(hiringOnly, hire('Pia', { loginRoleId: staffRoleId })),
      'FORBIDDEN',
    );
    // Hiring itself is still theirs to do, without a login.
    await expect(createHire(hiringOnly, hire('Pia'))).resolves.toBeTruthy();
  });

  it('lets only someone who may give logins move a pending login to another address', async () => {
    const hiringOnly: TenantContext = {
      ...admin,
      grants: new Map([...admin.grants].filter(([key]) => key !== 'users.manage')),
    };
    const created = await createHire(admin, hire('Quin', { loginRoleId: staffRoleId }));
    const profile = (email: string) =>
      updateProfileSchema.parse({
        id: created.employeeId,
        firstName: 'Quin',
        lastName: 'Newstart',
        email,
      });
    await expectCode(
      () => updateEmployeeProfile(hiringOnly, profile(mail('someone-else'))),
      'FORBIDDEN',
    );
    // Other details are still theirs to keep up to date.
    await expect(
      updateEmployeeProfile(hiringOnly, { ...profile(mail('quin')), phone: '0400 000 000' }),
    ).resolves.toBeTruthy();
    await expect(updateEmployeeProfile(admin, profile(mail('quin-new')))).resolves.toBeTruthy();
  });

  it('links the staff record to the login of someone already in the business', async () => {
    const { userId: existing } = await inviteMember(
      admin,
      inviteMemberSchema.parse({
        fullName: 'Tali Newstart',
        email: mail('tali'),
        roleId: staffRoleId,
      }),
    );
    alphaUsers.push(existing);
    const { userId } = await hireAndAccept('Tali', { loginRoleId: staffRoleId });
    expect(userId).toBe(existing);
    expect((await membershipOf(alphaTenant, existing))?.role_key).toBe('member');
  });

  // ADR-059: public.users.email is a profile copy. Matching on it let a member who rewrote theirs
  // (through the Data API, before migration 0067) receive the staff record and payslips of a new
  // hire who already had a login elsewhere.
  it('does not hand a staff record to someone who only changed their profile email', async () => {
    const { userId: insider } = await inviteMember(
      admin,
      inviteMemberSchema.parse({
        fullName: 'Ira Insider',
        email: mail('ira'),
        roleId: staffRoleId,
      }),
    );
    alphaUsers.push(insider);
    const elsewhere = await createAuthUser(mail('rosa'), 'Rosa Elsewhere');
    betaUsers.push(elsewhere);
    await adminDb().execute(sql`update users set email = ${mail('rosa')} where id = ${insider}`);

    const { employeeId, userId } = await hireAndAccept('Rosa', { loginRoleId: staffRoleId });
    expect(userId).toBeNull();
    expect(await employeeLogin(employeeId)).toBeNull();
  });

  it('keeps the acceptance when the email already has a login, and makes none', async () => {
    const existing = await createAuthUser(mail('quinn'), 'Quinn Elsewhere');
    betaUsers.push(existing);
    const { employeeId, token, userId } = await hireAndAccept('Quinn', {
      loginRoleId: staffRoleId,
    });
    expect(userId).toBeNull();
    expect(await membershipOf(alphaTenant, existing)).toBeNull();
    const offer = await getOfferByToken(token);
    expect(offer).toMatchObject({ status: 'accepted', loginEmail: null });
    const logged = (await adminDb().execute(sql`
      select context ->> 'reason' as reason from audit_logs
      where tenant_id = ${alphaTenant} and entity_id = ${employeeId}
        and context ->> 'loginCreated' = 'false'`)) as unknown as { reason: string }[];
    expect(logged).toEqual([{ reason: 'email_in_use' }]);
  });
});
