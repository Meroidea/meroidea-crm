import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PrintButton } from '@/components/data/print-button';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { InvoiceDocument } from '@/modules/invoices/components/invoice-document';
import { InvoiceActions, InvoiceEditor } from '@/modules/invoices/components/invoice-tools';
import { getInvoice } from '@/modules/invoices/queries';
import { invoiceIdSchema } from '@/modules/invoices/schemas';
import { invoiceNumber } from '@/modules/invoices/types';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Invoice' };

export default async function InvoicePage({ params, searchParams }: PageProps<'/invoices/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'invoices.manage');
  const parsed = invoiceIdSchema.safeParse(await params);
  const invoice = parsed.success ? await getInvoice(ctx, parsed.data.id) : null;
  if (!invoice) notFound();
  const editing = invoice.status === 'draft' && (await searchParams).edit === '1';
  const label = invoice.overdue
    ? 'Overdue'
    : { draft: 'Draft', sent: 'Sent', paid: 'Paid', void: 'Void' }[invoice.status];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="no-print">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/invoices" className="underline-offset-4 hover:underline">
            Invoices
          </Link>{' '}
          / {invoiceNumber(invoice.number)}
        </nav>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {invoiceNumber(invoice.number)}
            </h1>
            <Badge variant={invoice.overdue ? 'destructive' : 'outline'}>{label}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {invoice.status === 'draft' && !editing && (
              <Link
                href={`/invoices/${invoice.id}?edit=1`}
                className="inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted"
              >
                Edit draft
              </Link>
            )}
            <PrintButton />
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {invoice.status === 'draft' && 'Not sent yet. You can still change anything.'}
          {invoice.status === 'sent' &&
            `Sent ${formatDateTime(ctx, invoice.sentAt)}${invoice.sentTo ? ` to ${invoice.sentTo}` : ''}.`}
          {invoice.status === 'paid' && `Paid ${formatDateTime(ctx, invoice.paidAt)}.`}
          {invoice.status === 'void' && 'Void: kept on record, no longer owed.'}
        </p>
      </div>

      {editing ? (
        <InvoiceEditor
          invoice={invoice}
          currency={invoice.currency}
          defaults={{
            fromDetails: '',
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            taxRate: '0',
          }}
        />
      ) : (
        <>
          <InvoiceActions id={invoice.id} status={invoice.status} />
          <InvoiceDocument invoice={invoice} sellerName={ctx.tenant.name} />
        </>
      )}
    </div>
  );
}
