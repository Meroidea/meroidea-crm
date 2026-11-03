import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PrintButton } from '@/components/data/print-button';
import { Card, CardContent } from '@/components/ui/card';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { ReportExport } from '@/modules/books/components/books-tools';
import { DateRangeForm, PayrollNote } from '@/modules/books/components/report-parts';
import { formatAmount } from '@/modules/books/labels';
import { financialYearStart } from '@/modules/books/money';
import { excludesPayroll, getBooksSettings, trialBalance } from '@/modules/books/queries';
import { reportParamsSchema } from '@/modules/books/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Trial Balance' };

export default async function TrialBalancePage({
  searchParams,
}: PageProps<'/books/reports/trial-balance'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  const settings = await getBooksSettings(ctx);
  if (!settings) redirect('/books');
  const asAt = reportParamsSchema.parse(await searchParams).to ?? zonedToday(ctx.tenant.timezone);
  const report = await trialBalance(ctx, asAt);
  const money = (value: string) => formatAmount(value, ctx.tenant.currency);
  const from = financialYearStart(asAt, settings.financialYearStartMonth);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <nav aria-label="Breadcrumb" className="no-print text-sm text-muted-foreground">
        <Link href="/books/reports" className="underline-offset-4 hover:underline">
          Reports
        </Link>{' '}
        / Trial Balance
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trial Balance</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.tenant.name} · as at {formatCalendarDate(asAt)}. Income and expenses from{' '}
            {formatCalendarDate(from)}; earlier years sit in retained earnings.
          </p>
        </div>
        <div className="no-print flex gap-2">
          <PrintButton />
          {hasPermission(ctx, 'books.export') && (
            <ReportExport
              report={{ report: 'trial-balance', to: asAt }}
              fileName={`trial-balance-${asAt}.csv`}
              rows={report.rows.map((row) => ({
                Code: row.code,
                Account: row.name,
                Debit: row.debit,
                Credit: row.credit,
              }))}
            />
          )}
        </div>
      </div>
      <DateRangeForm to={asAt} single />
      <PayrollNote show={excludesPayroll(ctx)} />
      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Account</th>
                <th className="py-2 text-right font-medium">Debit</th>
                <th className="py-2 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.accountId ?? row.code} className="border-b border-dashed">
                  <td className="py-1.5 pr-3">
                    <Link
                      href={`/books/accounts/${row.accountId}?to=${asAt}`}
                      className="underline-offset-4 hover:underline"
                    >
                      <span className="text-muted-foreground tabular-nums">{row.code}</span>{' '}
                      {row.name}
                    </Link>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {Number(row.debit) > 0 ? money(row.debit) : ''}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {Number(row.credit) > 0 ? money(row.credit) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-4 border-double font-semibold">
                <td className="py-2 pr-3">Totals</td>
                <td className="py-2 text-right tabular-nums">{money(report.totalDebit)}</td>
                <td className="py-2 text-right tabular-nums">{money(report.totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
