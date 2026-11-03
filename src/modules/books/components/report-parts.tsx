import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { formatAmount } from '../labels';
import type { ReportSection } from '../queries';

/** A plain GET form, so a report's dates live in its address and can be bookmarked or shared. */
export function DateRangeForm({
  from,
  to,
  single = false,
  compare,
  children,
}: {
  from?: string;
  to: string;
  single?: boolean;
  compare?: 'none' | 'previous';
  children?: ReactNode;
}) {
  return (
    <form
      method="get"
      className="no-print flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4"
    >
      {!single && (
        <label className="flex flex-col gap-1 text-sm">
          From
          <Input type="date" name="from" defaultValue={from} className="w-auto" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        {single ? 'As at' : 'To'}
        <Input type="date" name="to" defaultValue={to} className="w-auto" />
      </label>
      {compare !== undefined && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="compare"
            value="previous"
            defaultChecked={compare === 'previous'}
            className="size-4"
          />
          Compare with the period before
        </label>
      )}
      {children}
      <Button type="submit" size="sm">
        Show
      </Button>
    </form>
  );
}

/** Every amount links to the account's transactions for the same dates: the drill-down. */
export function SectionRows({
  section,
  currency,
  from,
  to,
  showCompare,
}: {
  section: ReportSection;
  currency: string;
  from: string;
  to: string;
  showCompare: boolean;
}) {
  if (section.lines.length === 0) return null;
  return (
    <tbody>
      <tr>
        <th colSpan={showCompare ? 3 : 2} className="pt-4 pb-1 text-left font-semibold">
          {section.label}
        </th>
      </tr>
      {section.lines.map((line) => (
        <tr key={line.accountId || line.name} className="border-b border-dashed">
          <td className="py-1.5 pr-3">
            {line.accountId ? (
              <Link
                href={`/books/accounts/${line.accountId}?from=${from}&to=${to}`}
                className="underline-offset-4 hover:underline"
              >
                <span className="text-muted-foreground tabular-nums">{line.code}</span> {line.name}
              </Link>
            ) : (
              line.name
            )}
          </td>
          <td className="py-1.5 text-right tabular-nums">{formatAmount(line.amount, currency)}</td>
          {showCompare && (
            <td className="py-1.5 text-right text-muted-foreground tabular-nums">
              {formatAmount(line.compare, currency)}
            </td>
          )}
        </tr>
      ))}
      <TotalRow
        label={`Total ${section.label.toLowerCase()}`}
        amount={section.total}
        compare={showCompare ? section.compare : undefined}
        currency={currency}
      />
    </tbody>
  );
}

export function TotalRow({
  label,
  amount,
  compare,
  currency,
  strong = false,
}: {
  label: string;
  amount: string;
  compare?: string | null;
  currency: string;
  strong?: boolean;
}) {
  return (
    <tr className={cn('border-b', strong && 'border-b-4 border-double text-base')}>
      <td className={cn('py-2 pr-3', strong ? 'font-semibold' : 'font-medium')}>{label}</td>
      <td className={cn('py-2 text-right tabular-nums', strong ? 'font-semibold' : 'font-medium')}>
        {formatAmount(amount, currency)}
      </td>
      {compare !== undefined && (
        <td className="py-2 text-right text-muted-foreground tabular-nums">
          {formatAmount(compare, currency)}
        </td>
      )}
    </tr>
  );
}

export function PayrollNote({ show }: { show: boolean }) {
  return show ? (
    <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
      Wages, tax withheld and super are left out: you do not have permission to see pay. Every entry
      left out balances, so the report still adds up.
    </p>
  ) : null;
}
