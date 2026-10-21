import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLogs, users } from '@/db/schema';
import { getMyProfile } from '@/modules/profile/queries';
import { updateMyProfileSchema } from '@/modules/profile/schemas';
import { updateMyProfile } from '@/modules/profile/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

/*
 * "My details": a signed-in person edits their own name and phone, and nobody else's. The service
 * only ever writes the caller's row, and RLS (users_update_self) refuses any other row.
 */

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
const alphaUsers: string[] = [];
const betaUsers: string[] = [];
let robin: TenantContext;
let sam: TenantContext;
let outsider: TenantContext;

beforeAll(async () => {
  const alpha = await createWorkspace('Profile Cafe', mail('profile-alpha'));
  const beta = await createWorkspace('Profile Bistro', mail('profile-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  alphaUsers.push(alpha.ownerId);
  betaUsers.push(beta.ownerId);
  const robinId = await addMember(alphaTenant, mail('robin'), 'Robin Hale', 'member');
  const samId = await addMember(alphaTenant, mail('sam'), 'Sam Ortiz', 'member');
  alphaUsers.push(robinId, samId);
  robin = await contextFor(robinId, alphaTenant);
  sam = await contextFor(samId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);
});

afterAll(async () => {
  await destroyWorkspace(alphaTenant, alphaUsers);
  await destroyWorkspace(betaTenant, betaUsers);
});

const parse = (input: Record<string, unknown>) => updateMyProfileSchema.parse(input);

describe('my details', () => {
  it('a person changes their own name and phone, and the change is audited', async () => {
    await updateMyProfile(
      robin,
      parse({ fullName: '  Robin Hale-Price ', phone: '+61 400 000 001' }),
    );

    const profile = await getMyProfile(robin);
    expect(profile.fullName).toBe('Robin Hale-Price');
    expect(profile.phone).toBe('+61 400 000 001');
    expect(profile.email).toBe(robin.email);

    const entries = await adminDb()
      .select({ changes: auditLogs.changes, actor: auditLogs.actorUserId })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, alphaTenant),
          eq(auditLogs.entityType, 'user'),
          eq(auditLogs.entityId, robin.userId),
        ),
      );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actor).toBe(robin.userId);
    expect(Object.keys(entries[0]?.changes ?? {}).sort()).toEqual(['fullName', 'phone']);
  });

  it('saving without a change writes nothing to the audit log', async () => {
    await updateMyProfile(robin, parse({ fullName: 'Robin Hale-Price', phone: '+61 400 000 001' }));
    const [row] = (await adminDb().execute(sql`
      select count(*)::int as n from audit_logs
      where tenant_id = ${alphaTenant} and entity_type = 'user' and entity_id = ${robin.userId}`)) as unknown as {
      n: number;
    }[];
    expect(row?.n).toBe(1);
  });

  it('clearing the phone stores no phone', async () => {
    await updateMyProfile(sam, parse({ fullName: 'Sam Ortiz', phone: '   ' }));
    expect((await getMyProfile(sam)).phone).toBeNull();
  });

  it('a colleague cannot change another person’s details, even writing directly', async () => {
    const changed = await withRls(sam, (tx) =>
      tx
        .update(users)
        .set({ fullName: 'Hijacked' })
        .where(eq(users.id, robin.userId))
        .returning({ id: users.id }),
    );
    expect(changed).toHaveLength(0);
    expect((await getMyProfile(robin)).fullName).toBe('Robin Hale-Price');
  });

  it('someone in another business cannot read a person’s details', async () => {
    const rows = await withRls(outsider, (tx) =>
      tx.select({ phone: users.phone }).from(users).where(eq(users.id, robin.userId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects an empty name and a phone with letters', () => {
    expect(updateMyProfileSchema.safeParse({ fullName: ' ', phone: '' }).success).toBe(false);
    expect(updateMyProfileSchema.safeParse({ fullName: 'Robin', phone: 'call me' }).success).toBe(
      false,
    );
  });
});
