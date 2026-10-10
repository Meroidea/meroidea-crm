import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { contacts, expenseClaims } from '@/db/schema';
import { featureForPermission, FEATURE_KEYS } from '@/lib/features';
import { PERMISSION_KEYS } from '@/lib/permissions/catalog';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { payrollKeyStatus, reencryptPayrollDetails } from '@/modules/hiring/key-rotation';
import { payrollBinding, revealPayrollDetails } from '@/modules/hiring/service';
import type { TenantContext } from '@/server/context';
import { encryptField } from '@/server/crypto';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';
import type { PlatformAdmin } from '@/server/platform';

import { contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Lets one test swap encryption keys the way an operator would during a rotation (ADR-040).
const keys = vi.hoisted(
  (): { HR_ENCRYPTION_KEY?: string; HR_ENCRYPTION_KEYS_PREVIOUS?: string } => ({}),
);
vi.mock('@/server/env', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/env')>();
  return { serverEnv: () => ({ ...real.serverEnv(), ...keys }) };
});

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let ownerId: string;
let owner: TenantContext;

const textArray = (values: readonly string[]) =>
  sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;

const setFeatures = (features: readonly string[]) =>
  adminDb().execute(
    sql`update tenants set features = ${textArray(features)} where id = ${tenantId}`,
  );

beforeAll(async () => {
  const workspace = await createWorkspace('Hardening Co', mail('hard-owner'));
  tenantId = workspace.tenantId;
  ownerId = workspace.ownerId;
  owner = await contextFor(ownerId, tenantId);
}, 120_000);

afterAll(async () => {
  if (tenantId) await destroyWorkspace(tenantId, [ownerId]);
}, 60_000);

describe('feature switches inside the database (ADR-038)', () => {
  it('the SQL catalog maps every permission to the same feature as the code', async () => {
    const permissions = [...PERMISSION_KEYS, 'settings.manage', 'unknown.thing'];
    const rows = (await adminDb().execute(sql`
      select perm, app.permission_feature(perm) as feature
      from unnest(${textArray(permissions)}) as perm`)) as unknown as {
      perm: string;
      feature: string | null;
    }[];
    expect(rows).toHaveLength(permissions.length);
    for (const row of rows)
      expect([row.perm, row.feature]).toEqual([row.perm, featureForPermission(row.perm)]);
  });

  it('a switched-off feature leaves no grant behind, in the database or the context', async () => {
    await setFeatures(FEATURE_KEYS.filter((feature) => feature !== 'crm'));
    const ctx = await contextFor(ownerId, tenantId);
    expect(ctx.grants.has('contacts.view')).toBe(false);
    expect(ctx.grants.has('expenses.manage')).toBe(true);
    const [row] = (await withRls(ctx, (tx) =>
      tx.execute(sql`select app.has_permission(${tenantId}, 'contacts.view') as crm,
                            app.has_permission(${tenantId}, 'expenses.manage') as expenses`),
    )) as unknown as { crm: boolean; expenses: boolean }[];
    expect(row).toEqual({ crm: false, expenses: true });
    await setFeatures(FEATURE_KEYS);
  });

  it('hides a switched-off feature’s rows even from code that forgets the permission check', async () => {
    await createContact(owner, createContactSchema.parse({ firstName: 'Hidden', lastName: 'Row' }));
    const countContacts = () =>
      withRls(owner, async (tx) => (await tx.select({ id: contacts.id }).from(contacts)).length);
    const insertDirectly = (firstName: string) =>
      withRls(owner, (tx) =>
        tx.insert(contacts).values({ tenantId, firstName, ownerUserId: ownerId }),
      );
    await insertDirectly('Allowed');
    expect(await countContacts()).toBe(2);

    await setFeatures(FEATURE_KEYS.filter((feature) => feature !== 'crm'));
    // `owner` still carries its old grants: this is the forgotten check the database must catch.
    expect(await countContacts()).toBe(0);
    await expect(insertDirectly('Sneaky')).rejects.toThrow();

    await setFeatures(FEATURE_KEYS);
    expect(await countContacts()).toBe(2);
  });

  it('leaves the other features of the same business untouched', async () => {
    await setFeatures(FEATURE_KEYS.filter((feature) => feature !== 'expenses'));
    const [visible] = (await withRls(owner, (tx) =>
      tx.execute(sql`select
        (select count(*) from contacts)::int as contacts,
        (select count(*) from expense_claims)::int as claims`),
    )) as unknown as { contacts: number; claims: number }[];
    expect(visible?.contacts).toBe(2);
    const claim = () =>
      withRls(owner, (tx) =>
        tx.insert(expenseClaims).values({
          tenantId,
          userId: ownerId,
          spentOn: '2026-10-01',
          category: 'travel',
          description: 'Taxi',
          amount: '12.00',
          currency: 'AUD',
        }),
      );
    await expect(claim()).rejects.toThrow();
    await setFeatures(FEATURE_KEYS);
    await claim();
    await adminDb().execute(sql`delete from expense_claims where tenant_id = ${tenantId}`);
  });

  it('builds the whole context, including team members, in one call', async () => {
    const ctx = await contextFor(ownerId, tenantId);
    expect(ctx.teamUserIds).toEqual([ownerId]);
    expect(ctx.tenant.features.sort()).toEqual([...FEATURE_KEYS].sort());
    expect(ctx.isSupport).toBe(false);
    expect(ctx.tenant.clockLocation).toBeNull();
  });
});

describe('rotating the staff details key (ADR-040)', () => {
  const admin: PlatformAdmin = { userId: '00000000-0000-0000-0000-000000000000', email: 'x' };

  it('moves stored numbers onto a new key without losing them, and audits it', async () => {
    admin.userId = ownerId;
    const oldKey = randomBytes(32).toString('base64');
    keys.HR_ENCRYPTION_KEY = oldKey;
    const [employee] = (await adminDb().execute(sql`
      insert into employees (tenant_id, first_name, last_name, email)
      values (${tenantId}, 'Kim', 'Key', ${mail('kim')}) returning id`)) as unknown as {
      id: string;
    }[];
    const employeeId = employee!.id;
    const seal = (value: string, field: string) =>
      encryptField(value, payrollBinding(tenantId, employeeId, field));
    await adminDb().execute(sql`
      insert into employee_payroll_details
        (tenant_id, employee_id, tax_file_number_ciphertext, bank_bsb_ciphertext,
         bank_account_ciphertext, bank_account_last3)
      values (${tenantId}, ${employeeId}, ${seal('123456782', 'tfn')}, ${seal('062000', 'bsb')},
              ${seal('12345678', 'account')}, '678')`);

    keys.HR_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    keys.HR_ENCRYPTION_KEYS_PREVIOUS = oldKey;
    const before = await payrollKeyStatus(admin);
    expect(before.pending).toBeGreaterThanOrEqual(1);
    expect(before.previousKeyIds).toHaveLength(1);

    const result = await reencryptPayrollDetails(admin);
    expect(result.failed).toBe(0);
    expect(result.reencrypted).toBeGreaterThanOrEqual(1);
    expect((await payrollKeyStatus(admin)).pending).toBe(0);

    // The old key can go: everything reads with the new one alone.
    delete keys.HR_ENCRYPTION_KEYS_PREVIOUS;
    expect(await revealPayrollDetails(owner, employeeId)).toEqual({
      taxFileNumber: '123456782',
      bankBsb: '062000',
      bankAccount: '12345678',
      superMemberNumber: null,
    });

    const audits = (await adminDb().execute(sql`
      select actor_type, context from audit_logs
      where tenant_id = ${tenantId} and entity_type = 'employee_payroll_details'
        and actor_type = 'platform'`)) as unknown as {
      actor_type: string;
      context: { reencrypted: number };
    }[];
    expect(audits[0]?.context.reencrypted).toBeGreaterThanOrEqual(1);
  });

  it('leaves a value no configured key can open untouched and reports it', async () => {
    const [row] = (await adminDb().execute(sql`
      select employee_id, tax_file_number_ciphertext as tfn from employee_payroll_details
      where tenant_id = ${tenantId} limit 1`)) as unknown as { employee_id: string; tfn: string }[];
    keys.HR_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const result = await reencryptPayrollDetails(admin);
    expect(result).toEqual({ reencrypted: 0, failed: 1 });
    const [after] = (await adminDb().execute(sql`
      select tax_file_number_ciphertext as tfn from employee_payroll_details
      where tenant_id = ${tenantId} and employee_id = ${row!.employee_id}`)) as unknown as {
      tfn: string;
    }[];
    expect(after?.tfn).toBe(row?.tfn);
    delete keys.HR_ENCRYPTION_KEY;
  });
});
