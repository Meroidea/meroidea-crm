import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { inviteMemberSchema } from '@/modules/access/schemas';
import { inviteMember } from '@/modules/access/service';
import { roleSchema } from '@/modules/crm-config/schemas';
import { saveRole } from '@/modules/crm-config/service';
import { changeMemberRole } from '@/modules/settings/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
const userIds: string[] = [];
let admin: TenantContext;
let officeManager: TenantContext;
let ownerRoleId: string;

async function code(run: () => Promise<unknown>) {
  return run().then(
    () => 'OK',
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );
}

const roleIdOf = async (key: string) => {
  const rows = (await adminDb().execute(
    sql`select id from roles where tenant_id = ${tenantId} and key = ${key}`,
  )) as unknown as { id: string }[];
  return rows[0]!.id;
};

beforeAll(async () => {
  const workspace = await createWorkspace(`Escalation ${stamp}`, mail('esc-admin'));
  tenantId = workspace.tenantId;
  userIds.push(workspace.ownerId);
  admin = await contextFor(workspace.ownerId, tenantId);
  ownerRoleId = await roleIdOf('owner');

  // An Admin sets up a role for onboarding staff: it may add people and manage roles, nothing
  // about pay or settings.
  await saveRole(
    admin,
    roleSchema.parse({
      name: 'Office manager',
      grants: { 'users.manage': 'true', 'roles.manage': 'true' },
    }),
  );
  const officeRoleId = await roleIdOf('office-manager');
  const officeId = await addMember(tenantId, mail('esc-office'), 'Olive Office', 'member');
  userIds.push(officeId);
  await adminDb().execute(
    sql`update tenant_memberships set role_id = ${officeRoleId} where user_id = ${officeId}`,
  );
  officeManager = await contextFor(officeId, tenantId);
});

afterAll(async () => {
  await destroyWorkspace(tenantId, userIds);
});

describe('managing people without being Admin', () => {
  it('cannot make themselves, or anyone else, Admin', async () => {
    expect(
      await code(() =>
        changeMemberRole(officeManager, { userId: officeManager.userId, roleId: ownerRoleId }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await code(() =>
        inviteMember(
          officeManager,
          inviteMemberSchema.parse({
            fullName: 'New Admin',
            email: mail('esc-new-admin'),
            roleId: ownerRoleId,
          }),
        ),
      ),
    ).toBe('FORBIDDEN');
  });

  it('cannot demote the Admin', async () => {
    const memberRoleId = await roleIdOf('member');
    expect(
      await code(() =>
        changeMemberRole(officeManager, { userId: admin.userId, roleId: memberRoleId }),
      ),
    ).toBe('FORBIDDEN');
  });

  it('cannot give a role, their own included, permissions they do not have', async () => {
    const officeRoleId = await roleIdOf('office-manager');
    expect(
      await code(() =>
        saveRole(
          officeManager,
          roleSchema.parse({
            id: officeRoleId,
            name: 'Office manager',
            grants: { 'users.manage': 'true', 'roles.manage': 'true', 'payroll.manage': 'true' },
          }),
        ),
      ),
    ).toBe('FORBIDDEN');
  });

  it('still lets an Admin make someone Admin', async () => {
    const result = await changeMemberRole(admin, {
      userId: officeManager.userId,
      roleId: ownerRoleId,
    });
    expect(result.id).toBeTruthy();
  });
});
