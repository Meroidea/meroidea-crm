import { formatCalendarDate, formatMoney } from '@/lib/format';
import { formatWorked, type PayslipDetail } from '@/modules/payroll/types';

/** A payslip as the employee sees it; also what gets printed. */
export function PayslipDocument({ payslip }: { payslip: PayslipDetail }) {
  const money = (value: string) => formatMoney(value, payslip.currency);
  return (
    <article className="rounded-xl border bg-card p-6 sm:p-10 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-2xl font-semibold tracking-tight">Payslip</p>
          <p className="mt-1 text-muted-foreground">
            {formatCalendarDate(payslip.periodStart)} to {formatCalendarDate(payslip.periodEnd)}
          </p>
        </div>
        <p className="max-w-xs text-right text-sm whitespace-pre-line">
          {payslip.employerDetails ?? ''}
        </p>
      </header>

      <dl className="mt-8 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        {[
          ['Employee', payslip.employeeName],
          ['Position', payslip.positionTitle ?? '—'],
          ['Payment date', formatCalendarDate(payslip.paymentDate)],
          ['Hourly rate', money(payslip.hourlyRate)],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium" data-sensitive>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <table className="mt-8 w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="py-2 font-medium">
              Shift
            </th>
            <th scope="col" className="py-2 font-medium">
              Time
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Worked
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {payslip.shifts.map((shift, index) => (
            <tr key={index}>
              <td className="py-2">{formatCalendarDate(shift.date)}</td>
              <td className="py-2 tabular-nums">
                {shift.start} – {shift.end}
              </td>
              <td className="py-2 text-right tabular-nums">{formatWorked(shift.minutes)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <td colSpan={2} className="py-2">
              Total hours
            </td>
            <td className="py-2 text-right tabular-nums">{formatWorked(payslip.minutes)}</td>
          </tr>
        </tfoot>
      </table>

      <dl className="mt-6 ml-auto grid w-full max-w-sm grid-cols-2 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Gross pay</dt>
        <dd className="text-right tabular-nums">{money(payslip.gross)}</dd>
        <dt className="text-muted-foreground">Tax withheld</dt>
        <dd className="text-right tabular-nums">−{money(payslip.taxWithheld)}</dd>
        <dt className="border-t pt-2 font-semibold">Net pay</dt>
        <dd className="border-t pt-2 text-right text-lg font-semibold tabular-nums">
          {money(payslip.net)}
        </dd>
        <dt className="pt-3 text-muted-foreground">
          Super ({Number(payslip.superRate)}%)
          {payslip.superFundName && <span className="block text-xs">{payslip.superFundName}</span>}
        </dt>
        <dd className="pt-3 text-right tabular-nums">{money(payslip.superAmount)}</dd>
      </dl>
      <p className="mt-8 text-xs text-muted-foreground">
        Super is paid to your fund on top of your pay. Gross pay is hours worked at your hourly
        rate.
      </p>
    </article>
  );
}
