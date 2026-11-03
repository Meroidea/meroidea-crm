import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addDaysToDate, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { financialYearStart } from '@/modules/books/money';
import { entriesForSource, getEntry, listAccounts } from '@/modules/books/queries';
import { setupBooksSchema } from '@/modules/books/schemas';
import { setupBooks } from '@/modules/books/service';
import { getInvoice, getInvoiceTotals, listOutstandingInvoices } from '@/modules/invoices/queries';
import {
  creditNoteSchema,
  recordPaymentSchema,
  saveInvoiceSchema,
} from '@/modules/invoices/schemas';
import {
  issueCreditNote,
  markInvoicePaid,
  markInvoiceSent,
  recordPayment,
  saveInvoice,
  voidCreditNote,
  voidInvoice,
  voidPayment,
} from '@/modules/invoices/service';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
let users: string[];
let betaUsers: string[];
let owner: TenantContext;
let manager: TenantContext;
let outsider: TenantContext;
let today: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function sentInvoice(ctx: TenantContext, unitPrice: string, taxRate = '10') {
  const { id } = await saveInvoice(
    ctx,
    saveInvoiceSchema.parse({
      customerName: 'Lumen Studio',
      issueDate: today,
      dueDate: addDaysToDate(today, 14),
      taxRate,
      lines: [{ description: 'Work', quantity: '1', unitPrice }],
    }),
  );
  await markInvoiceSent(ctx, id);
  return id;
}

const pay = (ctx: TenantContext, allocations: { invoiceId: string; amount: string }[]) =>
  recordPayment(ctx, recordPaymentSchema.parse({ date: today, payerName: 'Lumen', allocations }));

beforeAll(async () => {
  const alpha = await createWorkspace('Payments Alpha', mail('pay-alpha'));
  const beta = await createWorkspace('Payments Beta', mail('pay-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  const managerId = await addMember(alphaTenant, mail('pay-mgr'), 'Mia Manager', 'manager');
  users = [alpha.ownerId, managerId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  manager = await contextFor(managerId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);
  today = zonedToday(owner.tenant.timezone);
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, users);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('payments', () => {
  it('two part payments settle an invoice; it stays sent until nothing is owed', async () => {
    const id = await sentInvoice(owner, '100'); // 110 with GST
    await pay(owner, [{ invoiceId: id, amount: '60' }]);
    expect(await getInvoice(owner, id)).toMatchObject({ status: 'sent', balance: '50.00' });
    await pay(owner, [{ invoiceId: id, amount: '50' }]);
    const invoice = await getInvoice(owner, id);
    expect(invoice).toMatchObject({ status: 'paid', balance: '0.00' });
    expect(invoice?.payments.map((payment) => payment.amount)).toEqual(['60.00', '50.00']);
    expect(invoice?.paidAt).not.toBeNull();
  });

  it('one payment settles several invoices at once', async () => {
    const first = await sentInvoice(owner, '10'); // 11
    const second = await sentInvoice(owner, '20'); // 22
    const { id } = await pay(owner, [
      { invoiceId: first, amount: '11' },
      { invoiceId: second, amount: '22' },
    ]);
    expect((await getInvoice(owner, first))?.status).toBe('paid');
    expect((await getInvoice(owner, second))?.payments[0]).toMatchObject({
      id,
      amount: '22.00',
      paymentTotal: '33.00',
      otherInvoices: 1,
    });
  });

  it('never takes more than is owed, in the app or in the database', async () => {
    const id = await sentInvoice(owner, '10');
    await expectCode(() => pay(owner, [{ invoiceId: id, amount: '11.01' }]), 'VALIDATION');
    // Straight to the tables, as code that skipped the service would: refused at commit.
    await expect(
      withRls(owner, async (tx) => {
        const [payment] = (await tx.execute(sql`
          insert into invoice_payments (tenant_id, date, amount, currency)
          values (${alphaTenant}, ${today}::date, 20, 'AUD') returning id`)) as unknown as {
          id: string;
        }[];
        await tx.execute(sql`
          insert into invoice_payment_allocations (tenant_id, payment_id, invoice_id, amount)
          values (${alphaTenant}, ${payment!.id}, ${id}, 20)`);
      }),
    ).rejects.toThrow();
    // A payment that is not split exactly across its invoices is refused too.
    await expect(
      withRls(owner, async (tx) => {
        const [payment] = (await tx.execute(sql`
          insert into invoice_payments (tenant_id, date, amount, currency)
          values (${alphaTenant}, ${today}::date, 5, 'AUD') returning id`)) as unknown as {
          id: string;
        }[];
        await tx.execute(sql`
          insert into invoice_payment_allocations (tenant_id, payment_id, invoice_id, amount)
          values (${alphaTenant}, ${payment!.id}, ${id}, 4)`);
      }),
    ).rejects.toThrow();
    expect((await getInvoice(owner, id))?.balance).toBe('11.00');
  });

  it('a payment cannot be edited or deleted, only voided; voiding reopens the invoice', async () => {
    const id = await sentInvoice(owner, '10');
    const { id: paymentId } = await pay(owner, [{ invoiceId: id, amount: '11' }]);
    await expect(
      withRls(owner, (tx) =>
        tx.execute(sql`update invoice_payments set amount = 1 where id = ${paymentId}`),
      ),
    ).rejects.toThrow();
    await expect(
      withRls(owner, (tx) => tx.execute(sql`delete from invoice_payments where id = ${paymentId}`)),
    ).rejects.toThrow();
    await expectCode(() => voidInvoice(owner, id), 'CONFLICT');
    await voidPayment(owner, paymentId);
    expect(await getInvoice(owner, id)).toMatchObject({
      status: 'sent',
      balance: '11.00',
      paidAt: null,
    });
    await expectCode(() => voidPayment(owner, paymentId), 'NOT_FOUND');
    await voidInvoice(owner, id);
  });

  it('"Mark paid" still works: it records a payment of the whole balance', async () => {
    const id = await sentInvoice(owner, '40');
    await pay(owner, [{ invoiceId: id, amount: '4' }]);
    await markInvoicePaid(owner, id);
    const invoice = await getInvoice(owner, id);
    expect(invoice?.status).toBe('paid');
    expect(invoice?.payments.map((payment) => payment.amount)).toEqual(['4.00', '40.00']);
  });

  it('only those who manage invoices see payments; another business never can', async () => {
    const id = await sentInvoice(owner, '10');
    await expectCode(() => pay(manager, [{ invoiceId: id, amount: '1' }]), 'FORBIDDEN');
    const [row] = (await withRls(manager, (tx) =>
      tx.execute(sql`select (select count(*)::int from invoice_payments) as payments,
                            (select count(*)::int from invoice_credit_notes) as credits`),
    )) as unknown as { payments: number; credits: number }[];
    expect(row).toEqual({ payments: 0, credits: 0 });
    await expectCode(() => pay(outsider, [{ invoiceId: id, amount: '1' }]), 'NOT_FOUND');
    expect(await listOutstandingInvoices(outsider)).toEqual([]);
  });
});

describe('credit notes', () => {
  it('credits an invoice including GST at its rate, numbered from CN-0001', async () => {
    const id = await sentInvoice(owner, '200'); // 220
    const credit = await issueCreditNote(
      owner,
      creditNoteSchema.parse({ invoiceId: id, date: today, amount: '55', reason: 'Late delivery' }),
    );
    expect(credit.number).toBe(1);
    const invoice = await getInvoice(owner, id);
    expect(invoice?.creditNotes[0]).toMatchObject({
      subtotal: '50.00',
      taxTotal: '5.00',
      total: '55.00',
    });
    expect(invoice?.balance).toBe('165.00');
    await expectCode(
      () =>
        issueCreditNote(
          owner,
          creditNoteSchema.parse({
            invoiceId: id,
            date: today,
            amount: '165.01',
            reason: 'Too much',
          }),
        ),
      'VALIDATION',
    );
    await voidCreditNote(owner, credit.id);
    expect((await getInvoice(owner, id))?.balance).toBe('220.00');
  });

  it('a credit for the whole balance closes the invoice', async () => {
    const id = await sentInvoice(owner, '10', '0');
    await issueCreditNote(
      owner,
      creditNoteSchema.parse({ invoiceId: id, date: today, amount: '10', reason: 'Not needed' }),
    );
    expect(await getInvoice(owner, id)).toMatchObject({ status: 'paid', balance: '0.00' });
  });

  it('what is outstanding counts the balance, not the total', async () => {
    const before = await getInvoiceTotals(owner);
    const id = await sentInvoice(owner, '100');
    await pay(owner, [{ invoiceId: id, amount: '30' }]);
    const after = await getInvoiceTotals(owner);
    expect(Number(after.outstanding) - Number(before.outstanding)).toBeCloseTo(80, 2);
  });
});

describe('payments and credit notes in the books', () => {
  it('post receivables, bank, income and GST, and reverse when voided', async () => {
    await setupBooks(
      owner,
      setupBooksSchema.parse({
        country: 'AU',
        startDate: financialYearStart(today, 7),
        financialYearStartMonth: 7,
      }),
    );
    const id = await sentInvoice(owner, '100'); // 110
    const { id: paymentId } = await pay(owner, [{ invoiceId: id, amount: '44' }]);
    await issueCreditNote(
      owner,
      creditNoteSchema.parse({ invoiceId: id, date: today, amount: '22', reason: 'Discount' }),
    );
    const entries = await entriesForSource(owner, 'invoice', id);
    expect(entries.map((entry) => entry.kind)).toEqual([
      'invoice',
      'invoice_payment',
      'credit_note',
    ]);

    const credit = await getEntry(owner, entries[2]!.id);
    expect(credit?.lines.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['200', '20.00', '0.00'],
      ['820', '2.00', '0.00'],
      ['610', '0.00', '22.00'],
    ]);

    await voidPayment(owner, paymentId);
    const after = await entriesForSource(owner, 'invoice', id);
    expect(after.map((entry) => entry.kind)).toContain('reversal');

    // Every invoice is in the books by now (caught up at setup), so receivables equal what the
    // invoices say is still owed.
    const receivable = (await listAccounts(owner)).find((account) => account.code === '610');
    const totals = await getInvoiceTotals(owner);
    expect(receivable?.balance).toBe(totals.outstanding);
  });
});
