import type { ReactNode } from 'react';

import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EMPLOYMENT_TYPE_LABELS, type EmploymentType } from '@/modules/hiring/compliance';
import type { PayslipLine } from '@/modules/payroll/lines';
import { formatWorked, type PayslipDetail } from '@/modules/payroll/types';

const hours = (minutes: number) => Number((minutes / 60).toFixed(2)).toString();

function Detail({
  label,
  children,
  sensitive,
}: {
  label: string;
  children: ReactNode;
  sensitive?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium" data-sensitive={sensitive ? true : undefined}>
        {children}
      </dd>
    </div>
  );
}

const headCell = 'px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase';
const numberCell = 'px-3 py-2 text-right tabular-nums';

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 text-xs font-semibold tracking-wider text-primary uppercase">{children}</h2>
  );
}

/** A payslip as the employee sees it; also what gets printed. */
export function PayslipDocument({
  payslip,
  printedOn,
  businessNumberLabel,
}: {
  payslip: PayslipDetail;
  /** Today's date in the business's timezone. */
  printedOn: string;
  /** What the business number is called where the business is: "ABN" in Australia. */
  businessNumberLabel: string;
}) {
  const money = (value: string) => formatMoney(value, payslip.currency);
  const { employer, yearToDate } = payslip;
  const businessName = employer?.name ?? payslip.employerDetails?.split('\n')[0] ?? 'Employer';

  // Payslips made before pay lines were kept show their one line: hours at the hourly rate.
  const lines: PayslipLine[] =
    payslip.lines.length > 0
      ? payslip.lines
      : [
          {
            title: 'Hours worked',
            kind: 'ordinary',
            minutes: payslip.minutes,
            units: null,
            rate: payslip.hourlyRate,
            multiplier: '1.00',
            amount: payslip.gross,
            superable: true,
            clause: null,
          },
        ];
  const minutesOf = (pick: (line: PayslipLine) => boolean) =>
    lines.filter(pick).reduce((sum, line) => sum + (line.minutes ?? 0), 0);
  const overtime = minutesOf((line) => line.kind === 'overtime');
  // A minimum payment tops pay up for time not worked, so it is not counted as hours.
  const worked = minutesOf((line) => line.kind !== 'minimum');
  const employment =
    payslip.employmentType && payslip.employmentType in EMPLOYMENT_TYPE_LABELS
      ? EMPLOYMENT_TYPE_LABELS[payslip.employmentType as EmploymentType]
      : null;
  // The rate ordinary hours were actually paid at, which is the award's when that is higher
  // than the agreed rate.
  const hourlyRate = lines.find((line) => line.kind === 'ordinary' && line.minutes)?.rate;
  const contact = [employer?.payrollContact, employer?.email, employer?.phone].filter(Boolean);

  return (
    <article className="overflow-hidden rounded-2xl border bg-card text-sm shadow-sm print:rounded-none print:border-0 print:text-[11.5px] print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b px-6 py-6 sm:px-10 print:py-2.5">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-2xl font-semibold text-primary-foreground [print-color-adjust:exact]"
          >
            {businessName.trim().charAt(0).toUpperCase()}
          </span>
          <div>
            <p className="text-xl font-semibold tracking-tight">{businessName}</p>
            {employer?.businessNumber && (
              <p className="mt-0.5 text-muted-foreground tabular-nums">
                {businessNumberLabel} {employer.businessNumber}
              </p>
            )}
          </div>
        </div>
        <address className="max-w-xs text-right text-muted-foreground not-italic">
          {employer ? (
            <>
              {employer.address && <p className="whitespace-pre-line">{employer.address}</p>}
              {employer.phone && <p>{employer.phone}</p>}
              {employer.email && <p>{employer.email}</p>}
              {employer.website && <p>{employer.website}</p>}
            </>
          ) : (
            <p className="whitespace-pre-line">
              {payslip.employerDetails?.split('\n').slice(1).join('\n')}
            </p>
          )}
        </address>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6 sm:px-10 print:pt-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payslip</h1>
          <p className="mt-1 text-muted-foreground">
            {formatCalendarDate(payslip.periodStart)} to {formatCalendarDate(payslip.periodEnd)}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-right">
          {(
            [
              ['Payment date', formatCalendarDate(payslip.paymentDate), false],
              ['Gross pay', money(payslip.gross), false],
              ['Net pay', money(payslip.net), true],
            ] as const
          ).map(([label, value, strong]) => (
            <div
              key={label}
              className={cn(
                'rounded-xl border px-4 py-2.5',
                strong &&
                  'border-primary bg-primary text-primary-foreground [print-color-adjust:exact]',
              )}
            >
              <dt className={cn('text-xs', strong ? 'opacity-85' : 'text-muted-foreground')}>
                {label}
              </dt>
              <dd className="text-base font-semibold tabular-nums" data-sensitive>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid gap-x-10 gap-y-4 px-6 py-6 sm:grid-cols-2 sm:px-10 print:grid-cols-2 print:py-2.5">
        <section>
          <SectionTitle>Employee</SectionTitle>
          <dl className="divide-y">
            <Detail label="Name" sensitive>
              {payslip.employeeName}
            </Detail>
            {payslip.employeeNumber !== null && (
              <Detail label="Employee ID">
                <span className="tabular-nums">{payslip.employeeNumber}</span>
              </Detail>
            )}
            <Detail label="Position">{payslip.positionTitle ?? '—'}</Detail>
            {payslip.classification && (
              <Detail label="Classification">{payslip.classification}</Detail>
            )}
            {employment && <Detail label="Employment">{employment}</Detail>}
          </dl>
        </section>
        <section>
          <SectionTitle>Pay details</SectionTitle>
          <dl className="divide-y">
            {payslip.number !== null && (
              <Detail label="Payslip number">
                <span className="tabular-nums">{payslip.number}</span>
              </Detail>
            )}
            <Detail label="Hourly rate" sensitive>
              <span className="tabular-nums">{money(hourlyRate ?? payslip.hourlyRate)}</span>
            </Detail>
            <Detail label="Super fund">{payslip.superFundName ?? 'Not recorded'}</Detail>
            <Detail label="Printed">{formatCalendarDate(printedOn)}</Detail>
          </dl>
        </section>
      </div>

      <section className="px-6 sm:px-10">
        <SectionTitle>Payments</SectionTitle>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[34rem]">
            <thead className="bg-muted/70 text-left [print-color-adjust:exact]">
              <tr>
                <th scope="col" className={headCell}>
                  Description
                </th>
                <th scope="col" className={cn(headCell, 'text-right')}>
                  Hours
                </th>
                <th scope="col" className={cn(headCell, 'text-right')}>
                  Rate
                </th>
                <th scope="col" className={cn(headCell, 'text-right')}>
                  Multiplier
                </th>
                <th scope="col" className={cn(headCell, 'text-right')}>
                  Amount
                </th>
                <th scope="col" className={cn(headCell, 'text-right')}>
                  Year to date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((line) => (
                <tr key={`${line.title}|${line.rate}`}>
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {line.title}
                  </th>
                  <td className={numberCell}>
                    {line.minutes !== null ? hours(line.minutes) : (line.units ?? '')}
                  </td>
                  <td className={numberCell} data-sensitive>
                    {money(line.rate)}
                  </td>
                  <td className={cn(numberCell, 'text-muted-foreground')}>
                    {line.multiplier ? `× ${Number(line.multiplier)}` : ''}
                  </td>
                  <td className={cn(numberCell, 'font-medium')} data-sensitive>
                    {money(line.amount)}
                  </td>
                  <td className={cn(numberCell, 'text-muted-foreground')} data-sensitive>
                    {money(yearToDate.byLine[line.title] ?? line.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40 [print-color-adjust:exact]">
              <tr className="font-semibold">
                <th scope="row" className="px-3 py-2.5 text-left">
                  Total payments
                </th>
                <td className={numberCell}>{hours(worked)}</td>
                <td colSpan={2} />
                <td className={numberCell} data-sensitive>
                  {money(payslip.gross)}
                </td>
                <td className={numberCell} data-sensitive>
                  {money(yearToDate.gross)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Basic hours {hours(worked - overtime)} · Additional hours {hours(overtime)} · Total hours{' '}
          {hours(worked)}
        </p>
      </section>

      <div className="grid gap-6 px-6 py-6 sm:grid-cols-2 sm:px-10 print:grid-cols-2 print:py-2.5">
        <section>
          <SectionTitle>Deductions</SectionTitle>
          <table className="w-full overflow-hidden rounded-xl border">
            <tbody className="divide-y">
              <tr>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  Tax withheld (PAYG)
                  <span className="block text-xs text-muted-foreground" data-sensitive>
                    {money(yearToDate.taxWithheld)} this year
                  </span>
                </th>
                <td className={cn(numberCell, 'font-medium')} data-sensitive>
                  {money(payslip.taxWithheld)}
                </td>
              </tr>
            </tbody>
            <tfoot className="border-t bg-muted/40 font-semibold [print-color-adjust:exact]">
              <tr>
                <th scope="row" className="px-3 py-2 text-left">
                  Total deductions
                </th>
                <td className={numberCell} data-sensitive>
                  {money(payslip.taxWithheld)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
        <section>
          <SectionTitle>Paid by your employer</SectionTitle>
          <table className="w-full overflow-hidden rounded-xl border">
            <tbody>
              <tr>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  Superannuation ({Number(payslip.superRate)}%)
                  <span className="block text-xs text-muted-foreground">
                    {payslip.superFundName ?? 'Fund not recorded'} ·{' '}
                    <span data-sensitive>{money(yearToDate.superAmount)} this year</span>
                  </span>
                </th>
                <td className={cn(numberCell, 'font-medium')} data-sensitive>
                  {money(payslip.superAmount)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Paid to your fund on top of your pay, on ordinary time earnings.
          </p>
        </section>
      </div>

      <div className="mx-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary px-5 py-4 text-primary-foreground [print-color-adjust:exact] sm:mx-10 print:py-2.5">
        <p className="text-base font-semibold">Net pay</p>
        <p className="text-2xl font-semibold tabular-nums" data-sensitive>
          {money(payslip.net)}
        </p>
      </div>

      <section className="px-6 py-6 sm:px-10 print:py-2.5">
        <SectionTitle>Year to date, from {formatCalendarDate(yearToDate.from)}</SectionTitle>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
          {(
            [
              ['Gross earnings', yearToDate.gross],
              ['Tax withheld', yearToDate.taxWithheld],
              ['Net earnings', yearToDate.net],
              ['Superannuation', yearToDate.superAmount],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl border px-4 py-3 print:py-1.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums" data-sensitive>
                {money(value)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-t px-6 py-6 sm:px-10 print:py-2">
        <SectionTitle>Time this pay covers</SectionTitle>
        <ul className="grid gap-x-10 gap-y-1 text-muted-foreground sm:grid-cols-2 print:grid-cols-2 print:gap-y-0.5">
          {payslip.shifts.map((shift, index) => (
            <li key={index} className="flex justify-between gap-3 tabular-nums">
              <span>
                {formatCalendarDate(shift.date)} · {shift.start} – {shift.end}
              </span>
              <span>{formatWorked(shift.minutes)}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t bg-muted/40 px-6 py-4 text-xs text-muted-foreground [print-color-adjust:exact] sm:px-10 print:py-2">
        {contact.length > 0 && <p>Questions about this payslip: {contact.join(' · ')}</p>}
        <p className={cn(contact.length > 0 && 'mt-1')}>
          Tax withheld is entered by your employer. Leave balances are not shown on this payslip.
        </p>
      </footer>
    </article>
  );
}
