import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addDaysToDate, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { FEATURE_KEYS } from '@/lib/features';
import { ROLE_TEMPLATES } from '@/lib/permissions/catalog';
import { financialYearStart } from '@/modules/books/money';
import { COUNTRY_PACKS } from '@/modules/books/packs';
import {
  accountLedger,
  balanceSheet,
  entriesForSource,
  getEntry,
  listAccounts,
  listEntries,
  listTaxCodes,
  profitAndLoss,
  trialBalance,
  unpaidPayslips,
} from '@/modules/books/queries';
import {
  journalSchema,
  moneySchema,
  saveAccountSchema,
  setupBooksSchema,
  transferSchema,
} from '@/modules/books/schemas';
import {
  catchUpBooks,
  payPayslip,
  recordJournal,
  recordMoney,
  recordTransfer,
  saveAccount,
  saveBooksSettings,
  setAccountArchived,
  setupBooks,
  voidEntry,
} from '@/modules/books/service';
import { saveInvoiceSchema } from '@/modules/invoices/schemas';
import {
  markInvoicePaid,
  markInvoiceSent,
  saveInvoice,
  voidInvoice,
} from '@/modules/invoices/service';
import { releasePayslips } from '@/modules/payroll/service';
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
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let manager: TenantContext;
let member: TenantContext;
let bookkeeper: TenantContext;
let outsider: TenantContext;
let memberId: string;
let start: string;
let today: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

/** A person whose role is one of the templates an admin can add (Settings → Roles). */
async function addTemplateMember(tenantId: string, templateKey: string): Promise<string> {
  const template = ROLE_TEMPLATES.find((role) => role.key === templateKey);
  if (!template) throw new Error(`no ${templateKey} template`);
  const userId = await createAuthUser(mail(templateKey), `${template.name} Person`);
  const db = adminDb();
  const [role] = (await db.execute(sql`
    insert into roles (tenant_id, key, name) values (${tenantId}, ${templateKey}, ${template.name})
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

const accountId = async (ctx: TenantContext, code: string) => {
  const found = (await listAccounts(ctx, { includeArchived: true })).find((a) => a.code === code);
  if (!found) throw new Error(`no account ${code}`);
  return found.id;
};
const taxCodeId = async (ctx: TenantContext, code: string) => {
  const found = (await listTaxCodes(ctx)).find((t) => t.code === code);
  if (!found) throw new Error(`no tax code ${code}`);
  return found.id;
};
const balanceOf = async (ctx: TenantContext, code: string) =>
  (await listAccounts(ctx, { includeArchived: true })).find((a) => a.code === code)?.balance;

const invoice = (issueDate: string, overrides: Record<string, unknown> = {}) =>
  saveInvoiceSchema.parse({
    customerName: 'Lumen Studio',
    issueDate,
    dueDate: addDaysToDate(issueDate, 14),
    taxRate: '10',
    lines: [{ description: 'Consulting', quantity: '1', unitPrice: '100' }],
    ...overrides,
  });

const ledgerRows = (ctx: TenantContext) =>
  withRls(ctx, async (tx) => {
    const [row] = (await tx.execute(sql`select
      (select count(*)::int from ledger_entries) as entries,
      (select count(*)::int from ledger_lines) as lines,
      (select count(*)::int from ledger_accounts) as accounts,
      (select count(*)::int from ledger_settings) as settings`)) as unknown as Record<
      string,
      number
    >[];
    return row;
  });

beforeAll(async () => {
  const alpha = await createWorkspace('Books Alpha', mail('books-alpha'));
  const beta = await createWorkspace('Books Beta', mail('books-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  const managerId = await addMember(alphaTenant, mail('books-mgr'), 'Mia Manager', 'manager');
  memberId = await addMember(alphaTenant, mail('books-mem'), 'Max Member', 'member');
  const bookkeeperId = await addTemplateMember(alphaTenant, 'bookkeeper');
  alphaUsers = [alpha.ownerId, managerId, memberId, bookkeeperId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  manager = await contextFor(managerId, alphaTenant);
  member = await contextFor(memberId, alphaTenant);
  bookkeeper = await contextFor(bookkeeperId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);
  today = zonedToday(owner.tenant.timezone);
  start = financialYearStart(today, 7);
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('setting up the books', () => {
  let earlyInvoice: string;

  it('leaves invoices working exactly as before while the books are not set up', async () => {
    earlyInvoice = (await saveInvoice(owner, invoice(addDaysToDate(start, 3)))).id;
    await markInvoiceSent(owner, earlyInvoice);
    expect(await ledgerRows(owner)).toMatchObject({ entries: 0, settings: 0 });
  });

  it('is for the books manager only: a manager and a bookkeeper are refused', async () => {
    const input = setupBooksSchema.parse({
      country: 'AU',
      startDate: start,
      financialYearStartMonth: 7,
    });
    await expectCode(() => setupBooks(manager, input), 'FORBIDDEN');
    await expectCode(() => setupBooks(bookkeeper, input), 'FORBIDDEN');
  });

  it('creates the Australian chart and tax codes, and brings in invoices already sent', async () => {
    const result = await setupBooks(
      owner,
      setupBooksSchema.parse({ country: 'AU', startDate: start, financialYearStartMonth: 7 }),
    );
    expect(result.posted).toBe(1);
    expect(await listAccounts(owner)).toHaveLength(COUNTRY_PACKS.AU!.accounts.length);
    const [entry] = await entriesForSource(owner, 'invoice', earlyInvoice);
    expect(entry).toMatchObject({ kind: 'invoice', total: '110.00', reference: 'INV-0001' });
    expect(await balanceOf(owner, '610')).toBe('110.00');
    expect(await balanceOf(owner, '200')).toBe('100.00');
    expect(await balanceOf(owner, '820')).toBe('10.00');
    await expectCode(
      () =>
        setupBooks(
          owner,
          setupBooksSchema.parse({ country: 'AU', startDate: start, financialYearStartMonth: 7 }),
        ),
      'CONFLICT',
    );
  });

  it('catching up again never posts anything twice', async () => {
    expect((await catchUpBooks(owner)).posted).toBe(0);
  });
});

describe('recording money', () => {
  let receiptId: string;

  it('a bookkeeper records GST-inclusive money in as income, GST and the bank', async () => {
    const { id } = await recordMoney(
      bookkeeper,
      moneySchema.parse({
        kind: 'money_in',
        date: addDaysToDate(start, 5),
        bankAccountId: await accountId(owner, '090'),
        contactName: 'Cash sales',
        description: 'Takings',
        amountsAre: 'inclusive',
        items: [
          {
            accountId: await accountId(owner, '200'),
            amount: '220.00',
            taxCodeId: await taxCodeId(owner, 'GST'),
          },
        ],
      }),
    );
    receiptId = id;
    const entry = await getEntry(owner, id);
    expect(entry?.lines.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['090', '220.00', '0.00'],
      ['200', '0.00', '200.00'],
      ['820', '0.00', '20.00'],
    ]);
    expect(entry?.lines[1]).toMatchObject({ taxCode: 'GST on Income', taxAmount: '20.00' });
  });

  it('money out, with tax worked out on top, and a transfer between banks', async () => {
    await recordMoney(
      bookkeeper,
      moneySchema.parse({
        kind: 'money_out',
        date: addDaysToDate(start, 6),
        bankAccountId: await accountId(owner, '090'),
        description: 'Rent',
        amountsAre: 'exclusive',
        items: [
          {
            accountId: await accountId(owner, '469'),
            amount: '50.00',
            taxCodeId: await taxCodeId(owner, 'GST-P'),
          },
        ],
      }),
    );
    await recordTransfer(
      bookkeeper,
      transferSchema.parse({
        date: addDaysToDate(start, 7),
        fromAccountId: await accountId(owner, '090'),
        toAccountId: await accountId(owner, '091'),
        amount: '100',
        description: 'To savings',
      }),
    );
    // 220 in, 55 out, 100 moved to savings.
    expect(await balanceOf(owner, '090')).toBe('65.00');
    expect(await balanceOf(owner, '091')).toBe('100.00');
    // GST: 10 on the invoice + 20 collected − 5 paid.
    expect(await balanceOf(owner, '820')).toBe('25.00');
  });

  it('a bookkeeper cannot post journals; the database refuses them too', async () => {
    const journal = journalSchema.parse({
      kind: 'journal',
      date: addDaysToDate(start, 8),
      description: 'Adjustment',
      lines: [
        { accountId: await accountId(owner, '429'), debit: '10' },
        { accountId: await accountId(owner, '850'), credit: '10' },
      ],
    });
    await expectCode(() => recordJournal(bookkeeper, journal), 'FORBIDDEN');
    await expect(
      withRls(bookkeeper, (tx) =>
        tx.execute(sql`select app.ledger_post_entry('journal', ${journal.date}::date, 'x', null,
          null, false, ${JSON.stringify([
            { account_id: journal.lines[0]!.accountId, debit: '10' },
            { account_id: journal.lines[1]!.accountId, credit: '10' },
          ])}::jsonb)`),
      ),
    ).rejects.toThrow();
  });

  it('an unbalanced entry is refused by the database, even when the function is called directly', async () => {
    const lines = JSON.stringify([
      { account_id: await accountId(owner, '429'), debit: '10.00' },
      { account_id: await accountId(owner, '850'), credit: '9.99' },
    ]);
    await expect(
      withRls(owner, (tx) =>
        tx.execute(sql`select app.ledger_post_entry('journal', ${today}::date, 'Bad', null, null,
          false, ${lines}::jsonb)`),
      ),
    ).rejects.toThrow();
    const thirdDecimal = JSON.stringify([
      { account_id: await accountId(owner, '429'), debit: '10.005' },
      { account_id: await accountId(owner, '850'), credit: '10.005' },
    ]);
    await expect(
      withRls(owner, (tx) =>
        tx.execute(sql`select app.ledger_post_entry('journal', ${today}::date, 'Bad', null, null,
          false, ${thirdDecimal}::jsonb)`),
      ),
    ).rejects.toThrow();
  });

  it('nobody writes, edits or deletes ledger rows directly, not even the admin', async () => {
    for (const statement of [
      sql`insert into ledger_entries (tenant_id, number, date, kind, description, currency)
          values (${alphaTenant}, 999, ${today}::date, 'journal', 'x', 'AUD')`,
      sql`update ledger_lines set debit = debit + 1`,
      sql`delete from ledger_entries`,
    ]) {
      await expect(withRls(owner, (tx) => tx.execute(statement))).rejects.toThrow();
    }
  });

  it('voiding posts a reversal, keeps the original, and cannot happen twice', async () => {
    const { reversalId } = await voidEntry(bookkeeper, { id: receiptId, reason: 'Entered twice' });
    const original = await getEntry(owner, receiptId);
    const reversal = await getEntry(owner, reversalId);
    expect(original?.reversedBy?.id).toBe(reversalId);
    expect(reversal).toMatchObject({ kind: 'reversal', date: original?.date });
    expect(reversal?.lines.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['090', '0.00', '220.00'],
      ['200', '200.00', '0.00'],
      ['820', '20.00', '0.00'],
    ]);
    await expectCode(() => voidEntry(owner, { id: receiptId, reason: null }), 'VALIDATION');
  });
});

describe('who can see the books', () => {
  it('staff and managers see nothing, in the app or the database', async () => {
    await expectCode(() => listAccounts(manager), 'FORBIDDEN');
    await expectCode(() => listEntries(member), 'FORBIDDEN');
    expect(await ledgerRows(manager)).toEqual({ entries: 0, lines: 0, accounts: 0, settings: 0 });
    expect(await ledgerRows(member)).toEqual({ entries: 0, lines: 0, accounts: 0, settings: 0 });
  });

  it('another business never sees these books or posts to their accounts', async () => {
    const [entry] = (await listEntries(owner)).items;
    expect(await getEntry(outsider, entry!.id)).toBeNull();
    expect((await listEntries(outsider)).items).toEqual([]);
    await setupBooks(
      outsider,
      setupBooksSchema.parse({ country: 'AU', startDate: start, financialYearStartMonth: 7 }),
    );
    const theirBank = await accountId(outsider, '090');
    const alphaSales = await accountId(owner, '200');
    // Their own bank, but our sales account: the database refuses a line outside their chart.
    await expectCode(
      () =>
        recordMoney(
          outsider,
          moneySchema.parse({
            kind: 'money_in',
            date: today,
            bankAccountId: theirBank,
            description: 'Sneaky',
            amountsAre: 'no_tax',
            items: [{ accountId: alphaSales, amount: '1' }],
          }),
        ),
      'VALIDATION',
    );
    expect(await ledgerRows(outsider)).toMatchObject({ entries: 0 });
  });
});

describe('invoices post themselves', () => {
  it('paid: money in the bank and nothing owed; voided: the issue reversed', async () => {
    const issued = addDaysToDate(start, 10);
    const paid = (await saveInvoice(owner, invoice(issued))).id;
    await markInvoiceSent(owner, paid);
    await markInvoicePaid(owner, paid);
    const paidEntries = await entriesForSource(owner, 'invoice', paid);
    expect(paidEntries.map((entry) => entry.kind)).toEqual(['invoice', 'invoice_payment']);

    const voided = (await saveInvoice(owner, invoice(issued))).id;
    await markInvoiceSent(owner, voided);
    await voidInvoice(owner, voided);
    const voidedEntries = await entriesForSource(owner, 'invoice', voided);
    expect(voidedEntries.map((entry) => entry.kind)).toEqual(['invoice', 'reversal']);
    // Only the first invoice is still owed.
    expect(await balanceOf(owner, '610')).toBe('110.00');
  });

  it('an entry posted from an invoice is changed only through the invoice', async () => {
    const [entry] = (await listEntries(owner, { kind: 'invoice' })).items;
    await expectCode(() => voidEntry(owner, { id: entry!.id, reason: null }), 'VALIDATION');
  });
});

describe('the lock date', () => {
  it('stops everyone but the books manager from posting on or before it', async () => {
    const lockDate = addDaysToDate(start, 20);
    const settings = await withRls(owner, (tx) =>
      tx.execute(sql`select receipts_account_id as r, invoice_income_account_id as i
                     from ledger_settings`),
    );
    const { r, i } = (settings as unknown as { r: string; i: string }[])[0]!;
    await saveBooksSettings(owner, {
      financialYearStartMonth: 7,
      lockDate,
      receiptsAccountId: r,
      invoiceIncomeAccountId: i,
    });
    const money = moneySchema.parse({
      kind: 'money_out',
      date: addDaysToDate(start, 15),
      bankAccountId: await accountId(owner, '090'),
      description: 'Late receipt',
      amountsAre: 'no_tax',
      items: [{ accountId: await accountId(owner, '404'), amount: '2.50' }],
    });
    await expectCode(() => recordMoney(bookkeeper, money), 'CONFLICT');
    const { id } = await recordMoney(owner, money);

    // A locked entry is corrected by a reversal dated after the lock, never inside it.
    const { reversalId } = await voidEntry(bookkeeper, { id, reason: null });
    const reversal = await getEntry(owner, reversalId);
    expect(reversal!.date > lockDate).toBe(true);

    await saveBooksSettings(owner, {
      financialYearStartMonth: 7,
      lockDate: null,
      receiptsAccountId: r,
      invoiceIncomeAccountId: i,
    });
  });
});

describe('payroll posts itself, and pay stays private', () => {
  let payslipId: string;

  it('releasing a payslip posts wages, PAYG withheld, super and net pay owed', async () => {
    const db = adminDb();
    const [roster] = (await db.execute(sql`
      insert into rosters (tenant_id, starts_on, ends_on)
      values (${alphaTenant}, ${start}::date, ${addDaysToDate(start, 6)}::date)
      returning id`)) as unknown as { id: string }[];
    const [employee] = (await db.execute(sql`
      insert into employees (tenant_id, first_name, last_name, email, user_id)
      values (${alphaTenant}, 'Max', 'Member', ${mail('books-emp')}, ${memberId})
      returning id`)) as unknown as { id: string }[];
    const [payslip] = (await db.execute(sql`
      insert into payslips (tenant_id, roster_id, employee_id, user_id, period_start, period_end,
        payment_date, employee_name, minutes, hourly_rate, gross, tax_withheld, net, super_rate,
        super_amount, currency)
      values (${alphaTenant}, ${roster!.id}, ${employee!.id}, ${memberId}, ${start}::date,
        ${addDaysToDate(start, 6)}::date, ${addDaysToDate(start, 9)}::date, 'Max Member', 600,
        30, 300, 30, 270, 12, 36, 'AUD')
      returning id`)) as unknown as { id: string }[];
    payslipId = payslip!.id;

    await releasePayslips(owner, roster!.id);
    const [entry] = await entriesForSource(owner, 'payslip', payslipId);
    const detail = await getEntry(owner, entry!.id);
    expect(detail?.payroll).toBe(true);
    expect(detail?.lines.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['477', '300.00', '0.00'],
      ['478', '36.00', '0.00'],
      ['826', '0.00', '36.00'],
      ['825', '0.00', '30.00'],
      ['803', '0.00', '270.00'],
    ]);
  });

  it('someone without the payroll permission sees no pay, and their reports still balance', async () => {
    const [entry] = await entriesForSource(owner, 'payslip', payslipId);
    expect(await getEntry(bookkeeper, entry!.id)).toBeNull();
    expect(await entriesForSource(bookkeeper, 'payslip', payslipId)).toEqual([]);
    expect(await unpaidPayslips(bookkeeper)).toEqual([]);
    const balance = await trialBalance(bookkeeper, today);
    expect(balance.totalDebit).toBe(balance.totalCredit);
    expect(balance.rows.find((row) => row.code === '477')).toBeUndefined();
  });

  it('paying net pay from the bank clears what is owed to the employee', async () => {
    expect(await unpaidPayslips(owner)).toEqual([
      expect.objectContaining({ payslipId, net: '270.00' }),
    ]);
    const payment = {
      payslipId,
      bankAccountId: await accountId(owner, '090'),
      date: addDaysToDate(start, 9),
    };
    await payPayslip(owner, payment);
    expect(await unpaidPayslips(owner)).toEqual([]);
    expect(await balanceOf(owner, '803')).toBe('0.00');
    await expectCode(() => payPayslip(owner, payment), 'VALIDATION');
  });
});

describe('the reports agree with each other', () => {
  it('trial balance balances; balance sheet balances; profit matches the accounts', async () => {
    await recordJournal(
      owner,
      journalSchema.parse({
        kind: 'opening_balance',
        date: start,
        description: 'Opening balances',
        lines: [
          { accountId: await accountId(owner, '091'), debit: '5000' },
          { accountId: await accountId(owner, '900'), credit: '2000' },
        ],
      }),
    );
    const balance = await trialBalance(owner, today);
    expect(balance.totalDebit).toBe(balance.totalCredit);

    const sheet = await balanceSheet(owner, today);
    expect(sheet.balanced).toBe(true);
    expect(sheet.netAssets).toBe(sheet.totalEquity);

    const profit = await profitAndLoss(owner, start, today);
    // Income: 100 + 100 (invoices; one voided). Expenses: rent 50 + wages 300 + super 36.
    expect(profit.netProfit.amount).toBe('-186.00');
    const earnings = sheet.equity.lines.find((line) => line.name === 'Current year earnings');
    expect(earnings?.amount).toBe(profit.netProfit.amount);
  });

  it('an account’s transactions add up to its balance', async () => {
    const bank = await accountId(owner, '090');
    const ledger = await accountLedger(owner, bank, start, today);
    expect(ledger?.closing).toBe(await balanceOf(owner, '090'));
    expect(ledger?.opening).toBe('0.00');
  });
});

describe('protecting the chart of accounts', () => {
  it('a system account cannot be archived; an account with transactions keeps its type', async () => {
    const receivables = await accountId(owner, '610');
    await expectCode(
      () => setAccountArchived(owner, { id: receivables, archived: true }),
      'VALIDATION',
    );
    const rent = saveAccountSchema.parse({
      id: await accountId(owner, '469'),
      code: '469',
      name: 'Rent',
      type: 'income',
      subtype: 'revenue',
    });
    await expectCode(() => saveAccount(owner, rent), 'VALIDATION');
  });

  it('a new account code must be unique', async () => {
    await expectCode(
      () =>
        saveAccount(
          owner,
          saveAccountSchema.parse({
            code: '469',
            name: 'Another rent',
            type: 'expense',
            subtype: 'expense',
          }),
        ),
      'DUPLICATE',
    );
  });
});

describe('the feature switch', () => {
  it('switched off: the books disappear, and invoices keep working without posting', async () => {
    const before = await ledgerRows(owner);
    await adminDb().execute(sql`
      update tenants set features = ${sql.raw(
        `array[${FEATURE_KEYS.filter((key) => key !== 'books')
          .map((key) => `'${key}'`)
          .join(',')}]::text[]`,
      )} where id = ${alphaTenant}`);
    const off = await contextFor(owner.userId, alphaTenant);
    expect(off.grants.has('books.view')).toBe(false);
    expect(await ledgerRows(owner)).toEqual({ entries: 0, lines: 0, accounts: 0, settings: 0 });

    const id = (await saveInvoice(off, invoice(addDaysToDate(start, 12)))).id;
    await markInvoiceSent(off, id);

    await adminDb().execute(sql`
      update tenants set features = ${sql.raw(
        `array[${FEATURE_KEYS.map((key) => `'${key}'`).join(',')}]::text[]`,
      )} where id = ${alphaTenant}`);
    expect(await ledgerRows(owner)).toEqual(before);
  });
});
