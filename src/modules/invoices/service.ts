import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import {
  invoiceCreditNotes,
  invoiceLines,
  invoicePaymentAllocations,
  invoicePayments,
  invoices,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import {
  assertBooksOpenOn,
  recordCreditNoteInBooks,
  recordInvoiceInBooks,
  recordPaymentInBooks,
} from '@/modules/books/hooks';
import { formatCents, parseCents } from '@/modules/books/money';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { isEmailConfigured, sendEmail } from '@/server/email';

import { getInvoice } from './queries';
import type { CreditNoteInput, RecordPaymentInput, SaveInvoiceInput } from './schemas';
import { invoiceNumber, type InvoiceDetail, type InvoiceStatus } from './types';
import { renderEmail } from '@/server/email-template';

async function loadStatus(tx: Tx, ctx: TenantContext, id: string): Promise<InvoiceStatus> {
  const [row] = await tx
    .select({ status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.id, id)))
    .limit(1)
    .for('update');
  if (!row) throw new AppError('NOT_FOUND', 'That invoice was not found.');
  return row.status;
}

/**
 * Creates a draft, or replaces the contents of one. Line totals, the subtotal, tax and total are
 * all worked out by the database on exact decimals. Once an invoice has been sent it can no
 * longer be edited: void it and raise a new one, so what the customer received stays on record.
 */
export async function saveInvoice(
  ctx: TenantContext,
  input: SaveInvoiceInput,
): Promise<{ id: string; number: number }> {
  requirePermission(ctx, 'invoices.manage');
  return withRls(ctx, async (tx) => {
    const fields = {
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerAddress: input.customerAddress,
      fromDetails: input.fromDetails,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      taxRate: input.taxRate,
      notes: input.notes,
      updatedBy: ctx.userId,
    };

    let saved: { id: string; number: number } | undefined;
    if (input.id) {
      if ((await loadStatus(tx, ctx, input.id)) !== 'draft') {
        throw new AppError(
          'CONFLICT',
          'Only a draft can be edited. Void this invoice and raise a new one.',
        );
      }
      [saved] = await tx
        .update(invoices)
        .set(fields)
        .where(and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.id, input.id)))
        .returning({ id: invoices.id, number: invoices.number });
      await tx
        .delete(invoiceLines)
        .where(and(eq(invoiceLines.tenantId, ctx.tenantId), eq(invoiceLines.invoiceId, input.id)));
    } else {
      // One invoice number at a time per workspace, with no gaps from two people saving at once.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${ctx.tenantId}`}))`);
      const [next] = await tx
        .select({ number: sql<number>`coalesce(max(${invoices.number}), 0) + 1` })
        .from(invoices)
        .where(eq(invoices.tenantId, ctx.tenantId));
      [saved] = await tx
        .insert(invoices)
        .values({
          ...fields,
          tenantId: ctx.tenantId,
          number: next?.number ?? 1,
          currency: ctx.tenant.currency,
          createdBy: ctx.userId,
        })
        .returning({ id: invoices.id, number: invoices.number });
    }
    if (!saved) throw new AppError('INTERNAL', 'Could not save the invoice.');
    const invoiceId = saved.id;

    await tx.insert(invoiceLines).values(
      input.lines.map((line, position) => ({
        tenantId: ctx.tenantId,
        invoiceId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: sql`round(${line.unitPrice}::numeric * ${line.quantity}::numeric, 2)`,
        position,
      })),
    );
    await tx.execute(sql`
      update invoices set
        subtotal = t.subtotal,
        tax_total = round(t.subtotal * tax_rate / 100, 2),
        total = t.subtotal + round(t.subtotal * tax_rate / 100, 2)
      from (select coalesce(sum(line_total), 0) as subtotal from invoice_lines
            where tenant_id = ${ctx.tenantId} and invoice_id = ${invoiceId}) t
      where invoices.tenant_id = ${ctx.tenantId} and invoices.id = ${invoiceId}`);

    await audit(tx, ctx, {
      action: input.id ? 'update' : 'create',
      entityType: 'invoice',
      entityId: invoiceId,
    });
    return saved;
  });
}

/** The invoice as an email the customer can read without opening anything. */
export function renderInvoiceEmail(
  invoice: InvoiceDetail,
  sellerName: string,
  sellerColor: string | null = null,
): { subject: string; text: string; html: string } {
  const reference = invoiceNumber(invoice.number);
  const money = (value: string) => formatMoney(value, invoice.currency);
  const taxed = Number(invoice.taxRate) > 0;
  const kind = taxed ? 'Tax invoice' : 'Invoice';
  const subject = `${kind} ${reference} from ${sellerName}`;
  const issued = formatCalendarDate(invoice.issueDate);
  const due = formatCalendarDate(invoice.dueDate);

  const email = renderEmail({
    sender: { kind: 'business', name: sellerName, color: sellerColor },
    preheader: `${money(invoice.total)} due ${due}.`,
    heading: `${kind} ${reference}`,
    blocks: [
      { type: 'paragraph', text: `Hello ${invoice.customerName},` },
      {
        type: 'paragraph',
        text: `Please find ${kind.toLowerCase()} ${reference}, dated ${issued} and due ${due}.`,
      },
      {
        type: 'details',
        rows: [
          { label: 'Amount due', value: money(invoice.total) },
          { label: 'Due date', value: due },
          { label: 'Reference', value: reference },
        ],
      },
      {
        type: 'table',
        columns: ['Description', 'Qty', 'Price', 'Amount'],
        numericFrom: 1,
        rows: invoice.lines.map((line) => [
          line.description,
          String(Number(line.quantity)),
          money(line.unitPrice),
          money(line.lineTotal),
        ]),
        textRows: invoice.lines.map(
          (line) =>
            `${Number(line.quantity)} x ${line.description} @ ${money(line.unitPrice)} = ${money(line.lineTotal)}`,
        ),
        totals: [
          { label: 'Subtotal', value: money(invoice.subtotal) },
          ...(taxed
            ? [{ label: `Tax (${Number(invoice.taxRate)}%)`, value: money(invoice.taxTotal) }]
            : []),
          { label: 'Total due', value: money(invoice.total), strong: true },
        ],
      },
      ...(invoice.notes ? [{ type: 'message' as const, text: invoice.notes }] : []),
    ],
    // The seller's own details (name, ABN, address, payment details) sign the invoice.
    signature: invoice.fromDetails
      ? invoice.fromDetails.split('\n').filter((line) => line.trim())
      : [sellerName],
    reason: `You received this invoice from ${sellerName}. Reply to this email with any questions about it.`,
  });
  return { subject, ...email };
}

async function setStatus(
  ctx: TenantContext,
  id: string,
  next: InvoiceStatus,
  allowedFrom: InvoiceStatus[],
  extra: Partial<typeof invoices.$inferInsert> = {},
): Promise<void> {
  await withRls(ctx, async (tx) => {
    const current = await loadStatus(tx, ctx, id);
    if (!allowedFrom.includes(current)) {
      throw new AppError('CONFLICT', `An invoice that is ${current} cannot be marked ${next}.`);
    }
    await tx
      .update(invoices)
      .set({ status: next, updatedBy: ctx.userId, ...extra })
      .where(and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.id, id)));
    // The books follow in the same transaction: issued, paid, or the issue reversed (ADR-060).
    if (next === 'sent' || next === 'void') {
      await recordInvoiceInBooks(tx, id, next === 'sent' ? 'issued' : 'voided');
    }
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'invoice',
      entityId: id,
      changes: { status: [current, next] },
    });
  });
}

/**
 * Emails the invoice to the customer and marks it sent. If the email cannot go out the invoice is
 * left as it was, with the reason, so nothing is recorded as sent that the customer never got.
 */
export async function sendInvoice(
  ctx: TenantContext,
  id: string,
): Promise<{ sent: boolean; reason: string | null }> {
  requirePermission(ctx, 'invoices.manage');
  const invoice = await getInvoice(ctx, id);
  if (!invoice) throw new AppError('NOT_FOUND', 'That invoice was not found.');
  if (invoice.status !== 'draft' && invoice.status !== 'sent') {
    throw new AppError('CONFLICT', `An invoice that is ${invoice.status} cannot be sent.`);
  }
  // An email cannot be called back: if the books would refuse this invoice's date, say so first.
  await withRls(ctx, (tx) => assertBooksOpenOn(tx, invoice.issueDate));
  if (!invoice.customerEmail) {
    return { sent: false, reason: 'Add the customer’s email address to send this invoice.' };
  }
  if (!isEmailConfigured()) {
    return { sent: false, reason: 'Email sending is not set up for this system yet.' };
  }
  const result = await sendEmail({
    to: invoice.customerEmail,
    replyTo: ctx.email || undefined,
    ...renderInvoiceEmail(invoice, ctx.tenant.name, ctx.tenant.primaryColor),
  });
  if (!result.sent) return { sent: false, reason: 'The email could not be sent. Try again.' };
  await setStatus(ctx, id, 'sent', ['draft', 'sent'], {
    sentAt: new Date(),
    sentTo: invoice.customerEmail,
  });
  return { sent: true, reason: null };
}

/** For an invoice handed over some other way: printed, or attached to your own email. */
export async function markInvoiceSent(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'invoices.manage');
  await setStatus(ctx, id, 'sent', ['draft'], { sentAt: new Date() });
  return { id };
}

/** The whole balance, paid today: the one-click "Mark paid", now a payment of its own. */
export async function markInvoicePaid(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'invoices.manage');
  const balance = await withRls(ctx, async (tx) => {
    const [row] = (await tx.execute(sql`
      select status, customer_name as "customerName",
             app.invoice_balance(tenant_id, id)::text as balance
      from invoices where tenant_id = ${ctx.tenantId} and id = ${id}`)) as unknown as {
      status: InvoiceStatus;
      customerName: string;
      balance: string;
    }[];
    if (!row) throw new AppError('NOT_FOUND', 'That invoice was not found.');
    if (row.status !== 'sent') {
      throw new AppError('CONFLICT', `An invoice that is ${row.status} cannot be marked paid.`);
    }
    return row;
  });
  await recordPayment(ctx, {
    date: zonedToday(ctx.tenant.timezone),
    payerName: balance.customerName,
    reference: null,
    accountId: null,
    allocations: [{ invoiceId: id, amount: balance.balance }],
  });
  return { id };
}

/** Sets each invoice to paid when nothing is owed, and back to sent when something is again. */
async function settleStatuses(tx: Tx, ctx: TenantContext, invoiceIds: string[]): Promise<void> {
  for (const invoiceId of invoiceIds) {
    await tx.execute(sql`
      update invoices set
        status = case when app.invoice_balance(tenant_id, id) = 0 then 'paid' else 'sent' end::invoice_status,
        paid_at = case when app.invoice_balance(tenant_id, id) = 0 then coalesce(paid_at, now()) end,
        updated_by = ${ctx.userId}
      where tenant_id = ${ctx.tenantId} and id = ${invoiceId} and status in ('sent', 'paid')`);
  }
}

/**
 * Money received: one payment, split across the invoices it pays. Each must be sent and still
 * owe at least its share; the database checks the split adds up and nothing is overpaid.
 */
export async function recordPayment(
  ctx: TenantContext,
  input: RecordPaymentInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'invoices.manage');
  const ids = input.allocations.map((allocation) => allocation.invoiceId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError('VALIDATION', 'Each invoice appears once in a payment.');
  }
  const total = input.allocations.reduce(
    (sum, allocation) => sum + (parseCents(allocation.amount) ?? 0n),
    0n,
  );
  return withRls(ctx, async (tx) => {
    const owed = (await tx.execute(sql`
      select id, status, number, app.invoice_balance(tenant_id, id)::text as balance
      from invoices where tenant_id = ${ctx.tenantId}
        and id in (${sql.join(
          ids.map((value) => sql`${value}::uuid`),
          sql`, `,
        )})
      for update`)) as unknown as {
      id: string;
      status: InvoiceStatus;
      number: number;
      balance: string;
    }[];
    for (const allocation of input.allocations) {
      const invoice = owed.find((row) => row.id === allocation.invoiceId);
      if (!invoice) throw new AppError('NOT_FOUND', 'That invoice was not found.');
      if (invoice.status !== 'sent') {
        throw new AppError(
          'CONFLICT',
          `${invoiceNumber(invoice.number)} is not waiting for payment.`,
        );
      }
      if ((parseCents(allocation.amount) ?? 0n) > (parseCents(invoice.balance) ?? 0n)) {
        throw new AppError(
          'VALIDATION',
          `That is more than the ${formatMoney(invoice.balance, ctx.tenant.currency)} owed on ${invoiceNumber(invoice.number)}.`,
        );
      }
    }
    const [payment] = await tx
      .insert(invoicePayments)
      .values({
        tenantId: ctx.tenantId,
        date: input.date,
        amount: formatCents(total),
        currency: ctx.tenant.currency,
        payerName: input.payerName,
        reference: input.reference,
        accountId: input.accountId,
        createdBy: ctx.userId,
      })
      .returning({ id: invoicePayments.id });
    if (!payment) throw new AppError('INTERNAL', 'Could not record the payment.');
    await tx.insert(invoicePaymentAllocations).values(
      input.allocations.map((allocation) => ({
        tenantId: ctx.tenantId,
        paymentId: payment.id,
        invoiceId: allocation.invoiceId,
        amount: allocation.amount,
      })),
    );
    await settleStatuses(tx, ctx, ids);
    await recordPaymentInBooks(tx, payment.id, 'received');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'invoice_payment',
      entityId: payment.id,
      context: { amount: formatCents(total), invoices: ids.length },
    });
    return payment;
  });
}

/** A payment recorded by mistake: kept on record, no longer counted, reversed in the books. */
export async function voidPayment(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'invoices.manage');
  return withRls(ctx, async (tx) => {
    const voided = await tx
      .update(invoicePayments)
      .set({ voidedAt: new Date(), voidedBy: ctx.userId })
      .where(
        and(
          eq(invoicePayments.tenantId, ctx.tenantId),
          eq(invoicePayments.id, id),
          sql`${invoicePayments.voidedAt} is null`,
        ),
      )
      .returning({ id: invoicePayments.id });
    if (voided.length === 0) throw new AppError('NOT_FOUND', 'That payment was not found.');
    const allocations = await tx
      .select({ invoiceId: invoicePaymentAllocations.invoiceId })
      .from(invoicePaymentAllocations)
      .where(
        and(
          eq(invoicePaymentAllocations.tenantId, ctx.tenantId),
          eq(invoicePaymentAllocations.paymentId, id),
        ),
      );
    await settleStatuses(
      tx,
      ctx,
      allocations.map((row) => row.invoiceId),
    );
    await recordPaymentInBooks(tx, id, 'voided');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'invoice_payment',
      entityId: id,
      changes: { status: ['recorded', 'voided'] },
    });
    return { id };
  });
}

/**
 * A credit against a sent invoice, including tax at the invoice's own rate, up to what is still
 * owed. Numbered CN-0001 onwards.
 */
export async function issueCreditNote(
  ctx: TenantContext,
  input: CreditNoteInput,
): Promise<{ id: string; number: number }> {
  requirePermission(ctx, 'invoices.manage');
  return withRls(ctx, async (tx) => {
    const [invoice] = (await tx.execute(sql`
      select status, tax_rate::text as "taxRate", app.invoice_balance(tenant_id, id)::text as balance
      from invoices where tenant_id = ${ctx.tenantId} and id = ${input.invoiceId}
      for update`)) as unknown as { status: InvoiceStatus; taxRate: string; balance: string }[];
    if (!invoice) throw new AppError('NOT_FOUND', 'That invoice was not found.');
    if (invoice.status !== 'sent') {
      throw new AppError('CONFLICT', 'Only an invoice that is still owed can be credited.');
    }
    if ((parseCents(input.amount) ?? 0n) > (parseCents(invoice.balance) ?? 0n)) {
      throw new AppError(
        'VALIDATION',
        `A credit can be up to the ${formatMoney(invoice.balance, ctx.tenant.currency)} still owed.`,
        { amount: ['More than is owed'] },
      );
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credit:${ctx.tenantId}`}))`);
    const [next] = await tx
      .select({ number: sql<number>`coalesce(max(${invoiceCreditNotes.number}), 0) + 1` })
      .from(invoiceCreditNotes)
      .where(eq(invoiceCreditNotes.tenantId, ctx.tenantId));
    // The tax inside the credit, at the invoice's rate, on exact decimals.
    const [credit] = await tx
      .insert(invoiceCreditNotes)
      .values({
        tenantId: ctx.tenantId,
        number: next?.number ?? 1,
        invoiceId: input.invoiceId,
        date: input.date,
        reason: input.reason,
        total: input.amount,
        taxTotal: sql`round(${input.amount}::numeric * ${invoice.taxRate}::numeric / (100 + ${invoice.taxRate}::numeric), 2)`,
        subtotal: sql`${input.amount}::numeric - round(${input.amount}::numeric * ${invoice.taxRate}::numeric / (100 + ${invoice.taxRate}::numeric), 2)`,
        currency: ctx.tenant.currency,
        createdBy: ctx.userId,
      })
      .returning({ id: invoiceCreditNotes.id, number: invoiceCreditNotes.number });
    if (!credit) throw new AppError('INTERNAL', 'Could not issue the credit note.');
    await settleStatuses(tx, ctx, [input.invoiceId]);
    await recordCreditNoteInBooks(tx, credit.id, 'issued');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'credit_note',
      entityId: credit.id,
      context: { invoiceId: input.invoiceId, amount: input.amount },
    });
    return credit;
  });
}

export async function voidCreditNote(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'invoices.manage');
  return withRls(ctx, async (tx) => {
    const voided = await tx
      .update(invoiceCreditNotes)
      .set({ voidedAt: new Date(), voidedBy: ctx.userId })
      .where(
        and(
          eq(invoiceCreditNotes.tenantId, ctx.tenantId),
          eq(invoiceCreditNotes.id, id),
          sql`${invoiceCreditNotes.voidedAt} is null`,
        ),
      )
      .returning({ invoiceId: invoiceCreditNotes.invoiceId });
    const invoiceId = voided[0]?.invoiceId;
    if (!invoiceId) throw new AppError('NOT_FOUND', 'That credit note was not found.');
    await settleStatuses(tx, ctx, [invoiceId]);
    await recordCreditNoteInBooks(tx, id, 'voided');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'credit_note',
      entityId: id,
      changes: { status: ['issued', 'voided'] },
    });
    return { id };
  });
}

export async function voidInvoice(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'invoices.manage');
  const [live] = (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select (select count(*)::int from invoice_payment_allocations a
              join invoice_payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
              where a.tenant_id = ${ctx.tenantId} and a.invoice_id = ${id} and p.voided_at is null)
           + (select count(*)::int from invoice_credit_notes c
              where c.tenant_id = ${ctx.tenantId} and c.invoice_id = ${id} and c.voided_at is null)
             as n`),
  )) as unknown as { n: number }[];
  if ((live?.n ?? 0) > 0) {
    throw new AppError('CONFLICT', 'Void the payments and credit notes on this invoice first.');
  }
  await setStatus(ctx, id, 'void', ['draft', 'sent']);
  return { id };
}
