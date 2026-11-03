import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm';

import { invoiceLines, invoices } from '@/db/schema';
import { zonedToday } from '@/lib/dates';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { InvoiceFilter } from './schemas';
import type { CreditNoteRow, InvoiceDetail, InvoicePaymentRow, InvoiceRow } from './types';

const row = (today: string) => ({
  id: invoices.id,
  number: invoices.number,
  status: invoices.status,
  customerName: invoices.customerName,
  issueDate: invoices.issueDate,
  dueDate: invoices.dueDate,
  total: invoices.total,
  currency: invoices.currency,
  overdue: sql<boolean>`${invoices.status} = 'sent' and ${invoices.dueDate} < ${today}::date`,
  balance: sql<string>`case when ${invoices.status} in ('sent', 'paid')
    then app.invoice_balance(${invoices.tenantId}, ${invoices.id}) else ${invoices.total} end::text`,
});

export const INVOICE_PAGE_SIZE = 50;

/** Newest first, a page at a time, so an old unpaid invoice is never out of reach. */
export async function listInvoices(
  ctx: TenantContext,
  options: { filter?: InvoiceFilter; before?: number } = {},
): Promise<{ items: InvoiceRow[]; nextBefore: number | null }> {
  requirePermission(ctx, 'invoices.manage');
  const today = zonedToday(ctx.tenant.timezone);
  const filters: Record<InvoiceFilter, SQL | undefined> = {
    all: undefined,
    outstanding: eq(invoices.status, 'sent'),
    overdue: and(eq(invoices.status, 'sent'), sql`${invoices.dueDate} < ${today}::date`),
    draft: eq(invoices.status, 'draft'),
    closed: inArray(invoices.status, ['paid', 'void']),
  };
  const rows = await withRls(ctx, (tx) =>
    tx
      .select(row(today))
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, ctx.tenantId),
          filters[options.filter ?? 'all'],
          options.before ? lt(invoices.number, options.before) : undefined,
        ),
      )
      .orderBy(desc(invoices.number))
      .limit(INVOICE_PAGE_SIZE + 1),
  );
  const items = rows.slice(0, INVOICE_PAGE_SIZE);
  return {
    items,
    nextBefore: rows.length > INVOICE_PAGE_SIZE ? (items.at(-1)?.number ?? null) : null,
  };
}

/** Money still owed on sent invoices, and how much of it is overdue. Summed by the database. */
export async function getInvoiceTotals(
  ctx: TenantContext,
): Promise<{ outstanding: string; overdue: string; paid: string }> {
  requirePermission(ctx, 'invoices.manage');
  const today = zonedToday(ctx.tenant.timezone);
  const [totals] = await withRls(ctx, (tx) =>
    tx
      .select({
        outstanding: sql<string>`coalesce(sum(app.invoice_balance(${invoices.tenantId}, ${invoices.id})) filter (where ${invoices.status} = 'sent'), 0)::text`,
        overdue: sql<string>`coalesce(sum(app.invoice_balance(${invoices.tenantId}, ${invoices.id})) filter (where ${invoices.status} = 'sent' and ${invoices.dueDate} < ${today}::date), 0)::text`,
        paid: sql<string>`coalesce(sum(${invoices.total}) filter (where ${invoices.status} = 'paid'), 0)::text`,
      })
      .from(invoices)
      .where(eq(invoices.tenantId, ctx.tenantId)),
  );
  return totals ?? { outstanding: '0', overdue: '0', paid: '0' };
}

export async function getInvoice(ctx: TenantContext, id: string): Promise<InvoiceDetail | null> {
  requirePermission(ctx, 'invoices.manage');
  return withRls(ctx, async (tx) => {
    const [invoice] = await tx
      .select({
        ...row(zonedToday(ctx.tenant.timezone)),
        customerEmail: invoices.customerEmail,
        customerAddress: invoices.customerAddress,
        fromDetails: invoices.fromDetails,
        notes: invoices.notes,
        taxRate: invoices.taxRate,
        subtotal: invoices.subtotal,
        taxTotal: invoices.taxTotal,
        sentAt: invoices.sentAt,
        sentTo: invoices.sentTo,
        paidAt: invoices.paidAt,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.id, id)))
      .limit(1);
    if (!invoice) return null;
    const lines = await tx
      .select({
        id: invoiceLines.id,
        description: invoiceLines.description,
        quantity: invoiceLines.quantity,
        unitPrice: invoiceLines.unitPrice,
        lineTotal: invoiceLines.lineTotal,
      })
      .from(invoiceLines)
      .where(and(eq(invoiceLines.tenantId, ctx.tenantId), eq(invoiceLines.invoiceId, id)))
      .orderBy(asc(invoiceLines.position));
    const payments = (await tx.execute(sql`
      select p.id, p.date::text as date, a.amount::text as amount, p.amount::text as "paymentTotal",
             p.reference, p.payer_name as "payerName", p.voided_at is not null as voided,
             (select count(*)::int from invoice_payment_allocations o
              where o.tenant_id = p.tenant_id and o.payment_id = p.id and o.invoice_id <> ${id})
               as "otherInvoices"
      from invoice_payment_allocations a
      join invoice_payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
      where a.tenant_id = ${ctx.tenantId} and a.invoice_id = ${id}
      order by p.date, p.created_at`)) as unknown as InvoicePaymentRow[];
    const creditNotes = (await tx.execute(sql`
      select id, number, date::text as date, reason, subtotal::text as subtotal,
             tax_total::text as "taxTotal", total::text as total, voided_at is not null as voided
      from invoice_credit_notes
      where tenant_id = ${ctx.tenantId} and invoice_id = ${id}
      order by date, number`)) as unknown as CreditNoteRow[];
    return { ...invoice, lines, payments, creditNotes };
  });
}

/** The seller details used on the most recent invoice, to prefill the next one. */
export async function getLastFromDetails(ctx: TenantContext): Promise<string | null> {
  requirePermission(ctx, 'invoices.manage');
  const [last] = await withRls(ctx, (tx) =>
    tx
      .select({ fromDetails: invoices.fromDetails })
      .from(invoices)
      .where(and(eq(invoices.tenantId, ctx.tenantId), isNotNull(invoices.fromDetails)))
      .orderBy(desc(invoices.number))
      .limit(1),
  );
  return last?.fromDetails ?? null;
}

export type OutstandingInvoice = {
  id: string;
  number: number;
  customerName: string;
  dueDate: string;
  balance: string;
};

/** Every sent invoice with money still owed, oldest due first: what one payment can settle. */
export async function listOutstandingInvoices(ctx: TenantContext): Promise<OutstandingInvoice[]> {
  requirePermission(ctx, 'invoices.manage');
  return (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select id, number, customer_name as "customerName", due_date::text as "dueDate",
             app.invoice_balance(tenant_id, id)::text as balance
      from invoices
      where tenant_id = ${ctx.tenantId} and status = 'sent'
        and app.invoice_balance(tenant_id, id) > 0
      order by due_date, number
      limit 500`),
  )) as unknown as OutstandingInvoice[];
}
