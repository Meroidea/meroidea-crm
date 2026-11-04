import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Card, CardContent } from '@/components/ui/card';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import {
  AccountForm,
  ArchiveAccountButton,
  ReportExport,
} from '@/modules/books/components/books-tools';
import { DateRangeForm, PayrollNote } from '@/modules/books/components/report-parts';
import { formatAmount } from '@/modules/books/labels';
import { financialYearStart } from '@/modules/books/money';
import { SUBTYPE_LABELS } from '@/modules/books/packs';
import {
  accountLedger,
  excludesPayroll,
  getBooksSettings,
  listTaxCodes,
} from '@/modules/books/queries';
import { reportParamsSchema } from '@/modules/books/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Account transactions' };

export default async function AccountPage({
  params,
  searchParams,
}: PageProps<'/books/accounts/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  if (!parsed.success) notFound();
  const settings = await getBooksSettings(ctx);
  const today = zonedToday(ctx.tenant.timezone);
  const query = reportParamsSchema.parse(await searchParams);
  const to = query.to ?? today;
  const from = query.from ?? financialYearStart(to, settings?.financialYearStartMonth ?? 7);
  const ledger = await accountLedger(ctx, parsed.data.id, from, to);
  if (!ledger) notFound();
  const { account } = ledger;
  const money = (value: string) => formatAmount(value, ctx.tenant.currency);
  const canManage = hasPermission(ctx, 'books.manage');
  const taxCodes = canManage ? await listTaxCodes(ctx) : [];

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <nav aria-label="Breadcrumb" className="no-print text-sm text-muted-foreground">
        <Link href="/books/accounts" className="underline-offset-4 hover:underline">
          Chart of accounts
        </Link>{' '}
        / {account.code}
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="text-muted-foreground tabular-nums">{account.code}</span>{' '}
            {account.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {SUBTYPE_LABELS[account.subtype]} · {formatCalendarDate(from)} to{' '}
            {formatCalendarDate(to)}
          </p>
        </div>
        {hasPermission(ctx, 'books.export') && (
          <ReportExport
            report={{ report: 'account', from, to, accountId: account.id }}
            fileName={`${account.code}-${account.name}-${from}-to-${to}.csv`}
            rows={ledger.rows.map((row) => ({
              Date: row.date,
              Entry: row.number,
              Description: row.lineDescription
                ? `${row.description} — ${row.lineDescription}`
                : row.description,
              Reference: row.reference,
              Debit: row.debit,
              Credit: row.credit,
              Balance: row.balance,
            }))}
          />
        )}
      </div>
      <DateRangeForm from={from} to={to} />
      <PayrollNote show={excludesPayroll(ctx)} />
      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Description</th>
                <th className="py-2 text-right font-medium">Debit</th>
                <th className="py-2 text-right font-medium">Credit</th>
                <th className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="py-2 pr-3" colSpan={4}>
                  Opening balance
                </td>
                <td className="py-2 text-right tabular-nums">{money(ledger.opening)}</td>
              </tr>
              {ledger.rows.map((row, index) => (
                <tr key={`${row.entryId}-${index}`} className="border-b border-dashed">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatCalendarDate(row.date)}</td>
                  <td className="py-2 pr-3">
                    <Link
                      href={`/books/entries/${row.entryId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {row.description}
                    </Link>
                    {row.lineDescription && (
                      <span className="block text-muted-foreground">{row.lineDescription}</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(row.debit) > 0 ? money(row.debit) : ''}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(row.credit) > 0 ? money(row.credit) : ''}
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(row.balance)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-2 pr-3" colSpan={4}>
                  Closing balance
                </td>
                <td className="py-2 text-right tabular-nums">{money(ledger.closing)}</td>
              </tr>
            </tbody>
          </table>
          {ledger.truncated && (
            <p className="pt-2 text-sm text-muted-foreground">
              Showing the first 1,000 lines. Choose shorter dates to see the rest.
            </p>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card className="no-print">
          <CardContent className="flex flex-col gap-4">
            <h2 className="font-medium">Account details</h2>
            <AccountForm
              account={{
                id: account.id,
                code: account.code,
                name: account.name,
                type: account.type,
                subtype: account.subtype,
                isBank: account.isBank,
                defaultTaxCodeId: account.defaultTaxCodeId ?? '',
                description: account.description ?? '',
              }}
              taxCodes={taxCodes.map(({ id, code, name, rate, appliesTo }) => ({
                id,
                code,
                name,
                rate,
                appliesTo,
              }))}
            />
            {account.systemKey ? (
              <p className="text-sm text-muted-foreground">
                The books rely on this account, so it can be renamed but not archived.
              </p>
            ) : (
              <ArchiveAccountButton id={account.id} archived={account.archived} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
