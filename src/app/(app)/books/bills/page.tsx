import { FilePlus2, Receipt } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { withParams } from '@/components/data/url';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { billNumber } from '@/modules/books/bills';
import { billTotals, listBills, type BillStatus } from '@/modules/books/bills-queries';
import { BooksNav } from '@/modules/books/components/books-nav';
import { formatAmount } from '@/modules/books/labels';
import { getBooksSettings } from '@/modules/books/queries';
import { BILL_FILTERS, billParamsSchema, type BillFilter } from '@/modules/books/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Bills' };

const FILTER_LABELS: Record<BillFilter, string> = {
  open: 'To pay',
  overdue: 'Overdue',
  paid: 'Paid',
  void: 'Void',
  all: 'All',
};

const STATUS: Record<
  BillStatus,
  { label: string; variant: 'default' | 'outline' | 'destructive' }
> = {
  open: { label: 'To pay', variant: 'outline' },
  overdue: { label: 'Overdue', variant: 'destructive' },
  paid: { label: 'Paid', variant: 'default' },
  void: { label: 'Void', variant: 'outline' },
};

export default async function BillsPage({ searchParams }: PageProps<'/books/bills'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  if (!(await getBooksSettings(ctx))) redirect('/books');
  const params = billParamsSchema.parse(await searchParams);
  const status = params.status ?? 'open';
  const [bills, totals] = await Promise.all([listBills(ctx, params), billTotals(ctx)]);
  const money = (value: string) => formatAmount(value, ctx.tenant.currency);
  const canRecord = hasPermission(ctx, 'books.record');

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <PageHeader title="Bills" description="What the business owes its suppliers." />
      {canRecord && (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/books/bills/new">
              <FilePlus2 aria-hidden /> Enter a bill
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/books/bills/pay">Pay bills</Link>
          </Button>
        </div>
      )}
      <BooksNav current="/books/bills" />
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">Owed to suppliers</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{money(totals.owed)}</dd>
        </div>
        <div className="rounded-xl border bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">Of that, overdue</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{money(totals.overdue)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Show bills" className="flex flex-wrap gap-1.5">
          {BILL_FILTERS.map((key) => (
            <Link
              key={key}
              href={withParams(
                '/books/bills',
                { q: params.q },
                { status: key === 'open' ? undefined : key },
              )}
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
        <form method="get" className="flex gap-2">
          {params.status && <input type="hidden" name="status" value={params.status} />}
          <Input
            name="q"
            defaultValue={params.q}
            placeholder="Supplier or reference"
            aria-label="Search bills"
            className="w-52"
          />
          <Button type="submit" size="sm" variant="outline">
            Search
          </Button>
        </form>
      </div>
      <Card>
        <CardContent>
          {bills.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No bills here"
              description="Enter a bill when one arrives from a supplier."
            />
          ) : (
            <ul className="divide-y">
              {bills.map((bill) => (
                <li key={bill.id}>
                  <Link
                    href={`/books/bills/${bill.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-muted/50"
                  >
                    <span className="w-24 font-medium tabular-nums">{billNumber(bill.number)}</span>
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate font-medium">{bill.supplierName}</span>
                      <span className="block text-sm text-muted-foreground">
                        {formatCalendarDate(bill.date)} · due {formatCalendarDate(bill.dueDate)}
                        {bill.supplierReference && ` · ${bill.supplierReference}`}
                      </span>
                    </span>
                    <span className="text-right tabular-nums">
                      {money(bill.total)}
                      {bill.status !== 'paid' &&
                        bill.status !== 'void' &&
                        bill.balance !== bill.total && (
                          <span className="block text-xs text-muted-foreground">
                            {money(bill.balance)} owed
                          </span>
                        )}
                    </span>
                    <Badge variant={STATUS[bill.status].variant}>{STATUS[bill.status].label}</Badge>
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
