'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { MeroOrb } from '@/components/motion/mero-orb';
import { Button } from '@/components/ui/button';
import { formatCalendarDate } from '@/lib/format';

import { authoriseRosterTimesheetsAction } from '../actions';
import type { RosterTimesheetResult } from '../meroai-payroll';

/**
 * "Authorise timesheets with MeroAI" on a published roster (ADR-084): every finished shift of the
 * period is authorised from the clock-in and clock-out, or the rostered times, with breaks by the
 * business's rules. Nothing is locked or paid: the manager checks them in Timesheets next.
 */
export function MeroAIRosterTimesheets({
  rosterId,
  startsOn,
}: {
  rosterId: string;
  startsOn: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RosterTimesheetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    startTransition(async () => {
      setError(null);
      const response = await authoriseRosterTimesheetsAction({ rosterId });
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setResult(response.data);
      router.refresh();
    });

  return (
    <section className="meroai-edge meroai-surface flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
      <MeroOrb size={32} state={pending ? 'thinking' : 'idle'} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          Authorise timesheets with <span className="meroai-text">MeroAI</span>
        </p>
        {result ? (
          <p className="text-muted-foreground" role="status">
            {result.authorised} timesheet{result.authorised === 1 ? '' : 's'} authorised for{' '}
            {formatCalendarDate(result.from)} to {formatCalendarDate(result.to)}
            {result.already ? `, ${result.already} already were` : ''}
            {result.needYou ? `, ${result.needYou} need you` : ''}. Check them in Timesheets, then
            run payroll from the pay period.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Uses each person’s clock-in and clock-out, or the rostered times when they did not
            clock, with breaks by your rules. Nothing is paid until you run payroll.
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive-text">
            {error}
          </p>
        )}
      </div>
      {result ? (
        <Button asChild variant="outline">
          <Link href={`/timesheets?view=period&date=${startsOn}`}>Review in Timesheets</Link>
        </Button>
      ) : (
        <Button className="meroai-button" onClick={run} disabled={pending}>
          {pending ? 'MeroAI is authorising…' : 'Authorise timesheets'}
        </Button>
      )}
    </section>
  );
}
