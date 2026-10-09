import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { PageHeader } from '@/components/data/page-header';
import { addDaysToDate, mondayOf, zonedToday } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getProductivity } from '@/modules/productivity/queries';
import { formatHours } from '@/modules/roster/hours';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Productivity' };

const paramsSchema = z.object({
  period: z.enum(['week', 'last-week', 'month']).optional().catch(undefined),
});

const hours = (minutes: number | null) => (minutes === null ? '—' : formatHours(minutes));
const count = (value: number | null) => (value === null ? '—' : String(value));

export default async function ProductivityPage({ searchParams }: PageProps<'/productivity'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'productivity.view');
  const period = paramsSchema.parse(await searchParams).period ?? 'week';
  const today = zonedToday(ctx.tenant.timezone);
  const thisMonday = mondayOf(today);
  const range =
    period === 'month'
      ? { from: `${today.slice(0, 8)}01`, to: today }
      : period === 'last-week'
        ? { from: addDaysToDate(thisMonday, -7), to: addDaysToDate(thisMonday, -1) }
        : { from: thisMonday, to: addDaysToDate(thisMonday, 6) };
  const rows = await getProductivity(ctx, range);

  const sum = (pick: (row: (typeof rows)[number]) => number | null) =>
    rows.some((row) => pick(row) !== null)
      ? rows.reduce((total, row) => total + (pick(row) ?? 0), 0)
      : null;
  const tiles = [
    ['Rostered', hours(sum((row) => row.rosteredMinutes))],
    ['Clocked', hours(sum((row) => row.clockedMinutes))],
    ['Logged on tasks', hours(sum((row) => row.projectMinutes))],
    ['Tasks finished', count(sum((row) => row.tasksCompleted))],
  ] as const;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Productivity"
        description={`${formatCalendarDate(range.from)} – ${formatCalendarDate(range.to)}. Hours planned, hours worked, and what got finished.`}
      />
      <nav aria-label="Period" className="flex gap-1">
        {(
          [
            ['week', 'This week'],
            ['last-week', 'Last week'],
            ['month', 'This month'],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={key === 'week' ? '/productivity' : `/productivity?period=${key}`}
            aria-current={period === key ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
              period === key && 'bg-accent font-medium text-foreground',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Person
              </th>
              {[
                'Rostered',
                'Clocked',
                'Clocked vs rostered',
                'On tasks',
                'Tasks finished',
                'On time',
                'Overdue now',
              ].map((heading) => (
                <th key={heading} scope="col" className="px-3 py-2.5 text-right font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const difference =
                row.rosteredMinutes !== null &&
                row.clockedMinutes !== null &&
                row.rosteredMinutes > 0
                  ? row.clockedMinutes - row.rosteredMinutes
                  : null;
              return (
                <tr key={row.userId}>
                  <th scope="row" className="px-4 py-2.5 text-left font-medium" data-sensitive>
                    {row.fullName}
                  </th>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {hours(row.rosteredMinutes)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {hours(row.clockedMinutes)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2.5 text-right tabular-nums',
                      difference !== null && difference < -30 && 'text-destructive-text',
                    )}
                  >
                    {difference === null
                      ? '—'
                      : `${difference >= 0 ? '+' : '−'}${formatHours(Math.abs(difference))}`}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {hours(row.projectMinutes)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {count(row.tasksCompleted)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {row.tasksWithDueDate ? `${row.tasksOnTime} of ${row.tasksWithDueDate}` : '—'}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2.5 text-right tabular-nums',
                      (row.tasksOverdue ?? 0) > 0 && 'font-medium text-destructive-text',
                    )}
                  >
                    {count(row.tasksOverdue)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Clocked hours leave out rejected timesheet entries. A dash means that kind of record is
        switched off for this business or you are not allowed to see everyone’s. These are records
        of time and finished work; they do not monitor what anyone does on their device.
      </p>
    </div>
  );
}
