import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { BUSINESS_TYPES, featureForPermission } from '@/lib/features';
import { createItemSchema } from '@/modules/inventory/schemas';
import { createItem } from '@/modules/inventory/service';
import { listItems } from '@/modules/inventory/queries';
import { createBusinessSchema } from '@/modules/platform/schemas';
import {
  createBusiness,
  endSupportAccess,
  getBusiness,
  listBusinesses,
  setBusinessFeatures,
  setBusinessStatus,
  startSupportAccess,
} from '@/modules/platform/service';
import { hasFeature, hasPermission, loadTenantContext, type TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';
import type { PlatformAdmin } from '@/server/platform';

import {
  contextFor,
  createAuthUser,
  createWorkspace,
  destroyWorkspace,
} from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let admin: PlatformAdmin;
let homeTenant: string;
let cafeTenant: string;
let cafeOwnerId: string;
let cafeOwner: TenantContext;
const cleanup: { tenantId: string; userIds: string[] }[] = [];

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const ownerOf = async (tenantId: string) => {
  const rows = (await adminDb().execute(sql`
    select m.user_id from tenant_memberships m join roles r on r.id = m.role_id
    where m.tenant_id = ${tenantId} and r.key = 'owner' and not m.is_support limit 1`)) as unknown as {
    user_id: string;
  }[];
  return rows[0]?.user_id ?? '';
};

beforeAll(async () => {
  // The platform owner is an ordinary user with a business of their own.
  const home = await createWorkspace('Platform Home', mail('plat-owner'));
  homeTenant = home.tenantId;
  admin = { userId: home.ownerId, email: mail('plat-owner') };
  cleanup.push({ tenantId: homeTenant, userIds: [home.ownerId] });

  const created = await createBusiness(
    admin,
    createBusinessSchema.parse({
      companyName: 'Corner Cafe',
      businessType: 'restaurant',
      adminName: 'Cara Cafe',
      adminEmail: mail('cafe-admin'),
      features: ['roster', 'inventory'],
    }),
  );
  cafeTenant = created.tenantId;
  cafeOwnerId = await ownerOf(cafeTenant);
  cafeOwner = await contextFor(cafeOwnerId, cafeTenant);
  cleanup.push({ tenantId: cafeTenant, userIds: [cafeOwnerId] });
}, 120_000);

afterAll(async () => {
  await adminDb().execute(sql`delete from tenant_memberships where is_support`);
  for (const { tenantId, userIds } of cleanup) await destroyWorkspace(tenantId, userIds);
}, 60_000);

describe('onboarding a business', () => {
  it('creates an active workspace with only the chosen features and an owner login', async () => {
    const business = await getBusiness(admin, cafeTenant);
    expect(business).toMatchObject({
      name: 'Corner Cafe',
      industry: 'restaurant',
      status: 'active',
      features: ['roster', 'inventory'],
      members: 1,
    });
    expect(cafeOwner.roleKey).toBe('owner');
  });

  it('refuses an admin email that already has a login', async () => {
    await expectCode(
      () =>
        createBusiness(
          admin,
          createBusinessSchema.parse({
            companyName: 'Second Cafe',
            businessType: 'restaurant',
            adminName: 'Cara Again',
            adminEmail: mail('cafe-admin'),
            features: [],
          }),
        ),
      'CONFLICT',
    );
  });

  it('lists every business for the platform owner', async () => {
    const names = (await listBusinesses(admin)).map((business) => business.name);
    expect(names).toEqual(expect.arrayContaining(['Corner Cafe', 'Platform Home']));
  });

  it('offers a starting set of features for each kind of business', () => {
    const preset = (key: string) => BUSINESS_TYPES.find((type) => type.key === key)?.features;
    expect(preset('restaurant')).toEqual(
      expect.arrayContaining(['inventory', 'purchasing', 'roster']),
    );
    expect(preset('restaurant')).not.toContain('crm');
    expect(preset('consultancy')).toEqual(expect.arrayContaining(['crm', 'tasks']));
    expect(preset('consultancy')).not.toContain('inventory');
  });
});

describe('feature switches', () => {
  it('maps each permission family to its feature, and leaves workspace basics always on', () => {
    expect(featureForPermission('contacts.view')).toBe('crm');
    expect(featureForPermission('inventory.manage')).toBe('inventory');
    expect(featureForPermission('payroll.manage')).toBe('payroll');
    expect(featureForPermission('settings.manage')).toBeNull();
    expect(featureForPermission('users.manage')).toBeNull();
  });

  it('gives even the owner only the permissions of features that are switched on', () => {
    expect(hasFeature(cafeOwner, 'inventory')).toBe(true);
    expect(hasPermission(cafeOwner, 'inventory.manage')).toBe(true);
    expect(hasPermission(cafeOwner, 'rosters.manage')).toBe(true);
    expect(hasFeature(cafeOwner, 'crm')).toBe(false);
    expect(hasPermission(cafeOwner, 'contacts.view')).toBe(false);
    expect(hasPermission(cafeOwner, 'invoices.manage')).toBe(false);
    expect(hasPermission(cafeOwner, 'settings.manage')).toBe(true);
  });

  it('refuses a switched-off feature in the service, and allows it again once switched on', async () => {
    const item = createItemSchema.parse({ name: 'Coffee beans', unit: 'kg' });
    await createItem(cafeOwner, item);

    await setBusinessFeatures(admin, { tenantId: cafeTenant, features: ['roster'] });
    const without = await contextFor(cafeOwnerId, cafeTenant);
    await expectCode(() => listItems(without, {}), 'FORBIDDEN');
    await expectCode(() => createItem(without, { ...item, name: 'Milk' }), 'FORBIDDEN');

    // Switching it back on brings the records back: nothing was deleted.
    await setBusinessFeatures(admin, { tenantId: cafeTenant, features: ['roster', 'inventory'] });
    const again = await contextFor(cafeOwnerId, cafeTenant);
    expect((await listItems(again, {})).map((row) => row.name)).toEqual(['Coffee beans']);
  });

  it('records feature changes in the business’s own audit log as a platform action', async () => {
    const rows = (await withRls(cafeOwner, (tx) =>
      tx.execute(sql`select actor_type, context::text as context from audit_logs
                     where tenant_id = ${cafeTenant} and actor_type = 'platform'
                     order by created_at desc limit 1`),
    )) as unknown as { actor_type: string; context: string }[];
    expect(rows[0]?.actor_type).toBe('platform');
    expect(rows[0]?.context).toContain('inventory');
  });
});

describe('support access', () => {
  it('keeps one business invisible to another, platform owner included, until support access starts', async () => {
    expect(
      await loadTenantContext({ sub: admin.userId, role: 'authenticated' }, cafeTenant),
    ).toBeNull();
    const home = await contextFor(admin.userId, homeTenant);
    const rows = (await withRls(home, (tx) =>
      tx.execute(sql`select count(*)::int as n from tenants where id = ${cafeTenant}`),
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);
  });

  it('gives the platform owner a visible, audited owner seat, and removes it on leaving', async () => {
    await startSupportAccess(admin, cafeTenant);
    const inside = await contextFor(admin.userId, cafeTenant);
    expect(inside).toMatchObject({ roleKey: 'owner', isSupport: true });
    expect(hasPermission(inside, 'inventory.manage')).toBe(true);
    // The support seat is not counted as one of the business's own people.
    expect((await getBusiness(admin, cafeTenant))?.members).toBe(1);

    await endSupportAccess(admin, cafeTenant);
    expect(
      await loadTenantContext({ sub: admin.userId, role: 'authenticated' }, cafeTenant),
    ).toBeNull();

    const rows = (await withRls(cafeOwner, (tx) =>
      tx.execute(sql`select context ->> 'supportAccess' as step from audit_logs
                     where tenant_id = ${cafeTenant} and context ? 'supportAccess' order by created_at`),
    )) as unknown as { step: string }[];
    expect(rows.map((row) => row.step)).toEqual(['started', 'ended']);
  });

  it('never removes someone’s genuine seat when support access ends', async () => {
    await startSupportAccess(admin, homeTenant);
    await endSupportAccess(admin, homeTenant);
    expect((await contextFor(admin.userId, homeTenant)).isSupport).toBe(false);
  });
});

describe('suspending a business', () => {
  it('marks it suspended and back, keeping its records', async () => {
    await setBusinessStatus(admin, { tenantId: cafeTenant, status: 'suspended' });
    expect((await contextFor(cafeOwnerId, cafeTenant)).tenant.status).toBe('suspended');
    await setBusinessStatus(admin, { tenantId: cafeTenant, status: 'active' });
    const back = await contextFor(cafeOwnerId, cafeTenant);
    expect(back.tenant.status).toBe('active');
    expect(await listItems(back, {})).toHaveLength(1);
  });

  it('reports an unknown business as not found', async () => {
    const unknown = '11111111-1111-4111-8111-111111111111';
    await expectCode(
      () => setBusinessFeatures(admin, { tenantId: unknown, features: [] }),
      'NOT_FOUND',
    );
    await expectCode(() => startSupportAccess(admin, unknown), 'NOT_FOUND');
    expect(await getBusiness(admin, unknown)).toBeNull();
  });
});

// Kept for the type import: a second auth user proves createAuthUser still works alongside.
describe('test support', () => {
  it('can still create a plain auth user', async () => {
    const id = await createAuthUser(mail('plain'), 'Plain User');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await adminDb().execute(sql`delete from auth.users where id = ${id}`);
  });
});
