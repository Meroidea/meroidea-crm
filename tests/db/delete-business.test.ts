import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.HR_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

import { AppError } from '@/lib/errors';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { acceptOffer } from '@/modules/hiring/public';
import { acceptOfferSchema, createHireSchema } from '@/modules/hiring/schemas';
import { createHire, sendContract } from '@/modules/hiring/service';
import { deleteBusinessSchema } from '@/modules/platform/schemas';
import { deleteBusiness, setBusinessStatus } from '@/modules/platform/service';
import { createRosterSchema, saveShiftSchema } from '@/modules/roster/schemas';
import { createRoster, saveShift } from '@/modules/roster/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import type { PlatformAdmin } from '@/server/platform';
import { readObject, writeObject } from '@/server/storage';

import {
  addMember,
  contextFor,
  createAuthUser,
  createWorkspace,
  destroyWorkspace,
  handedOver,
} from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let doomed: string;
let doomedName: string;
let kept: string;
let keptUsers: string[];
let owner: TenantContext;
let admin: PlatformAdmin;
let soleMember: string;
let sharedMember: string;
const filePath = () => `${doomed}/library/${stamp}.pdf`;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

/** Rows anywhere in the business's tables, read from the catalogue so no table is missed. */
async function rowsLeft(tenantId: string): Promise<number> {
  const tables = (await adminDb().execute(sql`
    select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
  `)) as unknown as { name: string }[];
  let total = 0;
  for (const { name } of tables) {
    const [row] = (await adminDb().execute(
      sql`select count(*)::int as n from ${sql.identifier(name)} where tenant_id = ${tenantId}`,
    )) as unknown as { n: number }[];
    total += row?.n ?? 0;
  }
  return total;
}

async function loginExists(userId: string): Promise<boolean> {
  const rows = (await adminDb().execute(
    sql`select 1 from auth.users where id = ${userId}`,
  )) as unknown as unknown[];
  return rows.length > 0;
}

beforeAll(async () => {
  doomedName = `Doomed Example ${stamp}`;
  const business = await createWorkspace(doomedName, mail('doomed-owner'));
  doomed = business.tenantId;
  owner = await contextFor(business.ownerId, doomed);
  // The platform owner here is the business's own owner, so their login must survive.
  admin = { userId: business.ownerId, email: mail('doomed-owner') };
  soleMember = await addMember(doomed, mail('sole'), 'Sole Member', 'member');

  const other = await createWorkspace(`Kept Example ${stamp}`, mail('kept-owner'));
  kept = other.tenantId;
  sharedMember = await createAuthUser(mail('shared'), 'Shared Member');
  for (const tenantId of [doomed, kept]) {
    await adminDb().execute(sql`
      insert into tenant_memberships (tenant_id, user_id, role_id, status)
      select ${tenantId}, ${sharedMember}, r.id, 'active'
      from roles r where r.tenant_id = ${tenantId} and r.key = 'member'`);
  }
  keptUsers = [other.ownerId, sharedMember];

  // Something in most corners of the business: a hire with a contract, a roster, a contact, a file.
  const hired = await createHire(
    owner,
    createHireSchema.parse({
      firstName: 'Hana',
      lastName: 'Hire',
      email: mail('hana'),
      employmentType: 'casual',
      positionTitle: 'Assistant',
      startDate: '2026-07-06',
      payBasis: 'hourly',
      payRate: '35',
    }),
  );
  const link = handedOver(await sendContract(owner, hired.contractId));
  await acceptOffer(
    acceptOfferSchema.parse({
      token: link.split('/offer/')[1],
      fullName: 'Hana Hire',
      readContract: true,
      readStatements: true,
    }),
    { ip: null, userAgent: null },
  );
  const rosterId = (
    await createRoster(owner, createRosterSchema.parse({ startsOn: '2026-10-05', span: 'week' }))
  ).id;
  await saveShift(
    owner,
    saveShiftSchema.parse({
      rosterId,
      userId: soleMember,
      date: '2026-10-05',
      startTime: '09:00',
      endTime: '13:00',
    }),
  );
  await createContact(
    owner,
    createContactSchema.parse({ firstName: 'Cleo', lastName: 'Contact', email: mail('cleo') }),
  );
  await writeObject(filePath(), Buffer.from('%PDF-1.4 example'), 'application/pdf');
}, 180_000);

afterAll(async () => {
  // The platform owner's own login is kept by the deletion on purpose; the test removes it.
  if (kept) await destroyWorkspace(kept, [...keptUsers, admin.userId]);
  await adminDb().execute(sql`delete from platform_audit_logs where business_id = ${doomed}`);
}, 60_000);

describe('deleting a business', () => {
  const confirm = (confirmName: string) =>
    deleteBusinessSchema.parse({ tenantId: doomed, confirmName });

  it('refuses a business that is not suspended, and a name that does not match', async () => {
    await expectCode(() => deleteBusiness(admin, confirm(doomedName)), 'CONFLICT');
    await setBusinessStatus(admin, { tenantId: doomed, status: 'suspended' });
    await expectCode(() => deleteBusiness(admin, confirm('Someone Else')), 'VALIDATION');
    expect(await rowsLeft(doomed)).toBeGreaterThan(0);
  });

  it('removes every row, file and sole login, and records who did it', async () => {
    const before = await rowsLeft(doomed);
    const result = await deleteBusiness(admin, confirm(doomedName));
    expect(result).toMatchObject({
      name: doomedName,
      rows: before + 1,
      files: { removed: 1, failed: 0 },
    });

    expect(await rowsLeft(doomed)).toBe(0);
    const tenant = (await adminDb().execute(
      sql`select 1 from tenants where id = ${doomed}`,
    )) as unknown as unknown[];
    expect(tenant).toHaveLength(0);
    expect(await readObject(filePath())).toBeNull();

    const [log] = (await adminDb().execute(sql`
      select actor_user_id, action, business_name from platform_audit_logs
      where business_id = ${doomed}`)) as unknown as Record<string, string>[];
    expect(log).toEqual({
      actor_user_id: admin.userId,
      action: 'business_deleted',
      business_name: doomedName,
    });
  });

  it('keeps the platform owner’s login and anyone who belongs to another business', async () => {
    expect(await loginExists(soleMember)).toBe(false);
    expect(await loginExists(admin.userId)).toBe(true);
    expect(await loginExists(sharedMember)).toBe(true);
    // The other business is untouched, including the shared member's seat in it.
    const shared = await contextFor(sharedMember, kept);
    expect(shared.tenantId).toBe(kept);
  });

  it('finds nothing to delete the second time', async () => {
    await expectCode(() => deleteBusiness(admin, confirm(doomedName)), 'NOT_FOUND');
  });
});
