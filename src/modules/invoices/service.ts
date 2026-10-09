import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { invoiceLines, invoices } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { isEmailConfigured, sendEmail } from '@/server/email';

import { getInvoice } from './queries';
import type { SaveInvoiceInput } from './schemas';
import { invoiceNumber, type InvoiceDetail, type InvoiceStatus } from './types';

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

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The invoice as an email the customer can read without opening anything. */
export function renderInvoiceEmail(
  invoice: InvoiceDetail,
  sellerName: string,
): { subject: string; text: string; html: string } {
  const reference = invoiceNumber(invoice.number);
  const money = (value: string) => formatMoney(value, invoice.currency);
  const taxed = Number(invoice.taxRate) > 0;
  const subject = `${taxed ? 'Tax invoice' : 'Invoice'} ${reference} from ${sellerName}`;
  const totals = [
    `Subtotal: ${money(invoice.subtotal)}`,
    taxed ? `Tax (${Number(invoice.taxRate)}%): ${money(invoice.taxTotal)}` : null,
    `Total due: ${money(invoice.total)}`,
  ].filter(Boolean);

  const text = [
    `Hello ${invoice.customerName},`,
    `Please find ${taxed ? 'tax invoice' : 'invoice'} ${reference}, dated ${formatCalendarDate(invoice.issueDate)} and due ${formatCalendarDate(invoice.dueDate)}.`,
    invoice.lines
      .map(
        (line) =>
          `${Number(line.quantity)} x ${line.description} @ ${money(line.unitPrice)} = ${money(line.lineTotal)}`,
      )
      .join('\n'),
    totals.join('\n'),
    invoice.notes,
    invoice.fromDetails ? `From:\n${invoice.fromDetails}` : `From: ${sellerName}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const cell = 'padding:6px 12px 6px 0;border-bottom:1px solid #e5e7eb;text-align:left';
  const html = `<p>Hello ${escapeHtml(invoice.customerName)},</p>
<p>Please find ${taxed ? 'tax invoice' : 'invoice'} <strong>${reference}</strong>, dated ${escapeHtml(formatCalendarDate(invoice.issueDate))} and due <strong>${escapeHtml(formatCalendarDate(invoice.dueDate))}</strong>.</p>
<table style="border-collapse:collapse;font-size:14px"><thead><tr><th style="${cell}">Description</th><th style="${cell}">Qty</th><th style="${cell}">Price</th><th style="${cell}">Amount</th></tr></thead><tbody>${invoice.lines
    .map(
      (line) =>
        `<tr><td style="${cell}">${escapeHtml(line.description)}</td><td style="${cell}">${Number(line.quantity)}</td><td style="${cell}">${escapeHtml(money(line.unitPrice))}</td><td style="${cell}">${escapeHtml(money(line.lineTotal))}</td></tr>`,
    )
    .join('')}</tbody></table>
<p>${totals.map((line) => escapeHtml(line ?? '')).join('<br>')}</p>
${invoice.notes ? `<p>${escapeHtml(invoice.notes)}</p>` : ''}
<p style="white-space:pre-line">${escapeHtml(invoice.fromDetails ?? sellerName)}</p>`;
  return { subject, text, html };
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
  if (!invoice.customerEmail) {
    return { sent: false, reason: 'Add the customer’s email address to send this invoice.' };
  }
  if (!isEmailConfigured()) {
    return { sent: false, reason: 'Email sending is not set up for this system yet.' };
  }
  const result = await sendEmail({
    to: invoice.customerEmail,
    replyTo: ctx.email || undefined,
    ...renderInvoiceEmail(invoice, ctx.tenant.name),
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

export async function markInvoicePaid(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'invoices.manage');
  await setStatus(ctx, id, 'paid', ['sent'], { paidAt: new Date() });
  return { id };
}

export async function voidInvoice(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'invoices.manage');
  await setStatus(ctx, id, 'void', ['draft', 'sent']);
  return { id };
}
