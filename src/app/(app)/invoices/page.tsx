import { FilePlus2, ReceiptText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { ListPagination } from '@/components/data/list-pagination';
import { PageHeader } from '@/components/data/page-header';
import { withParams } from '@/components/data/url';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getInvoiceTotals, listInvoices } from '@/modules/invoices/queries';
import { invoiceParamsSchema, type InvoiceFilter } from '@/modules/invoices/schemas';
import { invoiceNumber, type InvoiceRow } from '@/modules/invoices/types';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Invoices' };

function StatusBadge({ invoice }: { invoice: InvoiceRow }) {
  if (invoice.overdue) {
    return <Badge variant="destructive">Overdue</Badge>;
  }
  const label = { draft: 'Draft', sent: 'Sent', paid: 'Paid', void: 'Void' }[invoice.status];
  return <Badge variant={invoice.status === 'paid' ? 'default' : 'outline'}>{label}</Badge>;
}

const FILTER_LABELS: Record<InvoiceFilter, string> = {
  all: 'All',
  outstanding: 'Outstanding',
  overdue: 'Overdue',
  draft: 'Drafts',
  closed: 'Paid or void',
};

const EMPTY: Record<InvoiceFilter, string> = {
  all: 'Create one, check it, then email it to your customer or print it.',
  outstanding: 'Nothing is owed on a sent invoice.',
  overdue: 'No sent invoice is past its due date.',
  draft: 'Every invoice has been sent.',
  closed: 'No invoice has been paid or voided yet.',
};

export default async function InvoicesPage({ searchParams }: PageProps<'/invoices'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'invoices.manage');
  const params = invoiceParamsSchema.parse(await searchParams);
  const status = params.status ?? 'all';
  const [{ items: invoices, nextBefore }, totals] = await Promise.all([
    listInvoices(ctx, { filter: status, before: params.cursor }),
    getInvoiceTotals(ctx),
  ]);
  const money = (value: string) => formatMoney(value, ctx.tenant.currency);
  const filters = {
    status: status === 'all' ? undefined : status,
    cursor: params.cursor ? String(params.cursor) : undefined,
  };

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Invoices"
        description="Bill your customers and keep track of what is owed."
        actions={
          <Button asChild>
            <Link href="/invoices/new">
              <FilePlus2 aria-hidden /> New invoice
            </Link>
          </Button>
        }
      />
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(
          [
            ['Outstanding', money(totals.outstanding), 'outstanding'],
            ['Overdue', money(totals.overdue), 'overdue'],
            ['Paid', money(totals.paid), 'closed'],
          ] as const
        ).map(([label, value, filter]) => (
          <div
            key={label}
            className="relative rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/40"
          >
            <dt className="text-xs text-muted-foreground">
              {/* The whole tile opens the matching list. */}
              <Link
                href={withParams('/invoices', {}, { status: filter })}
                className="after:absolute after:inset-0 after:rounded-xl"
              >
                {label}
              </Link>
            </dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <nav aria-label="Show invoices" className="flex flex-wrap gap-1.5">
        {(Object.keys(FILTER_LABELS) as InvoiceFilter[]).map((key) => (
          <Link
            key={key}
            href={withParams('/invoices', {}, { status: key === 'all' ? undefined : key })}
            aria-current={status === key ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-xs text-muted-foreground hover:text-foreground',
              status === key && 'border-primary bg-primary/5 font-medium text-foreground',
            )}
          >
            {FILTER_LABELS[key]}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent>
          {invoices.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title={
                status === 'all'
                  ? 'No invoices yet'
                  : `No ${FILTER_LABELS[status].toLowerCase()} invoices`
              }
              description={EMPTY[status]}
            />
          ) : (
            <ul className="divide-y">
              {invoices.map((invoice) => (
                <li key={invoice.id}>
                  <Link
                    href={`/invoices/${invoice.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="w-24 font-medium tabular-nums">
                      {invoiceNumber(invoice.number)}
                    </span>
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate font-medium" data-sensitive>
                        {invoice.customerName}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {formatCalendarDate(invoice.issueDate)} · due{' '}
                        {formatCalendarDate(invoice.dueDate)}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(invoice.total, invoice.currency)}
                    </span>
                    <StatusBadge invoice={invoice} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <ListPagination
            pathname="/invoices"
            filters={filters}
            nextCursor={nextBefore ? String(nextBefore) : null}
            shown={invoices.length}
          />
        </CardContent>
      </Card>
    </div>
  );
}
