import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import {
  ledgerBillCredits,
  ledgerBillLines,
  ledgerBillPaymentAllocations,
  ledgerBillPayments,
  ledgerBills,
  ledgerTaxCodes,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { ledgerCall } from './ledger-call';
import { formatCents, parseCents, rateBasisPoints, taxInInclusive } from './money';
import { buildBill, PostingError } from './posting';
import type { BillCreditInput, BillInput, BillPaymentInput } from './schemas';

export const billNumber = (number: number) => `BILL-${String(number).padStart(4, '0')}`;

async function post(
  tx: Tx,
  kind: 'bill' | 'bill_payment' | 'bill_credit',
  id: string,
  event: string,
) {
  await ledgerCall(tx, sql`select app.ledger_post_bill_document(${kind}, ${id}::uuid, ${event})`);
}

async function taxRates(tx: Tx, ctx: TenantContext): Promise<Map<string, string>> {
  const codes = await tx
    .select({ id: ledgerTaxCodes.id, rate: ledgerTaxCodes.rate })
    .from(ledgerTaxCodes)
    .where(eq(ledgerTaxCodes.tenantId, ctx.tenantId));
  return new Map(codes.map((code) => [code.id, code.rate]));
}

/**
 * Enters a supplier bill and posts it. The same supplier reference from the same supplier looks
 * like a bill already entered; so does the same supplier, date and total when either bill has no
 * reference to tell them apart. Refused as a duplicate unless the person confirms it is different.
 */
export async function enterBill(
  ctx: TenantContext,
  input: BillInput,
): Promise<{ id: string; number: number }> {
  requirePermission(ctx, 'books.record');
  return withRls(ctx, async (tx) => {
    let built: ReturnType<typeof buildBill>;
    try {
      built = buildBill({
        amountsAre: input.amountsAre,
        items: input.items,
        taxRates: await taxRates(tx, ctx),
      });
    } catch (error) {
      if (error instanceof PostingError) throw new AppError('VALIDATION', error.message);
      throw error;
    }
    if (!input.allowDuplicate) {
      const [twin] = (await tx.execute(sql`
        select number from ledger_bills
        where tenant_id = ${ctx.tenantId} and voided_at is null
          and lower(supplier_name) = lower(${input.supplierName})
          and (
            (${input.supplierReference}::text is not null
              and lower(supplier_reference) = lower(${input.supplierReference}::text))
            or (date = ${input.date}::date and total = ${built.total}::numeric
                and (${input.supplierReference}::text is null or supplier_reference is null))
          )
        limit 1`)) as unknown as { number: number }[];
      if (twin) {
        throw new AppError(
          'DUPLICATE',
          `This looks like ${billNumber(twin.number)}, already entered from ${input.supplierName}. Save anyway if it is a different bill.`,
        );
      }
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bill:${ctx.tenantId}`}))`);
    const [next] = await tx
      .select({ number: sql<number>`coalesce(max(${ledgerBills.number}), 0) + 1` })
      .from(ledgerBills)
      .where(eq(ledgerBills.tenantId, ctx.tenantId));
    const [bill] = await tx
      .insert(ledgerBills)
      .values({
        tenantId: ctx.tenantId,
        number: next?.number ?? 1,
        supplierName: input.supplierName,
        supplierReference: input.supplierReference,
        date: input.date,
        dueDate: input.dueDate,
        amountsAre: input.amountsAre,
        subtotal: built.subtotal,
        taxTotal: built.taxTotal,
        total: built.total,
        currency: ctx.tenant.currency,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning({ id: ledgerBills.id, number: ledgerBills.number });
    if (!bill) throw new AppError('INTERNAL', 'Could not save the bill.');
    await tx.insert(ledgerBillLines).values(
      built.lines.map((line, position) => ({
        tenantId: ctx.tenantId,
        billId: bill.id,
        accountId: line.accountId,
        description: line.description,
        amount: line.amount,
        taxCodeId: line.taxCodeId,
        taxAmount: line.taxAmount,
        position,
      })),
    );
    await post(tx, 'bill', bill.id, 'entered');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'bill',
      entityId: bill.id,
      context: { total: built.total },
    });
    return bill;
  });
}

/** A bill entered by mistake: kept on record, reversed in the books. Its payments go first. */
export async function voidBill(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'books.record');
  return withRls(ctx, async (tx) => {
    const voided = await tx
      .update(ledgerBills)
      .set({ voidedAt: new Date(), voidedBy: ctx.userId })
      .where(
        and(
          eq(ledgerBills.tenantId, ctx.tenantId),
          eq(ledgerBills.id, id),
          sql`${ledgerBills.voidedAt} is null`,
        ),
      )
      .returning({ id: ledgerBills.id })
      .catch((error: unknown) => {
        const code = (error as { cause?: { code?: string } }).cause?.code;
        if (code === 'MB002') {
          throw new AppError('CONFLICT', 'Void the payments and credits on this bill first.');
        }
        throw error;
      });
    if (voided.length === 0) throw new AppError('NOT_FOUND', 'That bill was not found.');
    await post(tx, 'bill', id, 'voided');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'bill',
      entityId: id,
      changes: { status: ['entered', 'voided'] },
    });
    return { id };
  });
}

/** One payment to a supplier, split across the bills it settles. */
export async function payBills(
  ctx: TenantContext,
  input: BillPaymentInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'books.record');
  const ids = input.allocations.map((allocation) => allocation.billId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError('VALIDATION', 'Each bill appears once in a payment.');
  }
  const total = input.allocations.reduce(
    (sum, allocation) => sum + (parseCents(allocation.amount) ?? 0n),
    0n,
  );
  return withRls(ctx, async (tx) => {
    const owed = (await tx.execute(sql`
      select id, number, voided_at is not null as voided,
             app.bill_balance(tenant_id, id)::text as balance
      from ledger_bills
      where tenant_id = ${ctx.tenantId}
        and id in (${sql.join(
          ids.map((value) => sql`${value}::uuid`),
          sql`, `,
        )})
      for update`)) as unknown as {
      id: string;
      number: number;
      voided: boolean;
      balance: string;
    }[];
    for (const allocation of input.allocations) {
      const bill = owed.find((row) => row.id === allocation.billId);
      if (!bill || bill.voided) throw new AppError('NOT_FOUND', 'That bill was not found.');
      if ((parseCents(allocation.amount) ?? 0n) > (parseCents(bill.balance) ?? 0n)) {
        throw new AppError(
          'VALIDATION',
          `That is more than the ${formatMoney(bill.balance, ctx.tenant.currency)} owed on ${billNumber(bill.number)}.`,
        );
      }
    }
    const [payment] = await tx
      .insert(ledgerBillPayments)
      .values({
        tenantId: ctx.tenantId,
        date: input.date,
        amount: formatCents(total),
        currency: ctx.tenant.currency,
        accountId: input.bankAccountId,
        payeeName: input.payeeName,
        reference: input.reference,
        createdBy: ctx.userId,
      })
      .returning({ id: ledgerBillPayments.id });
    if (!payment) throw new AppError('INTERNAL', 'Could not record the payment.');
    await tx.insert(ledgerBillPaymentAllocations).values(
      input.allocations.map((allocation) => ({
        tenantId: ctx.tenantId,
        paymentId: payment.id,
        billId: allocation.billId,
        amount: allocation.amount,
      })),
    );
    await post(tx, 'bill_payment', payment.id, 'paid');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'bill_payment',
      entityId: payment.id,
      context: { amount: formatCents(total), bills: ids.length },
    });
    return payment;
  });
}

export async function voidBillPayment(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'books.record');
  return withRls(ctx, async (tx) => {
    const voided = await tx
      .update(ledgerBillPayments)
      .set({ voidedAt: new Date(), voidedBy: ctx.userId })
      .where(
        and(
          eq(ledgerBillPayments.tenantId, ctx.tenantId),
          eq(ledgerBillPayments.id, id),
          sql`${ledgerBillPayments.voidedAt} is null`,
        ),
      )
      .returning({ id: ledgerBillPayments.id });
    if (voided.length === 0) throw new AppError('NOT_FOUND', 'That payment was not found.');
    await post(tx, 'bill_payment', id, 'voided');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'bill_payment',
      entityId: id,
      changes: { status: ['paid', 'voided'] },
    });
    return { id };
  });
}

/** A supplier's credit note against a bill, including GST at the chosen code's rate. */
export async function creditBill(
  ctx: TenantContext,
  input: BillCreditInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'books.record');
  return withRls(ctx, async (tx) => {
    const [bill] = (await tx.execute(sql`
      select voided_at is not null as voided, app.bill_balance(tenant_id, id)::text as balance
      from ledger_bills where tenant_id = ${ctx.tenantId} and id = ${input.billId}
      for update`)) as unknown as { voided: boolean; balance: string }[];
    if (!bill || bill.voided) throw new AppError('NOT_FOUND', 'That bill was not found.');
    const amount = parseCents(input.amount) ?? 0n;
    if (amount > (parseCents(bill.balance) ?? 0n)) {
      throw new AppError(
        'VALIDATION',
        `A credit can be up to the ${formatMoney(bill.balance, ctx.tenant.currency)} still owed.`,
        { amount: ['More than is owed'] },
      );
    }
    const rate = input.taxCodeId ? (await taxRates(tx, ctx)).get(input.taxCodeId) : '0';
    const points = rate === undefined ? null : rateBasisPoints(rate);
    if (points === null) throw new AppError('VALIDATION', 'That tax code is not available.');
    const tax = taxInInclusive(amount, points);
    const [credit] = await tx
      .insert(ledgerBillCredits)
      .values({
        tenantId: ctx.tenantId,
        billId: input.billId,
        date: input.date,
        reason: input.reason,
        supplierReference: input.supplierReference,
        accountId: input.accountId,
        taxCodeId: input.taxCodeId,
        subtotal: formatCents(amount - tax),
        taxTotal: formatCents(tax),
        total: formatCents(amount),
        currency: ctx.tenant.currency,
        createdBy: ctx.userId,
      })
      .returning({ id: ledgerBillCredits.id });
    if (!credit) throw new AppError('INTERNAL', 'Could not record the credit.');
    await post(tx, 'bill_credit', credit.id, 'issued');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'bill_credit',
      entityId: credit.id,
      context: { billId: input.billId, amount: input.amount },
    });
    return credit;
  });
}

export async function voidBillCredit(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'books.record');
  return withRls(ctx, async (tx) => {
    const voided = await tx
      .update(ledgerBillCredits)
      .set({ voidedAt: new Date(), voidedBy: ctx.userId })
      .where(
        and(
          eq(ledgerBillCredits.tenantId, ctx.tenantId),
          eq(ledgerBillCredits.id, id),
          sql`${ledgerBillCredits.voidedAt} is null`,
        ),
      )
      .returning({ id: ledgerBillCredits.id });
    if (voided.length === 0) throw new AppError('NOT_FOUND', 'That credit was not found.');
    await post(tx, 'bill_credit', id, 'voided');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'bill_credit',
      entityId: id,
      changes: { status: ['issued', 'voided'] },
    });
    return { id };
  });
}
