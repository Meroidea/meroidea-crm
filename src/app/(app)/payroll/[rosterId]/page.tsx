import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { addDaysToDate } from '@/lib/dates';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import {
  AuthoriseForm,
  ReleaseButton,
  TaxWithheldInput,
} from '@/modules/payroll/components/payroll-tools';
import {
  getLastEmployerDetails,
  getPayRun,
  listPayslipsForRoster,
  listUnpaidPeople,
} from '@/modules/payroll/queries';
import { formatWorked } from '@/modules/payroll/types';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Pay run' };

export default async function PayRunPage({ params }: PageProps<'/payroll/[rosterId]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'payroll.manage');
  const parsed = z.object({ rosterId: z.uuid() }).safeParse(await params);
  const run = parsed.success ? await getPayRun(ctx, parsed.data.rosterId) : null;
  if (!run) notFound();
  const payslips = run.authorisedAt ? await listPayslipsForRoster(ctx, run.id) : [];
  const drafts = payslips.filter((payslip) => payslip.status === 'draft');
  const unpaid = run.authorisedAt ? await listUnpaidPeople(ctx, run.id) : [];
  const money = (value: string, currency: string) => formatMoney(value, currency);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div>
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/payroll" className="underline-offset-4 hover:underline">
            Payroll
          </Link>{' '}
          / Pay run
        </nav>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {formatCalendarDate(run.startsOn)} to {formatCalendarDate(run.endsOn)}
        </h1>
        <p className="mt-1 text-sm">
          <Link
            href={`/roster?date=${run.startsOn}`}
            className="text-primary underline underline-offset-4"
          >
            View the roster
          </Link>
        </p>
      </div>

      {unpaid.length > 0 && (
        <div className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text">
          <p className="font-medium">
            On the roster but not paid from it: <span data-sensitive>{unpaid.join(', ')}</span>
          </p>
          <p className="mt-1">
            A payslip needs an employee record linked to the person’s login, with an accepted hourly
            contract. Salaried staff are not paid from roster hours. Pay these people outside this
            pay run.
          </p>
        </div>
      )}

      {!run.authorisedAt ? (
        <AuthoriseForm
          rosterId={run.id}
          defaultPaymentDate={addDaysToDate(run.endsOn, 3)}
          defaultEmployerDetails={(await getLastEmployerDetails(ctx)) ?? ctx.tenant.name}
          canUseTimesheets={hasPermission(ctx, 'timesheets.manage')}
        />
      ) : payslips.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          This roster was authorised, but nobody on it could be paid from it. Each person needs an
          employee record linked to their login, with an accepted hourly contract.
        </p>
      ) : (
        <>
          <section className="overflow-hidden rounded-xl border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="px-4 py-2 font-medium">
                      Employee
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Hours
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Rate
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Gross
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Tax withheld
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Net
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Super
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payslips.map((payslip) => (
                    <tr key={payslip.id}>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/payslips/${payslip.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                          data-sensitive
                        >
                          {payslip.employeeName}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {payslip.status === 'released' ? 'Released' : 'Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatWorked(payslip.minutes)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {money(payslip.hourlyRate, payslip.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {money(payslip.gross, payslip.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {payslip.status === 'draft' ? (
                          <TaxWithheldInput
                            id={payslip.id}
                            value={payslip.taxWithheld}
                            employeeName={payslip.employeeName}
                          />
                        ) : (
                          money(payslip.taxWithheld, payslip.currency)
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {money(payslip.net, payslip.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {money(payslip.superAmount, payslip.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {drafts.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Enter the tax withheld for each person from your payroll or tax tables, then
                release.
              </p>
              <ReleaseButton rosterId={run.id} count={drafts.length} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              All payslips for this period have been released to staff.
            </p>
          )}
        </>
      )}
    </div>
  );
}
