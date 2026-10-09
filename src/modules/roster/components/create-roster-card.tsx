'use client';

import { CalendarPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Field, fieldA11y } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addDaysToDate } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { createRosterAction } from '@/modules/roster/actions';
import { ROSTER_SPAN_DAYS, type RosterSpan } from '@/modules/roster/schemas';

const SPANS: { value: RosterSpan; title: string; hint: string }[] = [
  { value: 'week', title: 'Weekly', hint: '7 days' },
  { value: 'fortnight', title: 'Fortnightly', hint: '14 days' },
];

/** Shown to someone who can manage rosters when no roster covers the days being looked at. */
export function CreateRosterCard({
  defaultStart,
  canCopy,
}: {
  defaultStart: string;
  /** An earlier roster exists to copy shifts from. */
  canCopy: boolean;
}) {
  const router = useRouter();
  const [startsOn, setStartsOn] = useState(defaultStart);
  const [span, setSpan] = useState<RosterSpan>('week');
  const [copyPrevious, setCopyPrevious] = useState(canCopy);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const endsOn = startsOn ? addDaysToDate(startsOn, ROSTER_SPAN_DAYS[span] - 1) : '';

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await createRosterAction({ startsOn, span, copyPrevious });
      if (!result.ok) {
        setError(result.error.fieldErrors?.startsOn?.[0] ?? result.error.message);
        return;
      }
      router.push(`/roster?date=${startsOn}`);
      router.refresh();
    });

  return (
    <form
      className="mx-auto flex w-full max-w-lg flex-col gap-5 rounded-xl border bg-card p-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
          <CalendarPlus aria-hidden className="size-5" />
        </span>
        <div>
          <h2 className="font-medium">Create a roster</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            No roster covers these days yet. It stays a draft, hidden from your team, until you
            publish it.
          </p>
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">How long does it run?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {SPANS.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer flex-col rounded-lg border px-3 py-2.5 transition-colors',
                span === option.value
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'hover:bg-muted',
              )}
            >
              <input
                type="radio"
                name="span"
                value={option.value}
                checked={span === option.value}
                onChange={() => setSpan(option.value)}
                className="sr-only"
              />
              <span className="text-sm font-medium">{option.title}</span>
              <span className="text-xs text-muted-foreground">{option.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        name="startsOn"
        label="First day"
        error={error ?? undefined}
        hint={
          endsOn
            ? `Runs ${formatCalendarDate(startsOn)} to ${formatCalendarDate(endsOn)}`
            : undefined
        }
        required
      >
        <Input
          type="date"
          required
          value={startsOn}
          onChange={(event) => setStartsOn(event.target.value)}
          {...fieldA11y('startsOn', error ?? undefined)}
        />
      </Field>

      {canCopy && (
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={copyPrevious}
            onChange={(event) => setCopyPrevious(event.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            Start from the previous roster’s shifts
            <span className="block text-xs text-muted-foreground">
              Copied day for day; you can change anything before publishing.
            </span>
          </span>
        </label>
      )}

      <Button type="submit" size="lg" disabled={isPending || !startsOn}>
        Create {span === 'week' ? 'weekly' : 'fortnightly'} roster
      </Button>
    </form>
  );
}
