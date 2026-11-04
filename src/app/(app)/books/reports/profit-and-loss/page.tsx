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
import { excludesPayroll, getBooksSettings, profitAndLoss } from '@/modules/books/queries';
import { reportParamsSchema } from '@/modules/books/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Profit and Loss' };

export default async function ProfitAndLossPage({
  searchParams,
}: PageProps<'/books/reports/profit-and-loss'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  const settings = await getBooksSettings(ctx);
  if (!settings) redirect('/books');
  const query = reportParamsSchema.parse(await searchParams);
  const to = query.to ?? zonedToday(ctx.tenant.timezone);
  const from = query.from ?? financialYearStart(to, settings.financialYearStartMonth);
  const compare = query.compare ?? 'none';
  const report = await profitAndLoss(ctx, from, to, compare);
  const currency = ctx.tenant.currency;
  const showCompare = compare === 'previous';
  const sections = [...report.income, report.costOfSales, ...report.expenses];

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <nav aria-label="Breadcrumb" className="no-print text-sm text-muted-foreground">
        <Link href="/books/reports" className="underline-offset-4 hover:underline">
          Reports
        </Link>{' '}
        / Profit and Loss
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profit and Loss</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.tenant.name} · {formatCalendarDate(from)} to {formatCalendarDate(to)} · accrual
            basis
          </p>
        </div>
        <div className="no-print flex gap-2">
          <PrintButton />
          {hasPermission(ctx, 'books.export') && (
            <ReportExport
              report={{ report: 'profit-and-loss', from, to }}
              fileName={`profit-and-loss-${from}-to-${to}.csv`}
              rows={sections.flatMap((section) =>
                section.lines.map((line) => ({
                  Section: section.label,
                  Code: line.code,
                  Account: line.name,
                  Amount: line.amount,
                  ...(showCompare ? { 'Previous period': line.compare } : {}),
                })),
              )}
            />
          )}
        </div>
      </div>
      <DateRangeForm from={from} to={to} compare={compare} />
      <PayrollNote show={excludesPayroll(ctx)} />
      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            {showCompare && (
              <thead>
                <tr className="text-right text-muted-foreground">
                  <th />
                  <th className="font-medium">This period</th>
                  <th className="font-medium">
                    {formatCalendarDate(report.compareFrom)} –{' '}
                    {formatCalendarDate(report.compareTo)}
                  </th>
                </tr>
              </thead>
            )}
            {report.income.map((section) => (
              <SectionRows
                key={section.key}
                section={section}
                currency={currency}
                from={from}
                to={to}
                showCompare={showCompare}
              />
            ))}
            <SectionRows
              section={report.costOfSales}
              currency={currency}
              from={from}
              to={to}
              showCompare={showCompare}
            />
            <tbody>
              <TotalRow
                label="Gross profit"
                amount={report.grossProfit.amount}
                compare={showCompare ? report.grossProfit.compare : undefined}
                currency={currency}
              />
            </tbody>
            {report.expenses.map((section) => (
              <SectionRows
                key={section.key}
                section={section}
                currency={currency}
                from={from}
                to={to}
                showCompare={showCompare}
              />
            ))}
            <tbody>
              <TotalRow
                label="Net profit"
                amount={report.netProfit.amount}
                compare={showCompare ? report.netProfit.compare : undefined}
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
