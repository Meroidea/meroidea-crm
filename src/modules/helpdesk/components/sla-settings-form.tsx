'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveSlaSettingsAction } from '@/modules/helpdesk/actions';

import type { SlaSettings } from '../queries';
import { PRIORITIES, PRIORITY_LABELS, slaSettingsSchema } from '../schemas';

type FormValues = z.input<typeof slaSettingsSchema>;
type SubmitValues = z.output<typeof slaSettingsSchema>;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The business's response targets (ADR-069): first reply and resolution per priority, when a
 * ticket counts as at risk, who hears about breaches, and the hours time is counted in.
 */
export function SlaSettingsForm({
  settings,
  people,
  timezones,
}: {
  settings: SlaSettings;
  people: { userId: string; fullName: string | null }[];
  timezones: string[];
}) {
  const { run, error, isPending } = useActionRunner();
  const form = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(slaSettingsSchema),
    defaultValues: {
      atRiskPercent: settings.atRiskPercent,
      escalateToUserId: settings.escalateToUserId ?? '',
      useBusinessHours: settings.useBusinessHours,
      timezone: settings.timezone,
      skipPublicHolidays: settings.skipPublicHolidays,
      weekly: settings.weekly,
      targets: settings.targets,
    },
  });
  const week = useFieldArray({ control: form.control, name: 'weekly' });
  const errors = form.formState.errors;
  const useHours = useWatch({ control: form.control, name: 'useBusinessHours' });
  const number = { valueAsNumber: true } as const;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={form.handleSubmit((values) => run(() => saveSlaSettingsAction(values)))}
    >
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <h2 className="font-medium">Targets by priority</h2>
        <p className="text-sm text-muted-foreground">
          In hours (0.25 is 15 minutes). The resolution clock stops while a ticket is pending the
          customer.
        </p>
        <div className="grid grid-cols-[minmax(5rem,1fr)_1fr_1fr] items-end gap-x-3 gap-y-2 text-sm">
          <span />
          <span className="text-xs font-medium text-muted-foreground">First reply within</span>
          <span className="text-xs font-medium text-muted-foreground">Solved within</span>
          {[...PRIORITIES].reverse().map((priority) => (
            <div key={priority} className="contents">
              <span className="font-medium">{PRIORITY_LABELS[priority]}</span>
              <div>
                <Input
                  type="number"
                  step="0.25"
                  min="0.25"
                  aria-label={`${PRIORITY_LABELS[priority]}: first reply within (hours)`}
                  {...form.register(`targets.${priority}.firstResponseHours`, number)}
                />
                {errors.targets?.[priority]?.firstResponseHours && (
                  <p className="text-xs text-destructive-text">
                    {errors.targets[priority]?.firstResponseHours?.message}
                  </p>
                )}
              </div>
              <div>
                <Input
                  type="number"
                  step="0.25"
                  min="0.25"
                  aria-label={`${PRIORITY_LABELS[priority]}: solved within (hours)`}
                  {...form.register(`targets.${priority}.resolutionHours`, number)}
                />
                {errors.targets?.[priority]?.resolutionHours && (
                  <p className="text-xs text-destructive-text">
                    {errors.targets[priority]?.resolutionHours?.message}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
        <Field
          name="atRiskPercent"
          label="At risk after (% of the target)"
          error={errors.atRiskPercent?.message}
          hint="A ticket turns amber this far into its time, and its assignee is told."
        >
          <Input
            id="atRiskPercent"
            type="number"
            min={1}
            max={99}
            {...form.register('atRiskPercent', number)}
          />
        </Field>
        <Field
          name="escalateToUserId"
          label="Also tell about breaches"
          error={errors.escalateToUserId?.message}
          hint="Besides the assignee. With nobody chosen and nobody assigned, everyone who manages tickets is told."
        >
          <NativeSelect id="escalateToUserId" {...form.register('escalateToUserId')}>
            <option value="">Nobody else</option>
            {people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.fullName ?? 'Colleague'}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <h2 className="font-medium">When time counts</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            {...form.register('useBusinessHours')}
          />
          Count only business hours (otherwise around the clock)
        </label>
        {useHours && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="timezone" label="Timezone" error={errors.timezone?.message}>
                <NativeSelect id="timezone" {...form.register('timezone')}>
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replaceAll('_', ' ')}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  {...form.register('skipPublicHolidays')}
                />
                Skip public holidays (from Rosters settings)
              </label>
            </div>
            <ul className="flex flex-col gap-2" aria-label="Opening hours">
              {week.fields.map((field, index) => (
                <li key={field.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <NativeSelect
                    aria-label="Day"
                    className="w-36"
                    {...form.register(`weekly.${index}.day`, number)}
                  >
                    {DAYS.map((day, value) => (
                      <option key={day} value={value}>
                        {day}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input
                    type="time"
                    aria-label="Opens"
                    className="w-32"
                    {...form.register(`weekly.${index}.opens`)}
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    aria-label="Closes"
                    className="w-32"
                    placeholder="17:00"
                    {...form.register(`weekly.${index}.closes`)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${DAYS[form.getValues(`weekly.${index}.day`)] ?? 'these'} hours`}
                    onClick={() => week.remove(index)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                  {errors.weekly?.[index] && (
                    <p className="w-full text-xs text-destructive-text">
                      {errors.weekly[index]?.opens?.message ??
                        errors.weekly[index]?.closes?.message}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {errors.weekly?.message && (
              <p className="text-xs text-destructive-text">{errors.weekly.message}</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => week.append({ day: 1, opens: '09:00', closes: '17:00' })}
            >
              <Plus aria-hidden /> Add hours
            </Button>
            <p className="text-xs text-muted-foreground">
              A day can have several spans (for a lunch break). Use 24:00 for midnight.
            </p>
          </>
        )}
      </section>

      <ErrorNote error={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save targets'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Tickets still being worked follow the new targets as soon as they are saved.
        </p>
      </div>
    </form>
  );
}
