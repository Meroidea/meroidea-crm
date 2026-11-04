import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BookOpen, NotebookPen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { BooksNav } from '@/modules/books/components/books-nav';
import { PayPayslipForm, SetupBooksForm } from '@/modules/books/components/books-tools';
import { ENTRY_KIND_LABELS, formatAmount } from '@/modules/books/labels';
import { financialYearStart } from '@/modules/books/money';
import {
  booksOverview,
  getBooksSettings,
  listAccounts,
  listEntries,
  unpaidPayslips,
} from '@/modules/books/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Books' };

export default async function BooksPage({ searchParams }: PageProps<'/books'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  const settings = await getBooksSettings(ctx);
  const today = zonedToday(ctx.tenant.timezone);

  if (!settings) {
    return (
      <div className="flex w-full max-w-5xl flex-col gap-5">
        <PageHeader
          title="Books"
          description="A simple set of books underneath your invoices and payroll."
        />
        <Card>
          <CardContent className="flex flex-col gap-4">
            {hasPermission(ctx, 'books.manage') ? (
              <>
                <div className="space-y-1">
                  <h2 className="font-medium">Set up your books</h2>
                  <p className="text-sm text-muted-foreground">
                    You get a starting chart of accounts and GST codes for Australia, which you can
                    rename and add to. Invoices already sent and payslips already released from the
                    start date are brought in automatically.
                  </p>
                </div>
                <SetupBooksForm defaultStart={financialYearStart(today, 7)} />
              </>
            ) : (
              <EmptyState
                icon={BookOpen}
                title="The books are not set up yet"
                description="Ask the person who runs the business to set them up."
              />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const [overview, recent, unpaid, accounts] = await Promise.all([
    booksOverview(ctx),
    listEntries(ctx),
    unpaidPayslips(ctx),
    listAccounts(ctx),
  ]);
  const money = (value: string) => formatAmount(value, ctx.tenant.currency);
  const canRecord = hasPermission(ctx, 'books.record');
  const justSetUp = /^\d{1,6}$/.test(String((await searchParams).setup ?? ''))
    ? Number((await searchParams).setup)
    : null;
  const banks = accounts.filter((account) => account.isBank);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Books"
        description={
          settings.lockDate
            ? `Locked up to ${formatCalendarDate(settings.lockDate)}.`
            : 'Money in and out, what is owed, and how the business is doing.'
        }
      />
      <div className="flex flex-wrap gap-2">
        {canRecord && (
          <>
            <Button asChild size="sm">
              <Link href="/books/entries/new?kind=money_in">
                <ArrowDownLeft aria-hidden /> Money in
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/books/entries/new?kind=money_out">
                <ArrowUpRight aria-hidden /> Money out
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/books/entries/new?kind=transfer">
                <ArrowLeftRight aria-hidden /> Transfer
              </Link>
            </Button>
          </>
        )}
        {hasPermission(ctx, 'books.journal') && (
          <Button asChild size="sm" variant="outline">
            <Link href="/books/entries/new?kind=journal">
              <NotebookPen aria-hidden /> Journal
            </Link>
          </Button>
        )}
      </div>
      <BooksNav current="/books" />
      {justSetUp !== null && (
        <p role="status" className="rounded-md bg-primary/5 px-3 py-2 text-sm">
          Your books are set up. {justSetUp} {justSetUp === 1 ? 'entry was' : 'entries were'}{' '}
          brought in from invoices and payslips.
        </p>
      )}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {overview.banks.map((bank) => (
          <Tile
            key={bank.id}
            label={bank.name}
            value={money(bank.balance)}
            href={`/books/accounts/${bank.id}`}
          />
        ))}
        <Tile
          label="Owed to you"
          value={money(overview.receivable)}
          href="/books/reports/balance-sheet"
        />
        <Tile label="You owe suppliers" value={money(overview.payable)} href="/books/bills" />
        <Tile label="GST owing" value={money(overview.gst)} href="/books/reports/balance-sheet" />
        {hasPermission(ctx, 'books.view_payroll') && (
          <Tile
            label="Wages, PAYG and super owed"
            value={money(overview.payrollOwed)}
            href="/books/reports/balance-sheet"
          />
        )}
        <Tile
          label={`Profit since ${formatCalendarDate(overview.yearStart)}`}
          value={money(overview.profitThisYear)}
          href={`/books/reports/profit-and-loss?from=${overview.yearStart}&to=${overview.today}`}
        />
      </dl>

      {unpaid.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="space-y-1">
              <h2 className="font-medium">Net pay not yet recorded as paid</h2>
              <p className="text-sm text-muted-foreground">
                Released payslips owe the employee their net pay until it leaves the bank.
              </p>
            </div>
            <ul className="divide-y">
              {unpaid.map((payslip) => (
                <li
                  key={payslip.payslipId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <span>
                    <span className="font-medium" data-sensitive>
                      {payslip.employeeName}
                    </span>{' '}
                    <span className="text-sm text-muted-foreground">
                      paid {formatCalendarDate(payslip.date)} · {money(payslip.net)}
                    </span>
                  </span>
                  {canRecord && (
                    <PayPayslipForm
                      payslipId={payslip.payslipId}
                      today={today}
                      banks={banks.map((bank) => ({ ...bank }))}
                    />
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">Recent transactions</h2>
            <Link href="/books/entries" className="text-sm underline-offset-4 hover:underline">
              See all
            </Link>
          </div>
          {recent.items.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="Nothing recorded yet"
              description="Record money in or out, or send an invoice, and it appears here."
            />
          ) : (
            <ul className="divide-y">
              {recent.items.slice(0, 10).map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={`/books/entries/${entry.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-muted/50"
                  >
                    <span className="w-24 text-sm text-muted-foreground">
                      {formatCalendarDate(entry.date)}
                    </span>
                    <span className="min-w-0 flex-1 basis-48 truncate">{entry.description}</span>
                    <Badge variant="outline">{ENTRY_KIND_LABELS[entry.kind]}</Badge>
                    <span className="tabular-nums">{money(entry.total)}</span>
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

function Tile({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <div className="relative rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/40">
      <dt className="truncate text-xs text-muted-foreground">
        <Link href={href} className="after:absolute after:inset-0 after:rounded-xl">
          {label}
        </Link>
      </dt>
      <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}
