import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { BooksNav } from '@/modules/books/components/books-nav';
import { getBooksSettings } from '@/modules/books/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Financial reports' };

const REPORTS = [
  {
    href: '/books/reports/profit-and-loss',
    title: 'Profit and Loss',
    description: 'Income, cost of sales and expenses, and the profit left, for any period.',
  },
  {
    href: '/books/reports/balance-sheet',
    title: 'Balance Sheet',
    description: 'What the business owns and owes on a day, and the owner’s equity.',
  },
  {
    href: '/books/reports/trial-balance',
    title: 'Trial Balance',
    description: 'Every account’s debit or credit balance. The totals always agree.',
  },
  {
    href: '/books/accounts',
    title: 'General ledger',
    description: 'Open any account to see its transactions with a running balance.',
  },
];

export default async function ReportsPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  if (!(await getBooksSettings(ctx))) redirect('/books');
  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Financial reports"
        description="Every number links to the transactions behind it."
      />
      <BooksNav current="/books/reports" />
      <div className="grid gap-3 sm:grid-cols-2">
        {REPORTS.map((report) => (
          <Card key={report.href} className="relative transition-colors hover:border-primary/40">
            <CardContent className="space-y-1">
              <h2 className="font-medium">
                <Link href={report.href} className="after:absolute after:inset-0">
                  {report.title}
                </Link>
              </h2>
              <p className="text-sm text-muted-foreground">{report.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
