'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { saveTradingHoursAction } from '../actions';
import { tradingWeekSchema, type TradingWeekValues } from '../schemas';
import { WEEK_ORDER, WEEKDAY_NAMES, type TradingDay } from '../types';

/** Saved days as the form's values: every weekday, with empty times when closed. */
export function toTradingWeekValues(days: TradingDay[]): TradingWeekValues {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const day = days.find((item) => item.weekday === weekday);
    return {
      weekday,
      open: Boolean(day?.opensAt),
      opensAt: day?.opensAt ?? '',
      closesAt: day?.closesAt ?? '',
      staffNeeded: day?.staffNeeded ?? 1,
    };
  });
}

type DayErrors = Record<number, string | undefined>;

/**
 * Checks the week with the same schema the server uses, before sending it, so each problem
 * shows on its own day's row (the server's errors only name the whole field).
 */
export function checkTradingWeek(
  value: TradingWeekValues,
): { ok: true } | { ok: false; errors: DayErrors; message: string } {
  const parsed = tradingWeekSchema.safeParse(value);
  if (parsed.success) return { ok: true };
  const errors: DayErrors = {};
  for (const issue of parsed.error.issues) {
    const index = issue.path[0];
    if (typeof index === 'number' && errors[index] === undefined) errors[index] = issue.message;
  }
  return { ok: false, errors, message: 'Check the trading hours.' };
}

/**
 * The seven days as rows: open or closed, the hours, and how many people should be on. A
 * closing time at or before the opening time means the business trades past midnight.
 */
export function TradingWeekFields({
  value,
  onChange,
  errors = {},
  disabled = false,
}: {
  value: TradingWeekValues;
  onChange: (next: TradingWeekValues) => void;
  errors?: DayErrors;
  disabled?: boolean;
}) {
  const update = (weekday: number, patch: Partial<TradingWeekValues[number]>) =>
    onChange(value.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)));

  return (
    <div className="flex flex-col divide-y rounded-lg border">
      <div className="hidden grid-cols-[7rem_5rem_1fr_6rem] gap-3 px-3 py-2 text-xs text-muted-foreground sm:grid">
        <span>Day</span>
        <span>Open</span>
        <span>Hours</span>
        <span>Staff on</span>
      </div>
      {WEEK_ORDER.map((weekday) => {
        const day = value.find((item) => item.weekday === weekday)!;
        const name = WEEKDAY_NAMES[weekday];
        const error = errors[value.indexOf(day)];
        return (
          <div key={weekday} className="flex flex-col gap-1.5 px-3 py-2.5">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[7rem_5rem_1fr_6rem]">
              <span className="text-sm font-medium">{name}</span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={day.open}
                  disabled={disabled}
                  onChange={(event) =>
                    update(weekday, {
                      open: event.target.checked,
                      opensAt: event.target.checked && !day.opensAt ? '09:00' : day.opensAt,
                      closesAt: event.target.checked && !day.closesAt ? '17:00' : day.closesAt,
                    })
                  }
                  aria-label={`Open on ${name}`}
                />
                <span className={cn(!day.open && 'text-muted-foreground')}>
                  {day.open ? 'Open' : 'Closed'}
                </span>
              </label>
              <div
                className={cn(
                  'col-span-2 flex items-center gap-2 sm:col-span-1',
                  !day.open && 'invisible',
                )}
              >
                <Input
                  type="time"
                  value={day.opensAt}
                  disabled={disabled || !day.open}
                  onChange={(event) => update(weekday, { opensAt: event.target.value })}
                  aria-label={`${name} opens at`}
                  className="w-full sm:w-32"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={day.closesAt}
                  disabled={disabled || !day.open}
                  onChange={(event) => update(weekday, { closesAt: event.target.value })}
                  aria-label={`${name} closes at`}
                  className="w-full sm:w-32"
                />
              </div>
              <div className={cn('col-span-2 sm:col-span-1', !day.open && 'invisible')}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  value={String(day.staffNeeded)}
                  disabled={disabled || !day.open}
                  onChange={(event) =>
                    update(weekday, { staffNeeded: event.target.value as unknown as number })
                  }
                  aria-label={`Staff on at a time on ${name}`}
                  className="w-full sm:w-20"
                />
              </div>
            </div>
            {error && (
              <p role="alert" className="text-xs text-destructive-text">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Settings → Workspace: the admin keeps the trading hours up to date. */
export function TradingHoursForm({ days }: { days: TradingDay[] }) {
  const [value, setValue] = useState(() => toTradingWeekValues(days));
  const [errors, setErrors] = useState<DayErrors>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const checked = checkTradingWeek(value);
      if (!checked.ok) {
        setErrors(checked.errors);
        setMessage({ ok: false, text: checked.message });
        return;
      }
      const result = await saveTradingHoursAction({ days: value });
      if (result.ok) {
        setErrors({});
        setMessage({
          ok: true,
          text: `Saved. Open ${result.data.openDays} day${result.data.openDays === 1 ? '' : 's'} a week.`,
        });
      } else {
        setErrors({});
        setMessage({ ok: false, text: result.error.message });
      }
    });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <TradingWeekFields value={value} onChange={setValue} errors={errors} disabled={pending} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save trading hours'}
        </Button>
        {message && (
          <p
            role={message.ok ? 'status' : 'alert'}
            className={cn(
              'text-sm',
              message.ok ? 'text-muted-foreground' : 'text-destructive-text',
            )}
          >
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
