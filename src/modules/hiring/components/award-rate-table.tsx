import { formatCalendarDate, formatMoney } from '@/lib/format';
import type { AwardRateSchedule } from '@/modules/hiring/award-rates';

/**
 * The award's published rates for one classification and kind of employment, in the
 * Commission's own words and figures. Shown wherever a pay rate is set or checked.
 */
export function AwardRateTable({
  schedule,
  currency,
}: {
  schedule: AwardRateSchedule;
  currency: string;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Minimum for an ordinary hour:{' '}
        <span className="font-medium text-foreground tabular-nums">
          {schedule.minimumHourly
            ? `${formatMoney(schedule.minimumHourly, currency)} an hour`
            : 'not published'}
        </span>
        . {schedule.minimumBasis}
      </p>
      {schedule.groups.map((group) => (
        <table key={group.title} className="w-full overflow-hidden rounded-lg border text-left">
          <caption className="border-b bg-muted/60 px-3 py-1.5 text-left text-xs font-medium">
            {group.title}
          </caption>
          <tbody>
            {group.lines.map((line) => (
              <tr key={line.description} className="border-b last:border-b-0">
                <th scope="row" className="px-3 py-1.5 font-normal">
                  {line.description}
                </th>
                <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                  {line.percent ? `${line.percent}%` : ''}
                </td>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                  {formatMoney(line.hourly, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {schedule.allowances.length > 0 && (
        <table className="w-full overflow-hidden rounded-lg border text-left">
          <caption className="border-b bg-muted/60 px-3 py-1.5 text-left text-xs font-medium">
            Allowances under the award
          </caption>
          <tbody>
            {schedule.allowances.map((allowance) => (
              <tr key={allowance.name} className="border-b last:border-b-0">
                <th scope="row" className="px-3 py-1.5 font-normal">
                  {allowance.name}
                  {allowance.clause && (
                    <span className="text-muted-foreground"> (clause {allowance.clause})</span>
                  )}
                </th>
                <td className="px-3 py-1.5 text-right font-medium whitespace-nowrap tabular-nums">
                  {formatMoney(allowance.amount, currency)}
                  {allowance.frequency && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {allowance.frequency}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted-foreground">
        Fair Work Commission pay database
        {schedule.operativeFrom &&
          `, rates in force from ${formatCalendarDate(schedule.operativeFrom)}`}
        , read {formatCalendarDate(schedule.fetchedOn)}. Which rate applies to which hours, and when
        an allowance is owed, is set by the award itself.
      </p>
    </div>
  );
}
