import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatCalendarDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { VoidEntryButton } from '@/modules/books/components/books-tools';
import { ENTRY_KIND_LABELS, formatAmount } from '@/modules/books/labels';
import { getEntry } from '@/modules/books/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Transaction' };

const MANUAL = new Set(['money_in', 'money_out', 'transfer', 'journal', 'opening_balance']);

/** Plain words for one line: which way the money went for this kind of account. */
function plainLine(type: string, debit: string): string {
  const up = Number(debit) > 0 === (type === 'asset' || type === 'expense');
  switch (type) {
    case 'asset':
      return up ? 'Increases what you hold' : 'Decreases what you hold';
    case 'liability':
      return up ? 'Increases what you owe' : 'Decreases what you owe';
    case 'equity':
      return up ? 'Adds to the owner’s stake' : 'Reduces the owner’s stake';
    case 'income':
      return up ? 'Income' : 'Reduces income';
    default:
      return up ? 'Expense' : 'Reduces expenses';
  }
}

export default async function EntryPage({
  params,
  searchParams,
}: PageProps<'/books/entries/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const entry = parsed.success ? await getEntry(ctx, parsed.data.id) : null;
  if (!entry) notFound();
  const accountant = (await searchParams).view === 'accountant';
  const money = (value: string) => formatAmount(value, ctx.tenant.currency);
  const canVoid =
    MANUAL.has(entry.kind) &&
    !entry.reversedBy &&
    hasPermission(
      ctx,
      entry.kind === 'journal'
        ? 'books.journal'
        : entry.kind === 'opening_balance'
          ? 'books.manage'
          : 'books.record',
    );
  const source =
    entry.sourceType === 'invoice' && entry.sourceId && hasPermission(ctx, 'invoices.manage')
      ? { href: `/invoices/${entry.sourceId}`, label: `Open invoice ${entry.reference ?? ''}` }
      : entry.sourceType === 'payslip' && entry.sourceId && hasPermission(ctx, 'payroll.manage')
        ? { href: `/payslips/${entry.sourceId}`, label: 'Open payslip' }
        : null;

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/books/entries" className="underline-offset-4 hover:underline">
          Transactions
        </Link>{' '}
        / #{entry.number}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{entry.description}</h1>
            <Badge variant="outline">{ENTRY_KIND_LABELS[entry.kind]}</Badge>
            {entry.isAdjustment && <Badge variant="outline">Adjusting journal</Badge>}
            {entry.reversedBy && <Badge variant="destructive">Voided</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            #{entry.number} · {formatCalendarDate(entry.date)}
            {entry.contactName && <> · {entry.contactName}</>}
            {entry.reference && <> · Ref {entry.reference}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/books/entries/${entry.id}${accountant ? '' : '?view=accountant'}`}
            className="rounded-lg border px-3 py-1.5 hover:bg-muted"
          >
            {accountant ? 'Plain view' : 'Accountant view'}
          </Link>
          {source && (
            <Link href={source.href} className="rounded-lg border px-3 py-1.5 hover:bg-muted">
              {source.label}
            </Link>
          )}
        </div>
      </div>

      {entry.reverses && (
        <p className="text-sm">
          This reverses{' '}
          <Link
            href={`/books/entries/${entry.reverses.id}`}
            className="underline underline-offset-4"
          >
            entry #{entry.reverses.number}
          </Link>
          .
        </p>
      )}
      {entry.reversedBy && (
        <p className="text-sm">
          Voided by{' '}
          <Link
            href={`/books/entries/${entry.reversedBy.id}`}
            className="underline underline-offset-4"
          >
            entry #{entry.reversedBy.number}
          </Link>
          , which posts the opposite.
        </p>
      )}

      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Account</th>
                <th className="py-2 pr-3 font-medium">{accountant ? 'Note' : 'Effect'}</th>
                {accountant ? (
                  <>
                    <th className="py-2 pr-3 font-medium">Tax</th>
                    <th className="py-2 text-right font-medium">Debit</th>
                    <th className="py-2 text-right font-medium">Credit</th>
                  </>
                ) : (
                  <th className="py-2 text-right font-medium">Amount</th>
                )}
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line, index) => (
                <tr key={index} className="border-b border-dashed">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/books/accounts/${line.accountId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {accountant && (
                        <span className="text-muted-foreground tabular-nums">
                          {line.accountCode}{' '}
                        </span>
                      )}
                      {line.accountName}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {accountant ? line.description : plainLine(line.accountType, line.debit)}
                  </td>
                  {accountant ? (
                    <>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {line.taxCode
                          ? `${line.taxCode}${line.taxAmount ? ` (${money(line.taxAmount)})` : ''}`
                          : ''}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {Number(line.debit) > 0 ? money(line.debit) : ''}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {Number(line.credit) > 0 ? money(line.credit) : ''}
                      </td>
                    </>
                  ) : (
                    <td className={cn('py-2 text-right tabular-nums')}>
                      {money(Number(line.debit) > 0 ? line.debit : line.credit)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {accountant && (
              <tfoot>
                <tr>
                  <td colSpan={3} className="py-2 font-medium">
                    Totals
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">{money(entry.total)}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{money(entry.total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Recorded {formatDateTime(ctx, entry.createdAt)}
        {entry.createdByName ? ` by ${entry.createdByName}` : ''}. Entries are never edited: a
        mistake is corrected by voiding, which posts a reversal.
      </p>
      {canVoid && (
        <div className="no-print">
          <VoidEntryButton id={entry.id} />
        </div>
      )}
      {!MANUAL.has(entry.kind) && entry.kind !== 'reversal' && (
        <p className="text-sm text-muted-foreground">
          This entry came from {entry.sourceType === 'invoice' ? 'an invoice' : 'payroll'}. To
          change it, change{' '}
          {entry.sourceType === 'invoice' ? 'the invoice (void it)' : 'the payslip'}.
        </p>
      )}
    </div>
  );
}
