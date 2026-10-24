import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { resolveLabels } from '@/lib/tenant/labels';
import { sendPasswordLink, setMemberStatus } from '@/modules/access/service';
import { updateLabels } from '@/modules/settings/workspace';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

import {
  addMember,
  contextFor,
  createAuthUser,
  createWorkspace,
  destroyWorkspace,
  handedOver,
} from '../support/workspaces';

// Milestone 14 security review (ADR-059).

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let userIds: string[];
let owner: TenantContext;
let member: TenantContext;
let victimId: string;

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

async function errorCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
  return 'OK';
}

beforeAll(async () => {
  const workspace = await createWorkspace(`Review Co ${stamp}`, mail('review-owner'));
  tenantId = workspace.tenantId;
  const memberId = await addMember(tenantId, mail('review-member'), 'Morgan Member', 'member');
  victimId = await createAuthUser(mail('review-victim'), 'Vic Elsewhere');
  userIds = [workspace.ownerId, memberId, victimId];
  owner = await contextFor(workspace.ownerId, tenantId);
  member = await contextFor(memberId, tenantId);
});

afterAll(async () => {
  if (tenantId) await destroyWorkspace(tenantId, userIds);
});

describe('a person’s own profile', () => {
  it('lets them change their name and phone, never the email their login is known by', async () => {
    expect(
      await sqlState(() =>
        withRls(member, (tx) =>
          tx.execute(sql`update users set full_name = 'Morgan M.', phone = '0400 000 000'
                         where id = ${member.userId}`),
        ),
      ),
    ).toBe('OK');
    expect(
      await sqlState(() =>
        withRls(member, (tx) =>
          tx.execute(
            sql`update users set email = ${mail('review-victim')} where id = ${member.userId}`,
          ),
        ),
      ),
    ).toBe('42501');
  });

  it('makes a password link for the member’s own login, whatever their profile email says', async () => {
    // A profile email rewritten before migration 0067 must not turn the link into a sign-in for
    // whoever owns that address.
    await adminDb().execute(
      sql`update users set email = ${mail('review-victim')} where id = ${member.userId}`,
    );
    try {
      const link = new URL(handedOver(await sendPasswordLink(owner, member.userId)));
      const { data } = await createSupabaseAdminClient().auth.verifyOtp({
        token_hash: link.searchParams.get('token_hash') ?? '',
        type: 'recovery',
      });
      expect(data.user?.id).toBe(member.userId);
      expect(data.user?.id).not.toBe(victimId);
    } finally {
      await adminDb().execute(
        sql`update users set email = ${mail('review-member')} where id = ${member.userId}`,
      );
    }
  });
});

describe('workspace settings', () => {
  it('are saved under row-level security with an audit entry', async () => {
    const labels = { ...resolveLabels({}), opportunity: { singular: 'Deal', plural: 'Deals' } };
    await updateLabels(owner, labels);
    const [saved] = (await adminDb().execute(
      sql`select labels -> 'opportunity' ->> 'singular' as name from tenants where id = ${tenantId}`,
    )) as unknown as { name: string }[];
    expect(saved?.name).toBe('Deal');
    const audits = (await adminDb().execute(sql`
      select count(*)::int as n from audit_logs
      where tenant_id = ${tenantId} and entity_type = 'tenant' and action = 'update'`)) as unknown as {
      n: number;
    }[];
    expect(audits[0]?.n).toBeGreaterThan(0);
  });

  it('cannot be changed without settings.manage, or who the business is changed at all', async () => {
    const touched = (await withRls(member, (tx) =>
      tx.execute(sql`update tenants set timezone = 'UTC' where id = ${tenantId} returning id`),
    )) as unknown as unknown[];
    expect(touched).toHaveLength(0);
    expect(
      await sqlState(() =>
        withRls(owner, (tx) =>
          tx.execute(sql`update tenants set name = 'Renamed' where id = ${tenantId}`),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(() =>
        withRls(owner, (tx) =>
          tx.execute(sql`update tenants set features = '{}' where id = ${tenantId}`),
        ),
      ),
    ).toBe('42501');
  });

  it('are refused to an admin switched off after their request began', async () => {
    const second = await addMember(tenantId, mail('review-manager'), 'Sam Second', 'manager');
    userIds.push(second);
    await adminDb().execute(sql`
      update tenant_memberships set role_id = (
        select id from roles where tenant_id = ${tenantId} and key = 'owner')
      where tenant_id = ${tenantId} and user_id = ${second}`);
    const stale = await contextFor(second, tenantId);
    await setMemberStatus(owner, { userId: second, status: 'deactivated' });
    expect(
      await errorCode(() =>
        updateLabels(stale, {
          ...resolveLabels({}),
          contact: { singular: 'Guest', plural: 'Guests' },
        }),
      ),
    ).toBe('FORBIDDEN');
  });
});
