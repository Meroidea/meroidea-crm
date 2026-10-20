import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm';

import { invoiceLines, invoices } from '@/db/schema';
import { zonedToday } from '@/lib/dates';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { InvoiceFilter } from './schemas';
import type { InvoiceDetail, InvoiceRow } from './types';

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
        outstanding: sql<string>`coalesce(sum(${invoices.total}) filter (where ${invoices.status} = 'sent'), 0)::text`,
        overdue: sql<string>`coalesce(sum(${invoices.total}) filter (where ${invoices.status} = 'sent' and ${invoices.dueDate} < ${today}::date), 0)::text`,
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
    return { ...invoice, lines };
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
