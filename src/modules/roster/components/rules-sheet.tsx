'use client';

import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Field, fieldA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatCalendarDate } from '@/lib/format';
import { addHolidayAction, removeHolidayAction, saveRulesAction } from '@/modules/roster/actions';
import type { RosterRules } from '@/modules/roster/types';

const LOADINGS = [
  ['saturday', 'Saturday'],
  ['sunday', 'Sunday'],
  ['publicHoliday', 'Public holiday'],
] as const;

type RuleRow = { hours: string; minutes: string; paid: boolean };

/** What weekends and public holidays pay, and which breaks a shift gets by itself. */
export function RulesSheet({ rules, onClose }: { rules: RosterRules; onClose: () => void }) {
  const router = useRouter();
  const [loadings, setLoadings] = useState({
    saturday: String(rules.loadings.saturday),
    sunday: String(rules.loadings.sunday),
    publicHoliday: String(rules.loadings.publicHoliday),
  });
  const [rows, setRows] = useState<RuleRow[]>(
    rules.breakRules.map((rule) => ({
      hours: String(rule.fromMinutes / 60),
      minutes: String(rule.minutes),
      paid: rule.paid,
    })),
  );
  const [holiday, setHoliday] = useState({ day: '', name: '' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();

  const run = (
    action: () => Promise<{
      ok: boolean;
      error?: { message: string; fieldErrors?: Record<string, string[]> };
    }>,
    after?: () => void,
  ) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error?.message ?? 'Something went wrong.');
        setFieldErrors(result.error?.fieldErrors ?? {});
        return;
      }
      setError(null);
      setFieldErrors({});
      after?.();
      router.refresh();
    });

  const save = () =>
    run(
      () =>
        saveRulesAction({
          ...loadings,
          breakRules: rows.map((row) => ({
            fromMinutes: Math.round(Number(row.hours) * 60),
            minutes: row.minutes,
            paid: row.paid,
          })),
        }),
      onClose,
    );
  const setRow = (index: number, change: Partial<RuleRow>) =>
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...change } : row)));

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Pay loadings and breaks</SheetTitle>
          <SheetDescription>
            Used to cost shifts on the roster. A loading multiplies a person’s contract hourly rate:
            1 is the ordinary rate, 1.5 is time and a half.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4">
          <fieldset>
            <legend className="text-sm font-medium">Loadings</legend>
            <div className="mt-2 grid grid-cols-3 gap-3">
              {LOADINGS.map(([key, label]) => (
                <Field
                  key={key}
                  name={`loading-${key}`}
                  label={label}
                  error={fieldErrors[key]?.[0]}
                >
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={5}
                    step={0.05}
                    value={loadings[key]}
                    onChange={(event) => setLoadings({ ...loadings, [key]: event.target.value })}
                    {...fieldA11y(`loading-${key}`, fieldErrors[key]?.[0])}
                  />
                </Field>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              A whole shift is costed at the rate of the day it starts on.
            </p>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Breaks added automatically</legend>
            <div className="mt-2 flex flex-col gap-2">
              {rows.map((row, index) => (
                <div key={index} className="flex items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">From</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0.5}
                    step={0.5}
                    className="w-14 px-2"
                    value={row.hours}
                    aria-label={`Rule ${index + 1}, shift length in hours`}
                    onChange={(event) => setRow(index, { hours: event.target.value })}
                  />
                  <span className="text-muted-foreground">h, add</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={5}
                    className="w-14 px-2"
                    value={row.minutes}
                    aria-label={`Rule ${index + 1}, break in minutes`}
                    onChange={(event) => setRow(index, { minutes: event.target.value })}
                  />
                  <span className="text-muted-foreground">min</span>
                  <NativeSelect
                    className="w-[5.75rem] px-2"
                    value={row.paid ? 'paid' : 'unpaid'}
                    aria-label={`Rule ${index + 1}, paid or unpaid`}
                    onChange={(event) => setRow(index, { paid: event.target.value === 'paid' })}
                  >
                    <option value="unpaid">unpaid</option>
                    <option value="paid">paid</option>
                  </NativeSelect>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    aria-label={`Remove rule ${index + 1}`}
                    onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              ))}
              {rows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No rules: shifts start with no breaks.
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() =>
                  setRows((current) => [...current, { hours: '5', minutes: '30', paid: false }])
                }
              >
                <Plus aria-hidden /> Add rule
              </Button>
              {fieldErrors.breakRules?.[0] && (
                <p className="text-sm text-destructive-text">{fieldErrors.breakRules[0]}</p>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Unpaid breaks come off the hours worked. Any shift’s breaks can still be set by hand.
            </p>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Public holidays</legend>
            {rules.holidays.length > 0 && (
              <ul className="mt-2 divide-y rounded-lg border">
                {rules.holidays.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="w-28 shrink-0 tabular-nums">
                      {formatCalendarDate(item.day)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={isPending}
                      aria-label={`Remove ${item.name}`}
                      onClick={() => run(() => removeHolidayAction({ id: item.id }))}
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Field name="holiday-day" label="Day" error={fieldErrors.day?.[0]}>
                <Input
                  type="date"
                  value={holiday.day}
                  onChange={(event) => setHoliday({ ...holiday, day: event.target.value })}
                  {...fieldA11y('holiday-day', fieldErrors.day?.[0])}
                />
              </Field>
              <Field name="holiday-name" label="Name" className="min-w-32 flex-1">
                <Input
                  maxLength={60}
                  value={holiday.name}
                  onChange={(event) => setHoliday({ ...holiday, name: event.target.value })}
                  {...fieldA11y('holiday-name')}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                disabled={isPending || !holiday.day || !holiday.name.trim()}
                onClick={() =>
                  run(
                    () => addHolidayAction(holiday),
                    () => setHoliday({ day: '', name: '' }),
                  )
                }
              >
                Add
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Holidays are saved as soon as you add or remove them.
            </p>
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
        </div>

        <SheetFooter className="flex-row items-center">
          <Button type="button" variant="outline" className="ml-auto" onClick={onClose}>
            Close
          </Button>
          <Button type="button" disabled={isPending} onClick={save}>
            Save loadings and breaks
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
