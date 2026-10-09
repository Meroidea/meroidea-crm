import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { inviteMemberSchema, setPasswordSchema } from '@/modules/access/schemas';
import { inviteMember, sendPasswordLink, setMemberStatus } from '@/modules/access/service';
import { loadTenantContext, type TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let member: TenantContext;
let betaOwner: TenantContext;
let memberRoleId: string;
let betaRoleId: string;

async function roleId(tenantId: string, key: string) {
  const rows = (await adminDb().execute(
    sql`select id from roles where tenant_id = ${tenantId} and key = ${key}`,
  )) as unknown as { id: string }[];
  return rows[0]!.id;
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );

beforeAll(async () => {
  const alpha = await createWorkspace(`Access Alpha ${stamp}`, mail('access-alpha-owner'));
  const beta = await createWorkspace(`Access Beta ${stamp}`, mail('access-beta-owner'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  const memberId = await addMember(alphaTenant, mail('access-member'), 'Morgan Member', 'member');
  alphaUsers = [alpha.ownerId, memberId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  member = await contextFor(memberId, alphaTenant);
  betaOwner = await contextFor(beta.ownerId, betaTenant);
  memberRoleId = await roleId(alphaTenant, 'member');
  betaRoleId = await roleId(betaTenant, 'member');
});

afterAll(async () => {
  await destroyWorkspace(alphaTenant, alphaUsers);
  await destroyWorkspace(betaTenant, betaUsers);
});

describe('adding people', () => {
  it('an admin adds a person, who can then reach the workspace with that role', async () => {
    const input = inviteMemberSchema.parse({
      fullName: 'Casey Newstart',
      email: mail('Access-Invited'),
      roleId: memberRoleId,
    });
    const result = await inviteMember(owner, input);
    alphaUsers.push(result.userId);

    // No email service in tests, so the link comes back for the admin to pass on.
    expect(result.emailed).toBe(false);
    const link = new URL(result.link);
    expect(link.pathname).toBe('/auth/confirm');
    expect(link.searchParams.get('type')).toBe('recovery');

    const ctx = await contextFor(result.userId, alphaTenant);
    expect(ctx.roleKey).toBe('member');
  });

  it('the one-time link signs its owner in exactly once', async () => {
    const { link } = await sendPasswordLink(owner, member.userId);
    const tokenHash = new URL(link).searchParams.get('token_hash')!;
    const client = createSupabaseAdminClient();
    const first = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
    expect(first.data.user?.id).toBe(member.userId);
    const second = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
    expect(second.error).not.toBeNull();
  });

  it('an email that already has a login is refused', async () => {
    const input = inviteMemberSchema.parse({
      fullName: 'Morgan Again',
      email: mail('access-member'),
      roleId: memberRoleId,
    });
    expect(await code(inviteMember(owner, input))).toBe('CONFLICT');
  });

  it('a role from another business cannot be used, and leaves no login behind', async () => {
    const email = mail('access-wrong-role');
    const input = inviteMemberSchema.parse({ fullName: 'Robin Wrong', email, roleId: betaRoleId });
    expect(await code(inviteMember(owner, input))).toBe('VALIDATION');
    const rows = (await adminDb().execute(
      sql`select 1 from auth.users where email = ${email}`,
    )) as unknown as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('someone without the permission cannot add people or send links', async () => {
    const input = inviteMemberSchema.parse({
      fullName: 'Sam Sneaky',
      email: mail('access-sneaky'),
      roleId: memberRoleId,
    });
    expect(await code(inviteMember(member, input))).toBe('FORBIDDEN');
    expect(await code(sendPasswordLink(member, owner.userId))).toBe('FORBIDDEN');
    expect(
      await code(setMemberStatus(member, { userId: owner.userId, status: 'deactivated' })),
    ).toBe('FORBIDDEN');
  });
});

describe('other businesses', () => {
  it("an admin cannot send a password link for another business's person", async () => {
    expect(await code(sendPasswordLink(betaOwner, member.userId))).toBe('NOT_FOUND');
  });

  it("an admin cannot deactivate another business's person", async () => {
    expect(
      await code(setMemberStatus(betaOwner, { userId: member.userId, status: 'deactivated' })),
    ).toBe('NOT_FOUND');
  });
});

describe('deactivating', () => {
  it('a deactivated person loses the workspace and gets it back when reactivated', async () => {
    await setMemberStatus(owner, { userId: member.userId, status: 'deactivated' });
    expect(
      await loadTenantContext({ sub: member.userId, role: 'authenticated' }, alphaTenant),
    ).toBeNull();
    expect(await code(sendPasswordLink(owner, member.userId))).toBe('OK');

    await setMemberStatus(owner, { userId: member.userId, status: 'active' });
    expect((await contextFor(member.userId, alphaTenant)).roleKey).toBe('member');
  });

  it('nobody can deactivate their own login', async () => {
    expect(
      await code(setMemberStatus(owner, { userId: owner.userId, status: 'deactivated' })),
    ).toBe('CONFLICT');
  });

  it('a second owner can switch the first owner off and on again', async () => {
    const ownerRole = await roleId(alphaTenant, 'owner');
    const second = await inviteMember(
      owner,
      inviteMemberSchema.parse({
        fullName: 'Second Owner',
        email: mail('access-second-owner'),
        roleId: ownerRole,
      }),
    );
    alphaUsers.push(second.userId);
    const secondCtx = await contextFor(second.userId, alphaTenant);
    await setMemberStatus(owner, { userId: second.userId, status: 'deactivated' });
    await setMemberStatus(owner, { userId: second.userId, status: 'active' });
    await setMemberStatus(secondCtx, { userId: owner.userId, status: 'deactivated' });
    // Now `second` is the only active owner; the deactivated first owner cannot act at all.
    expect(
      await loadTenantContext({ sub: owner.userId, role: 'authenticated' }, alphaTenant),
    ).toBeNull();
    await setMemberStatus(secondCtx, { userId: owner.userId, status: 'active' });
  });
});

describe('password rules', () => {
  it('needs ten characters and a matching confirmation', () => {
    expect(setPasswordSchema.safeParse({ password: 'short', confirm: 'short' }).success).toBe(
      false,
    );
    expect(
      setPasswordSchema.safeParse({ password: 'long-enough-1', confirm: 'different-1' }).success,
    ).toBe(false);
    expect(
      setPasswordSchema.safeParse({ password: 'long-enough-1', confirm: 'long-enough-1' }).success,
    ).toBe(true);
  });
});
