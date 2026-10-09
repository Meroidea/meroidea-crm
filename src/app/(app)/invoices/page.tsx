import { FilePlus2, ReceiptText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { getInvoiceTotals, listInvoices } from '@/modules/invoices/queries';
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

export default async function InvoicesPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'invoices.manage');
  const [invoices, totals] = await Promise.all([listInvoices(ctx), getInvoiceTotals(ctx)]);
  const money = (value: string) => formatMoney(value, ctx.tenant.currency);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
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
      <dl className="grid grid-cols-3 gap-3">
        {[
          ['Outstanding', money(totals.outstanding)],
          ['Overdue', money(totals.overdue)],
          ['Paid', money(totals.paid)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <Card>
        <CardContent>
          {invoices.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="No invoices yet"
              description="Create one, check it, then email it to your customer or print it."
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
        </CardContent>
      </Card>
    </div>
  );
}
