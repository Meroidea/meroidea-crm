import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { BUSINESS_TYPES, featureForPermission } from '@/lib/features';
import { createItemSchema } from '@/modules/inventory/schemas';
import { createItem } from '@/modules/inventory/service';
import { listItems } from '@/modules/inventory/queries';
import { listUnreadFeatureNotices } from '@/modules/notifications/queries';
import { markRead } from '@/modules/notifications/service';
import { acceptAgreement, getAgreementByToken } from '@/modules/platform/agreement-public';
import {
  acceptAgreementSchema,
  businessIdentitySchema,
  createBusinessSchema,
} from '@/modules/platform/schemas';
import {
  createBusiness,
  endSupportAccess,
  getBusiness,
  getBusinessAgreement,
  listBusinesses,
  publishAgreement,
  resendAgreementLink,
  setBusinessFeatures,
  setBusinessStatus,
  startSupportAccess,
  updateBusinessIdentity,
} from '@/modules/platform/service';
import { getAcceptedAgreement } from '@/modules/settings/queries';
import { workspaceSchema } from '@/modules/settings/schemas';
import { provisionTenant } from '@/modules/tenants/provision';
import {
  hasFeature,
  hasPermission,
  loadTenantContext,
  workspaceClosedReason,
  type TenantContext,
} from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';
import type { PlatformAdmin } from '@/server/platform';

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

let admin: PlatformAdmin;
let agreementId: string;
let agreementVersion: number;
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

/** The minimum onboarding form, with whatever a test needs changed. */
const business = (overrides: Record<string, unknown> = {}) =>
  createBusinessSchema.parse({
    companyName: 'Corner Cafe',
    businessNumber: '51 824 753 556',
    businessType: 'restaurant',
    primaryContactName: 'Cara Cafe',
    primaryContactEmail: mail('cafe-contact'),
    primaryContactPhone: '02 5550 1234',
    adminName: 'Cara Cafe',
    adminEmail: mail('cafe-admin'),
    features: ['roster', 'inventory'],
    ...overrides,
  });

/** The secret from a link the console handed over, as its holder would open it. */
const tokenOf = (link: string) => new URL(link).pathname.split('/').pop() ?? '';

const meta = { ip: '203.0.113.7', userAgent: 'vitest' };

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

  const published = await publishAgreement(admin, {
    title: 'Test service agreement',
    body: 'These are the test terms of service between Meroidea and the business. '.repeat(5),
  });
  agreementId = published.id;
  agreementVersion = published.version;

  const created = await createBusiness(
    admin,
    business({ latitude: '-33.868820', longitude: '151.209290', radiusMetres: '25' }),
  );
  cafeTenant = created.tenantId;
  cafeOwnerId = await ownerOf(cafeTenant);
  await acceptAgreement(
    acceptAgreementSchema.parse({
      token: tokenOf(handedOver(created)),
      fullName: 'Cara Cafe',
      agree: true,
    }),
    meta,
  );
  cafeOwner = await contextFor(cafeOwnerId, cafeTenant);
  cleanup.push({ tenantId: cafeTenant, userIds: [cafeOwnerId] });
}, 120_000);

afterAll(async () => {
  await adminDb().execute(sql`delete from tenant_memberships where is_support`);
  for (const { tenantId, userIds } of cleanup) await destroyWorkspace(tenantId, userIds);
  await adminDb().execute(sql`delete from service_agreements where id = ${agreementId}`);
}, 60_000);

describe('onboarding a business', () => {
  it('creates a workspace with who and where the business is, its features and an owner login', async () => {
    const row = await getBusiness(admin, cafeTenant);
    expect(row).toMatchObject({
      name: 'Corner Cafe',
      industry: 'restaurant',
      status: 'active',
      features: ['roster', 'inventory'],
      members: 1,
      businessNumber: '51 824 753 556',
      primaryContactName: 'Cara Cafe',
      primaryContactPhone: '02 5550 1234',
      locationLatitude: '-33.868820',
      locationLongitude: '151.209290',
      clockRadiusMetres: 25,
    });
    expect(cafeOwner.roleKey).toBe('owner');
    expect(cafeOwner.tenant.businessNumber).toBe('51 824 753 556');
  });

  it('accepts only a valid ABN, and stores it in the usual grouping', () => {
    expect(() => business({ businessNumber: '51 824 753 557' })).toThrow();
    expect(() => business({ businessNumber: '1234' })).toThrow();
    expect(business({ businessNumber: '51824753556' }).businessNumber).toBe('51 824 753 556');
  });

  it('needs both coordinates or neither', () => {
    expect(() => business({ latitude: '-33.868820' })).toThrow();
    expect(business().latitude).toBe('');
  });

  it('refuses an admin email that already has a login', async () => {
    await expectCode(
      () =>
        createBusiness(admin, business({ companyName: 'Second Cafe', adminName: 'Cara Again' })),
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

describe('creating a business all at once', () => {
  it('leaves nothing behind when a later step of creating it fails', async () => {
    const ownerId = await createAuthUser(mail('half-made'), 'Half Made');
    const before = (await adminDb().execute(
      sql`select count(*)::int as n from tenants where name = 'Half Made Cafe'`,
    )) as unknown as { n: number }[];
    await expect(
      provisionTenant({
        userId: ownerId,
        companyName: 'Half Made Cafe',
        finish: async () => {
          throw new Error('the agreement could not be recorded');
        },
      }),
    ).rejects.toThrow('the agreement could not be recorded');
    const after = (await adminDb().execute(
      sql`select count(*)::int as n from tenants where name = 'Half Made Cafe'`,
    )) as unknown as { n: number }[];
    expect(after[0]?.n).toBe(before[0]?.n);
    await adminDb().execute(sql`delete from auth.users where id = ${ownerId}`);
  });
});

describe('the service agreement', () => {
  let pendingTenant: string;
  let pendingOwnerId: string;
  let link: string;

  beforeAll(async () => {
    const created = await createBusiness(
      admin,
      business({ companyName: 'Pending Bakery', adminName: 'Pat Baker', adminEmail: mail('pat') }),
    );
    pendingTenant = created.tenantId;
    pendingOwnerId = await ownerOf(pendingTenant);
    link = handedOver(created);
    cleanup.push({ tenantId: pendingTenant, userIds: [pendingOwnerId] });
  }, 60_000);

  it('keeps a new business closed to its own people until its admin accepts', async () => {
    const ctx = await contextFor(pendingOwnerId, pendingTenant);
    expect(ctx.tenant.status).toBe('awaiting_agreement');
    expect(workspaceClosedReason(ctx)).toBe('awaiting_agreement');
    // A platform owner on a support seat can still get in to help.
    expect(workspaceClosedReason({ ...ctx, isSupport: true })).toBeNull();
  });

  it('treats a cancelled business, or any status it does not know, as closed', async () => {
    const ctx = await contextFor(pendingOwnerId, pendingTenant);
    const as = (status: string) => ({ ...ctx, tenant: { ...ctx.tenant, status } });
    expect(workspaceClosedReason(as('cancelled'))).toBe('suspended');
    expect(workspaceClosedReason(as('something_new'))).toBe('suspended');
    for (const open of ['trialing', 'active', 'past_due']) {
      expect(workspaceClosedReason(as(open))).toBeNull();
    }
  });

  it('shows the link’s holder the exact version they are asked to accept', async () => {
    expect(await getAgreementByToken(tokenOf(link))).toMatchObject({
      businessName: 'Pending Bakery',
      recipientName: 'Pat Baker',
      version: agreementVersion,
    });
    expect(await getAgreementByToken('x'.repeat(43))).toBeNull();
  });

  it('refuses a name other than the admin’s', async () => {
    await expectCode(
      () =>
        acceptAgreement(
          acceptAgreementSchema.parse({
            token: tokenOf(link),
            fullName: 'Someone Else',
            agree: true,
          }),
          meta,
        ),
      'VALIDATION',
    );
    expect(() =>
      acceptAgreementSchema.parse({ token: tokenOf(link), fullName: 'Pat Baker', agree: false }),
    ).toThrow();
  });

  it('stops an old link working once a new one is sent', async () => {
    const fresh = await resendAgreementLink(admin, pendingTenant);
    expect(await getAgreementByToken(tokenOf(link))).toBeNull();
    link = handedOver(fresh);
    expect(await getAgreementByToken(tokenOf(link))).not.toBeNull();
  });

  it('keeps a business waiting for its agreement when it is reactivated after a suspension', async () => {
    await setBusinessStatus(admin, { tenantId: pendingTenant, status: 'suspended' });
    await setBusinessStatus(admin, { tenantId: pendingTenant, status: 'active' });
    expect((await getBusiness(admin, pendingTenant))?.status).toBe('awaiting_agreement');
  });

  it('records the acceptance, spends the link and opens the business', async () => {
    const { email } = await acceptAgreement(
      acceptAgreementSchema.parse({
        token: tokenOf(link),
        fullName: '  pat   BAKER ',
        agree: true,
      }),
      meta,
    );
    expect(email).toBe(mail('pat'));
    expect((await getBusiness(admin, pendingTenant))?.status).toBe('active');
    expect(await getAgreementByToken(tokenOf(link))).toBeNull();
    await expectCode(
      () =>
        acceptAgreement(
          acceptAgreementSchema.parse({ token: tokenOf(link), fullName: 'Pat Baker', agree: true }),
          meta,
        ),
      'NOT_FOUND',
    );
    await expectCode(() => resendAgreementLink(admin, pendingTenant), 'NOT_FOUND');

    const stored = (await adminDb().execute(sql`
      select agreement_id, accepted_ip, accepted_user_agent, token_hash
      from tenant_agreements where tenant_id = ${pendingTenant}`)) as unknown as {
      agreement_id: string;
      accepted_ip: string;
      accepted_user_agent: string;
      token_hash: string | null;
    }[];
    expect(stored).toEqual([
      {
        agreement_id: agreementId,
        accepted_ip: meta.ip,
        accepted_user_agent: meta.userAgent,
        token_hash: null,
      },
    ]);
    expect(await getBusinessAgreement(admin, pendingTenant)).toMatchObject({
      version: agreementVersion,
      acceptedName: 'pat   BAKER',
    });
  });

  it('lets the business’s admin read what they accepted, but not the link or network details', async () => {
    const owner = await contextFor(pendingOwnerId, pendingTenant);
    expect(workspaceClosedReason(owner)).toBeNull();
    expect(await getAcceptedAgreement(owner)).toMatchObject({ version: agreementVersion });
    await expect(
      withRls(owner, (tx) => tx.execute(sql`select token_hash from tenant_agreements`)),
    ).rejects.toThrow();
    await expect(
      withRls(owner, (tx) => tx.execute(sql`select accepted_ip from tenant_agreements`)),
    ).rejects.toThrow();
  });

  it('never shows one business another’s agreement record', async () => {
    const rows = (await withRls(cafeOwner, (tx) =>
      tx.execute(sql`select tenant_id from tenant_agreements`),
    )) as unknown as { tenant_id: string }[];
    expect(rows.map((row) => row.tenant_id)).toEqual([cafeTenant]);
  });
});

describe('who a business is', () => {
  it('is not something the business’s own admin can change', () => {
    const parsed = workspaceSchema.parse({
      name: 'Renamed Cafe',
      timezone: 'Australia/Sydney',
      currency: 'aud',
      country: 'AU',
    });
    expect(parsed).not.toHaveProperty('name');
  });

  it('is changed by the platform owner, in the business’s audit log', async () => {
    await updateBusinessIdentity(
      admin,
      businessIdentitySchema.parse({
        tenantId: cafeTenant,
        companyName: 'Corner Cafe & Bar',
        legalName: 'Corner Hospitality Pty Ltd',
        businessNumber: '51824753556',
        primaryContactName: 'Cara Cafe',
        primaryContactEmail: mail('cafe-contact'),
        primaryContactPhone: '02 5550 1234',
      }),
    );
    const ctx = await contextFor(cafeOwnerId, cafeTenant);
    expect(ctx.tenant).toMatchObject({
      name: 'Corner Cafe & Bar',
      legalName: 'Corner Hospitality Pty Ltd',
    });
    const rows = (await withRls(ctx, (tx) =>
      tx.execute(sql`select changes::text as changes from audit_logs
                     where tenant_id = ${cafeTenant} and actor_type = 'platform'
                       and changes is not null
                     order by created_at desc limit 1`),
    )) as unknown as { changes: string }[];
    expect(rows[0]?.changes).toContain('Corner Hospitality Pty Ltd');
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

describe('switching features on for a business already running', () => {
  const lastPlatformChange = async (ctx: TenantContext) => {
    const rows = (await withRls(ctx, (tx) =>
      tx.execute(sql`select changes, context from audit_logs
                     where tenant_id = ${ctx.tenantId} and actor_type = 'platform'
                     order by created_at desc limit 1`),
    )) as unknown as {
      changes: Record<string, [unknown, unknown]> | null;
      context: Record<string, unknown>;
    }[];
    return rows[0];
  };
  let staff: TenantContext;

  beforeAll(async () => {
    const staffId = await addMember(cafeTenant, mail('cafe-staff'), 'Sam Staff', 'member');
    cleanup.find((entry) => entry.tenantId === cafeTenant)?.userIds.push(staffId);
    staff = await contextFor(staffId, cafeTenant);
    await setBusinessFeatures(admin, { tenantId: cafeTenant, features: ['roster', 'inventory'] });
    // Earlier tests switched features on too; start from nothing unread.
    await markRead(await contextFor(cafeOwnerId, cafeTenant), 'all');
  });

  it('tells the business’s Admin in their workspace, and not its staff or another business', async () => {
    const result = await setBusinessFeatures(admin, {
      tenantId: cafeTenant,
      features: ['roster', 'inventory', 'timesheets', 'payroll'],
    });
    expect(result.notified).toBe(1);
    // No email provider in tests: the console must hear that the email did not go.
    expect(result.emailed).toBe(false);

    const owner = await contextFor(cafeOwnerId, cafeTenant);
    expect(await listUnreadFeatureNotices(owner)).toEqual([
      expect.objectContaining({
        title: 'Now switched on: Timesheets, Payroll and payslips',
        url: '/settings?tab=roles',
      }),
    ]);
    expect(await listUnreadFeatureNotices(staff)).toEqual([]);
    expect(await listUnreadFeatureNotices(await contextFor(admin.userId, homeTenant))).toEqual([]);
  });

  it('records what was switched on in the business’s audit log', async () => {
    const entry = await lastPlatformChange(cafeOwner);
    expect(entry?.context).toMatchObject({
      featuresAdded: ['timesheets', 'payroll'],
      featuresRemoved: [],
    });
    expect(entry?.changes?.features).toEqual([
      ['roster', 'inventory'],
      ['roster', 'inventory', 'timesheets', 'payroll'],
    ]);
  });

  it('stops showing the notice once the Admin dismisses it', async () => {
    const owner = await contextFor(cafeOwnerId, cafeTenant);
    const [notice] = await listUnreadFeatureNotices(owner);
    await markRead(owner, notice?.id ?? '');
    expect(await listUnreadFeatureNotices(owner)).toEqual([]);
  });

  it('records what was switched off, without telling anyone', async () => {
    const result = await setBusinessFeatures(admin, {
      tenantId: cafeTenant,
      features: ['roster', 'inventory'],
    });
    expect(result.notified).toBe(0);
    expect(await listUnreadFeatureNotices(await contextFor(cafeOwnerId, cafeTenant))).toEqual([]);
    expect((await lastPlatformChange(cafeOwner))?.context).toMatchObject({
      featuresAdded: [],
      featuresRemoved: ['timesheets', 'payroll'],
    });
  });

  it('writes nothing when the features have not changed', async () => {
    const count = async () => {
      const rows = (await adminDb().execute(
        sql`select count(*)::int as n from audit_logs where tenant_id = ${cafeTenant}`,
      )) as unknown as { n: number }[];
      return rows[0]?.n;
    };
    const before = await count();
    await setBusinessFeatures(admin, { tenantId: cafeTenant, features: ['inventory', 'roster'] });
    expect(await count()).toBe(before);
  });

  it('does not announce features to a business still waiting to accept its agreement', async () => {
    const waiting = await createBusiness(
      admin,
      business({
        companyName: 'Waiting Cafe',
        adminEmail: mail('waiting-admin'),
        primaryContactEmail: mail('waiting-contact'),
      }),
    );
    cleanup.push({ tenantId: waiting.tenantId, userIds: [await ownerOf(waiting.tenantId)] });

    const result = await setBusinessFeatures(admin, {
      tenantId: waiting.tenantId,
      features: ['roster', 'inventory', 'payroll'],
    });
    expect(result.notified).toBe(0);
    const rows = (await adminDb().execute(
      sql`select count(*)::int as n from notifications where tenant_id = ${waiting.tenantId}`,
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);
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
