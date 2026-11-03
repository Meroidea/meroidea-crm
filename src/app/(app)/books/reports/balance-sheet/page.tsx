import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PrintButton } from '@/components/data/print-button';
import { Card, CardContent } from '@/components/ui/card';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { ReportExport } from '@/modules/books/components/books-tools';
import {
  DateRangeForm,
  PayrollNote,
  SectionRows,
  TotalRow,
} from '@/modules/books/components/report-parts';
import { financialYearStart } from '@/modules/books/money';
import { balanceSheet, excludesPayroll, getBooksSettings } from '@/modules/books/queries';
import { reportParamsSchema } from '@/modules/books/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Balance Sheet' };

export default async function BalanceSheetPage({
  searchParams,
}: PageProps<'/books/reports/balance-sheet'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  const settings = await getBooksSettings(ctx);
  if (!settings) redirect('/books');
  const asAt = reportParamsSchema.parse(await searchParams).to ?? zonedToday(ctx.tenant.timezone);
  const sheet = await balanceSheet(ctx, asAt);
  const currency = ctx.tenant.currency;
  // Balance sheet accounts drill down to everything up to the day; links show the year so far.
  const from = financialYearStart(asAt, settings.financialYearStartMonth);
  const all = [...sheet.assets, ...sheet.liabilities, sheet.equity];

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <nav aria-label="Breadcrumb" className="no-print text-sm text-muted-foreground">
        <Link href="/books/reports" className="underline-offset-4 hover:underline">
          Reports
        </Link>{' '}
        / Balance Sheet
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Balance Sheet</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.tenant.name} · as at {formatCalendarDate(asAt)}
          </p>
        </div>
        <div className="no-print flex gap-2">
          <PrintButton />
          {hasPermission(ctx, 'books.export') && (
            <ReportExport
              report={{ report: 'balance-sheet', to: asAt }}
              fileName={`balance-sheet-${asAt}.csv`}
              rows={all.flatMap((section) =>
                section.lines.map((line) => ({
                  Section: section.label,
                  Code: line.code,
                  Account: line.name,
                  Amount: line.amount,
                })),
              )}
            />
          )}
        </div>
      </div>
      <DateRangeForm to={asAt} single />
      <PayrollNote show={excludesPayroll(ctx)} />
      {!sheet.balanced && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          The balance sheet does not balance. Please tell support: this should never happen.
        </p>
      )}
      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            {sheet.assets.map((section) => (
              <SectionRows
                key={section.key}
                section={section}
                currency={currency}
                from={from}
                to={asAt}
                showCompare={false}
              />
            ))}
            <tbody>
              <TotalRow
                label="Total assets"
                amount={sheet.totalAssets}
                currency={currency}
                strong
              />
            </tbody>
            {sheet.liabilities.map((section) => (
              <SectionRows
                key={section.key}
                section={section}
                currency={currency}
                from={from}
                to={asAt}
                showCompare={false}
              />
            ))}
            <tbody>
              <TotalRow
                label="Total liabilities"
                amount={sheet.totalLiabilities}
                currency={currency}
              />
              <TotalRow label="Net assets" amount={sheet.netAssets} currency={currency} strong />
            </tbody>
            <SectionRows
              section={sheet.equity}
              currency={currency}
              from={from}
              to={asAt}
              showCompare={false}
            />
            <tbody>
              <TotalRow
                label="Total equity"
                amount={sheet.totalEquity}
                currency={currency}
                strong
              />
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
