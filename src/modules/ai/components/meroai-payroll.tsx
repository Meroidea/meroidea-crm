'use client';

import { CircleAlert, CircleCheck, Mail } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { MeroOrb } from '@/components/motion/mero-orb';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { formatHours } from '@/modules/roster/hours';
import { centsToAmount } from '@/modules/roster/rules';

import { runPayrollAction } from '../actions';
import type { PayrollPreview, RunPayrollResult } from '../meroai-payroll';

/**
 * "Run payroll with MeroAI" on the timesheets pay period (ADR-084). Once the manager is satisfied
 * with the authorised timesheets, MeroAI pays them: authorises the roster for pay from the
 * timesheets, drafts payslips, releases them and emails each person, after one confirmation that
 * shows what will be paid. It stops before releasing if any payslip's tax must be entered by hand.
 */
export function MeroAIPayroll({
  date,
  preview,
  currency,
}: {
  date: string;
  preview: PayrollPreview;
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [paymentDate, setPaymentDate] = useState(preview.defaults.paymentDate);
  const [superRate, setSuperRate] = useState(preview.defaults.superRate);
  const [result, setResult] = useState<RunPayrollResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = preview.blockers.length === 0;

  const run = () =>
    startTransition(async () => {
      setError(null);
      const response = await runPayrollAction({
        date,
        paymentDate,
        superRate,
        employerDetails: preview.defaults.employerDetails,
      });
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setOpen(false);
      setResult(response.data);
      router.refresh();
    });

  if (result) {
    return (
      <section
        role="status"
        className="meroai-edge meroai-surface flex flex-col gap-2 rounded-xl px-4 py-3 text-sm"
      >
        <p className="flex items-center gap-2 font-medium">
          {result.taxByHand.length ? (
            <CircleAlert aria-hidden className="size-4 text-warning-text" />
          ) : (
            <CircleCheck aria-hidden className="size-4 text-primary" />
          )}
          {result.taxByHand.length
            ? `Payroll authorised: ${result.created} payslips drafted. Enter tax for ${result.taxByHand.length} on the Payroll screen, then release them.`
            : `Payroll done: ${result.released} payslips released.`}
        </p>
        {result.released > 0 && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Mail aria-hidden className="size-4" />
            {result.emailConfigured
              ? `${result.emailed} of ${result.released} people emailed that their payslip is ready.`
              : 'Email is not set up, so nobody was emailed; staff see their payslip under My payslips.'}
          </p>
        )}
        {result.skipped.length > 0 && (
          <p className="text-muted-foreground">
            Not paid:{' '}
            {result.skipped.map((person) => `${person.name} (${person.reason})`).join('; ')}
          </p>
        )}
        <Button asChild variant="outline" className="self-start">
          <Link href={`/payroll/${result.rosterId}`}>Open the pay run</Link>
        </Button>
      </section>
    );
  }

  return (
    <section className="meroai-edge meroai-surface flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
      <MeroOrb size={32} state={pending ? 'thinking' : 'idle'} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          Run payroll with <span className="meroai-text">MeroAI</span>
        </p>
        {ready ? (
          <p className="text-muted-foreground">
            Pays the authorised timesheets: {preview.people} people,{' '}
            {formatHours(preview.authorisedMinutes)}
            {preview.costCents !== null &&
              `, about ${formatMoney(centsToAmount(preview.costCents), currency)}`}
            . Payslips are released and each person is emailed.
          </p>
        ) : (
          <ul className="text-warning-text">
            {preview.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
      </div>
      <Button className="meroai-button" disabled={!ready || pending} onClick={() => setOpen(true)}>
        Run payroll
      </Button>

      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Pay {formatCalendarDate(preview.from)} to {formatCalendarDate(preview.to)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              MeroAI will authorise this roster for pay from the authorised timesheets, draft each
              person’s payslip, release them and email everyone that their payslip is ready. Once
              paid, the period’s timesheets can no longer change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
            <dt className="text-muted-foreground">People</dt>
            <dd className="text-right tabular-nums">{preview.people}</dd>
            <dt className="text-muted-foreground">Authorised hours</dt>
            <dd className="text-right tabular-nums">{formatHours(preview.authorisedMinutes)}</dd>
            {preview.costCents !== null && (
              <>
                <dt className="text-muted-foreground">Estimated wages</dt>
                <dd className="text-right tabular-nums" data-sensitive>
                  {formatMoney(centsToAmount(preview.costCents), currency)}
                </dd>
              </>
            )}
            {preview.unpaidShifts > 0 && (
              <>
                <dt className="text-muted-foreground">Shifts with no time</dt>
                <dd className="text-right tabular-nums">{preview.unpaidShifts} (not paid)</dd>
              </>
            )}
          </dl>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Payment date</span>
              <Input
                type="date"
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Super (%)</span>
              <Input
                inputMode="decimal"
                value={superRate}
                onChange={(event) => setSuperRate(event.target.value)}
              />
            </label>
          </div>
          {!preview.emailConfigured && (
            <p className="text-xs text-muted-foreground">
              Email is not set up, so payslips are released without emails; staff find them under My
              payslips.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Not yet</AlertDialogCancel>
            <Button className="meroai-button" onClick={run} disabled={pending}>
              {pending ? 'MeroAI is running payroll…' : 'Pay and release payslips'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
