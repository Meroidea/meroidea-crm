import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addDaysToDate, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { ROLE_TEMPLATES } from '@/lib/permissions/catalog';
import {
  creditBill,
  enterBill,
  payBills,
  voidBill,
  voidBillCredit,
  voidBillPayment,
} from '@/modules/books/bills';
import { billTotals, getBill, listBills, supplierDefaults } from '@/modules/books/bills-queries';
import { financialYearStart } from '@/modules/books/money';
import {
  entriesForSource,
  getEntry,
  listAccounts,
  listTaxCodes,
  trialBalance,
} from '@/modules/books/queries';
import {
  billCreditSchema,
  billPaymentSchema,
  billSchema,
  setupBooksSchema,
} from '@/modules/books/schemas';
import { setupBooks } from '@/modules/books/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import {
  addMember,
  contextFor,
  createAuthUser,
  createWorkspace,
  destroyWorkspace,
} from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
let users: string[];
let betaUsers: string[];
let owner: TenantContext;
let manager: TenantContext;
let viewer: TenantContext;
let bookkeeper: TenantContext;
let outsider: TenantContext;
let today: string;
let start: string;
let account: (code: string) => Promise<string>;
let tax: (code: string) => Promise<string>;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function templateMember(tenantId: string, key: string): Promise<string> {
  const template = ROLE_TEMPLATES.find((role) => role.key === key)!;
  const userId = await createAuthUser(mail(key), template.name);
  const db = adminDb();
  const [role] = (await db.execute(sql`
    insert into roles (tenant_id, key, name) values (${tenantId}, ${key}, ${template.name})
    returning id`)) as unknown as { id: string }[];
  for (const permission of Object.keys(template.grants)) {
    await db.execute(sql`
      insert into role_permissions (tenant_id, role_id, permission, scope)
      values (${tenantId}, ${role!.id}, ${permission}, null)`);
  }
  await db.execute(sql`
    insert into tenant_memberships (tenant_id, user_id, role_id, status)
    values (${tenantId}, ${userId}, ${role!.id}, 'active')`);
  return userId;
}

const rentBill = async (overrides: Record<string, unknown> = {}) =>
  billSchema.parse({
    supplierName: 'Harbour Properties',
    supplierReference: `INV-${Math.round(Math.random() * 1e9)}`,
    date: today,
    dueDate: addDaysToDate(today, 14),
    amountsAre: 'inclusive',
    items: [{ accountId: await account('469'), amount: '1100', taxCodeId: await tax('GST-P') }],
    ...overrides,
  });

const pay = (ctx: TenantContext, bank: string, allocations: { billId: string; amount: string }[]) =>
  payBills(ctx, billPaymentSchema.parse({ date: today, bankAccountId: bank, allocations }));

const balanceOf = async (code: string) =>
  (await listAccounts(owner)).find((row) => row.code === code)?.balance;

beforeAll(async () => {
  const alpha = await createWorkspace('Bills Alpha', mail('bills-alpha'));
  const beta = await createWorkspace('Bills Beta', mail('bills-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  const managerId = await addMember(alphaTenant, mail('bills-mgr'), 'Mia Manager', 'manager');
  const viewerId = await templateMember(alphaTenant, 'books-viewer');
  const bookkeeperId = await templateMember(alphaTenant, 'bookkeeper');
  users = [alpha.ownerId, managerId, viewerId, bookkeeperId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  manager = await contextFor(managerId, alphaTenant);
  viewer = await contextFor(viewerId, alphaTenant);
  bookkeeper = await contextFor(bookkeeperId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);
  today = zonedToday(owner.tenant.timezone);
  start = financialYearStart(today, 7);
  await setupBooks(
    owner,
    setupBooksSchema.parse({ country: 'AU', startDate: start, financialYearStartMonth: 7 }),
  );
  account = async (code) => (await listAccounts(owner)).find((row) => row.code === code)!.id;
  tax = async (code) => (await listTaxCodes(owner)).find((row) => row.code === code)!.id;
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, users);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('entering bills', () => {
  it('a bookkeeper enters a bill: expense and GST against accounts payable', async () => {
    const { id, number } = await enterBill(bookkeeper, await rentBill());
    expect(number).toBe(1);
    const bill = await getBill(owner, id);
    expect(bill).toMatchObject({
      subtotal: '1000.00',
      taxTotal: '100.00',
      total: '1100.00',
      status: 'open',
    });
    const [entry] = await entriesForSource(owner, 'bill', id);
    const detail = await getEntry(owner, entry!.id);
    expect(detail?.lines.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['469', '1000.00', '0.00'],
      ['820', '100.00', '0.00'],
      ['800', '0.00', '1100.00'],
    ]);
    expect(await balanceOf('800')).toBe('1100.00');
  });

  it('flags a bill that looks already entered, and saves it when confirmed', async () => {
    const first = await rentBill({ supplierReference: 'DUP-1' });
    await enterBill(owner, first);
    await expectCode(() => enterBill(owner, { ...first }), 'DUPLICATE');
    // Same supplier, date and total but no reference is caught too.
    const noRef = await rentBill({
      supplierReference: null,
      items: [{ accountId: await account('469'), amount: '77', taxCodeId: null }],
    });
    await enterBill(owner, noRef);
    await expectCode(() => enterBill(owner, { ...noRef }), 'DUPLICATE');
    const again = await enterBill(owner, { ...noRef, allowDuplicate: true });
    expect(again.number).toBeGreaterThan(0);
  });

  it('a bill dated before the books began is what was already owed: opening balances, not expense', async () => {
    const { id } = await enterBill(
      owner,
      await rentBill({ date: addDaysToDate(start, -10), dueDate: addDaysToDate(start, 5) }),
    );
    const [entry] = await entriesForSource(owner, 'bill', id);
    const detail = await getEntry(owner, entry!.id);
    expect(detail?.date).toBe(start);
    expect(detail?.lines.map((line) => line.accountCode)).toEqual(['990', '800']);
  });

  it('the database refuses a bill whose totals are not the sum of its lines', async () => {
    await expect(
      withRls(owner, async (tx) => {
        const [bill] = (await tx.execute(sql`
          insert into ledger_bills (tenant_id, number, supplier_name, date, due_date, amounts_are,
            subtotal, tax_total, total, currency)
          values (${alphaTenant}, 9999, 'Sneaky', ${today}::date, ${today}::date, 'no_tax',
            100, 0, 100, 'AUD') returning id`)) as unknown as { id: string }[];
        await tx.execute(sql`
          insert into ledger_bill_lines (tenant_id, bill_id, account_id, amount, tax_amount)
          values (${alphaTenant}, ${bill!.id}, ${await account('469')}, 60, 0)`);
      }),
    ).rejects.toThrow();
  });
});

describe('paying bills', () => {
  it('part payments, and one payment across several bills; overpaying is refused', async () => {
    const bank = await account('090');
    const a = await enterBill(
      owner,
      await rentBill({
        items: [{ accountId: await account('489'), amount: '110', taxCodeId: await tax('GST-P') }],
      }),
    );
    const b = await enterBill(
      owner,
      await rentBill({
        items: [{ accountId: await account('485'), amount: '55', taxCodeId: await tax('GST-P') }],
      }),
    );
    await pay(owner, bank, [{ billId: a.id, amount: '10' }]);
    expect(await getBill(owner, a.id)).toMatchObject({ status: 'open', balance: '100.00' });
    await expectCode(() => pay(owner, bank, [{ billId: a.id, amount: '100.01' }]), 'VALIDATION');
    const both = await pay(owner, bank, [
      { billId: a.id, amount: '100' },
      { billId: b.id, amount: '55' },
    ]);
    expect((await getBill(owner, a.id))?.status).toBe('paid');
    expect((await getBill(owner, b.id))?.payments[0]).toMatchObject({
      paymentTotal: '155.00',
      otherBills: 1,
    });

    // Voiding the payment reopens both; a bill with a live payment cannot be voided.
    await expectCode(() => voidBill(owner, a.id), 'CONFLICT');
    await voidBillPayment(owner, both.id);
    expect(await getBill(owner, b.id)).toMatchObject({ status: 'open', balance: '55.00' });
  });

  it('pays only from a bank, cash or card account', async () => {
    const { id } = await enterBill(owner, await rentBill());
    await expect(pay(owner, await account('469'), [{ billId: id, amount: '1' }])).rejects.toThrow();
  });

  it('a supplier credit takes the expense and GST back and reduces what is owed', async () => {
    const { id } = await enterBill(owner, await rentBill());
    const credit = await creditBill(
      owner,
      billCreditSchema.parse({
        billId: id,
        date: today,
        amount: '220',
        reason: 'Rent relief',
        accountId: await account('469'),
        taxCodeId: await tax('GST-P'),
      }),
    );
    expect(await getBill(owner, id)).toMatchObject({ balance: '880.00' });
    const entries = await entriesForSource(owner, 'bill', id);
    const detail = await getEntry(owner, entries.find((entry) => entry.kind === 'bill_credit')!.id);
    expect(detail?.lines.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['800', '220.00', '0.00'],
      ['469', '0.00', '200.00'],
      ['820', '0.00', '20.00'],
    ]);
    await expectCode(
      async () =>
        creditBill(
          owner,
          billCreditSchema.parse({
            billId: id,
            date: today,
            amount: '880.01',
            reason: 'Too much',
            accountId: await account('469'),
          }),
        ),
      'VALIDATION',
    );
    await voidBillCredit(owner, credit.id);
    expect((await getBill(owner, id))?.balance).toBe('1100.00');
  });

  it('accounts payable in the books equals what the bills say is owed', async () => {
    const totals = await billTotals(owner);
    expect(await balanceOf('800')).toBe(totals.owed);
    const balance = await trialBalance(owner, addDaysToDate(today, 30));
    expect(balance.totalDebit).toBe(balance.totalCredit);
  });
});

describe('who can see and change bills', () => {
  it('a books viewer reads bills but cannot enter or pay them', async () => {
    expect((await listBills(viewer, { status: 'all' })).length).toBeGreaterThan(0);
    await expectCode(async () => enterBill(viewer, await rentBill()), 'FORBIDDEN');
  });

  it('a manager sees nothing; another business never sees or pays these bills', async () => {
    await expectCode(() => listBills(manager), 'FORBIDDEN');
    const [row] = (await withRls(manager, (tx) =>
      tx.execute(sql`select (select count(*)::int from ledger_bills) as bills,
                            (select count(*)::int from ledger_bill_payments) as payments`),
    )) as unknown as { bills: number; payments: number }[];
    expect(row).toEqual({ bills: 0, payments: 0 });
    const [bill] = await listBills(owner, { status: 'open' });
    expect(await getBill(outsider, bill!.id)).toBeNull();
    await setupBooks(
      outsider,
      setupBooksSchema.parse({ country: 'AU', startDate: start, financialYearStartMonth: 7 }),
    );
    const theirBank = (await listAccounts(outsider)).find((row) => row.code === '090')!.id;
    await expectCode(
      () => pay(outsider, theirBank, [{ billId: bill!.id, amount: '1' }]),
      'NOT_FOUND',
    );
  });

  it('bills cannot be edited or deleted, only voided', async () => {
    const [bill] = await listBills(owner, { status: 'open' });
    await expect(
      withRls(owner, (tx) =>
        tx.execute(sql`update ledger_bills set total = 1 where id = ${bill!.id}`),
      ),
    ).rejects.toThrow();
    await expect(
      withRls(owner, (tx) => tx.execute(sql`delete from ledger_bills where id = ${bill!.id}`)),
    ).rejects.toThrow();
  });

  it('remembers each supplier’s usual account', async () => {
    const defaults = await supplierDefaults(owner);
    expect(defaults.find((row) => row.supplierName === 'Harbour Properties')).toBeTruthy();
  });
});
