'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy, Plus, Search, Trash2, TriangleAlert, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { Badge } from '@/components/ui/badge';
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
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { copyShiftAction, deleteShiftAction, saveShiftAction } from '@/modules/roster/actions';
import { formatHours } from '@/modules/roster/hours';
import { awardPayFor, costOfShift, leaveOn, shiftWarnings } from '@/modules/roster/insights';
import {
  autoBreaks,
  centsToAmount,
  DAY_KIND_LABEL,
  describeBreaks,
  shiftLength,
  unpaidMinutes,
} from '@/modules/roster/rules';
import { saveShiftSchema, type ShiftFormValues } from '@/modules/roster/schemas';
import type {
  RosterLeave,
  RosterPerson,
  RosterRates,
  RosterRules,
  RosterShift,
  RosterTeam,
} from '@/modules/roster/types';

export type ShiftDraft = { userId: string | null; date: string; shift?: RosterShift };

/** Side panel for adding or changing one shift. Remounted per draft, so defaults are fresh. */
export function ShiftEditor({
  rosterId,
  draft,
  people,
  teams,
  days,
  shifts,
  leave,
  rules,
  rates,
  currency,
  today,
  weeks,
  onClose,
}: {
  rosterId: string;
  draft: ShiftDraft;
  people: RosterPerson[];
  teams: RosterTeam[];
  days: { date: string; label: string }[];
  /** Every shift on the roster, to show who is already working and for how long. */
  shifts: RosterShift[];
  leave: RosterLeave[];
  rules: RosterRules;
  /** Null when the person editing may not see pay. */
  rates: RosterRates | null;
  currency: string;
  today: string;
  /** Weeks in the roster, which sets the weekly ordinary-hours limit under an award. */
  weeks: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const editing = draft.shift;
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [copyDates, setCopyDates] = useState<string[]>([]);
  const [isWorking, startWork] = useTransition();

  const teamsOf = (userId: string | null) =>
    userId ? teams.filter((team) => team.memberIds.includes(userId)) : teams;
  const soleTeam = (userId: string | null) => {
    const own = userId ? teamsOf(userId) : [];
    return own.length === 1 ? (own[0]?.id ?? '') : '';
  };

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ShiftFormValues, unknown, ShiftFormValues>({
    // Submits what was typed; the Server Action parses it with the same schema.
    resolver: zodResolver(saveShiftSchema, undefined, { raw: true }),
    defaultValues: {
      id: editing?.id,
      rosterId,
      userId: editing ? (editing.userId ?? '') : (draft.userId ?? ''),
      teamId: editing
        ? teams.some((team) => team.id === editing.teamId)
          ? (editing.teamId ?? '')
          : ''
        : soleTeam(draft.userId),
      date: draft.date,
      startTime: editing?.startTime ?? '09:00',
      endTime: editing?.endTime ?? '17:00',
      breaks: editing?.breaks ?? [],
      autoBreaks: editing ? editing.autoBreaks : true,
      note: editing?.note ?? '',
    },
  });
  const breakFields = useFieldArray({ control, name: 'breaks' });

  const [userIdValue, teamId, date, startTime, endTime, isAuto, manualBreaks] = useWatch({
    control,
    name: ['userId', 'teamId', 'date', 'startTime', 'endTime', 'autoBreaks', 'breaks'],
  });
  const userId = userIdValue || null;
  const length = shiftLength(startTime, endTime);
  const overnight = Boolean(startTime && endTime) && endTime <= startTime;
  const computedBreaks = useMemo(
    () => autoBreaks(length, rules.breakRules),
    [length, rules.breakRules],
  );
  const breaks = isAuto
    ? computedBreaks
    : (manualBreaks ?? []).map((item) => ({
        minutes: Number(item.minutes) || 0,
        paid: Boolean(item.paid),
      }));
  const paidMinutes = Math.max(0, length - unpaidMinutes(breaks));

  const holidays = useMemo(
    () => new Set(rules.holidays.map((holiday) => holiday.day)),
    [rules.holidays],
  );
  const cost = rates ? costOfShift({ userId, date, paidMinutes }, rates, rules, holidays) : null;
  // Under an award with written-down rules, the shift is paid in the light of the person's
  // other shifts this period, so it is worked out with this one as it currently stands.
  const DRAFT_ID = editing?.id ?? 'new-shift';
  const award = useMemo(() => {
    if (!rates || !userId || length <= 0) return null;
    const others = shifts.filter((shift) => shift.id !== editing?.id);
    const pay = awardPayFor(
      userId,
      [
        ...others,
        {
          id: DRAFT_ID,
          userId,
          date,
          startTime,
          endTime,
          breakMinutes: length - paidMinutes,
          paidMinutes,
        },
      ],
      rates,
      holidays,
      weeks,
    );
    if (!pay) return null;
    return {
      cents: pay.costByShift[DRAFT_ID] ?? 0,
      lines: pay.lines.filter((line) => line.shiftId === DRAFT_ID),
      warnings: pay.warnings.filter(
        (warning) => warning.shiftId === DRAFT_ID || warning.shiftId === null,
      ),
    };
  }, [
    rates,
    userId,
    length,
    shifts,
    editing?.id,
    DRAFT_ID,
    date,
    startTime,
    endTime,
    paidMinutes,
    holidays,
    weeks,
  ]);
  const warnings = shiftWarnings(
    {
      userId,
      date,
      published: editing?.published ?? false,
      unpublishedChanges: editing?.unpublishedChanges ?? true,
    },
    { leave, today, rates },
  );

  const options = useMemo(() => {
    const others = shifts.filter((shift) => shift.id !== editing?.id);
    const term = search.trim().toLowerCase();
    return people
      .filter((person) => !term || person.fullName.toLowerCase().includes(term))
      .map((person) => {
        const own = others.filter((shift) => shift.userId === person.userId);
        const sameDay = own.find((shift) => shift.date === date);
        const away = leaveOn(leave, person.userId, date);
        return {
          ...person,
          minutes: own.reduce((sum, shift) => sum + shift.paidMinutes, 0),
          rate: rates?.[person.userId]?.hourly ?? null,
          caution: Boolean(away || sameDay),
          status: away
            ? away.status === 'approved'
              ? 'On leave'
              : 'Leave requested'
            : sameDay
              ? `Working ${sameDay.startTime}–${sameDay.endTime}`
              : 'Available',
        };
      });
  }, [people, shifts, editing?.id, search, date, leave, rates]);

  const pick = (next: string | null) => {
    setValue('userId', next ?? '', { shouldDirty: true });
    // A team the newly chosen person is not in would be refused on save.
    const allowed = teamsOf(next).some((team) => team.id === teamId);
    if (!allowed) setValue('teamId', soleTeam(next));
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await saveShiftAction(values.autoBreaks ? { ...values, breaks } : values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof ShiftFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    onClose();
    router.refresh();
  });

  const afterAction = (result: { ok: boolean; error?: { message: string } }) => {
    if (!result.ok) {
      setFormError(result.error?.message ?? 'Something went wrong.');
      return;
    }
    onClose();
    router.refresh();
  };
  const remove = () =>
    startWork(async () => {
      if (editing) afterAction(await deleteShiftAction({ id: editing.id }));
    });
  const copy = () =>
    startWork(async () => {
      if (editing) afterAction(await copyShiftAction({ id: editing.id, dates: copyDates }));
    });

  const busy = isSubmitting || isWorking;
  const selected = people.find((person) => person.userId === userId);
  const breaksError =
    typeof errors.breaks?.message === 'string' ? errors.breaks.message : undefined;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {editing ? 'Edit shift' : 'Add shift'}
            {editing && (
              <Badge
                variant={editing.unpublishedChanges ? 'secondary' : 'default'}
                className={cn(
                  editing.unpublishedChanges &&
                    'border-warning-border bg-warning text-warning-text',
                )}
              >
                {!editing.unpublishedChanges
                  ? 'Published'
                  : editing.published
                    ? 'Changed since publishing'
                    : 'Draft'}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            Times are in your workspace’s timezone. An end time before the start runs overnight.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
          <div className="flex flex-col gap-5 px-4">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">Who</legend>
              <div className="relative">
                <Search
                  aria-hidden
                  className="absolute top-2.5 left-2.5 size-4 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search people"
                  aria-label="Search people"
                  className="pl-8"
                />
              </div>
              <div
                role="radiogroup"
                aria-label="Person on this shift"
                className="max-h-52 overflow-y-auto rounded-lg border"
              >
                {[
                  {
                    userId: null as string | null,
                    fullName: 'Vacant',
                    status: 'Fill it later',
                    caution: false,
                    rate: null as string | null,
                    minutes: null as number | null,
                  },
                  ...options,
                ].map((option) => {
                  const active = option.userId === userId;
                  return (
                    <button
                      key={option.userId ?? 'vacant'}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => pick(option.userId)}
                      className={cn(
                        'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm outline-none last:border-b-0 hover:bg-muted focus-visible:bg-muted',
                        active && 'bg-accent text-accent-foreground hover:bg-accent',
                      )}
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        {active && <Check aria-hidden className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium" data-sensitive>
                          {option.fullName}
                        </span>
                        <span
                          className={cn(
                            'block text-xs',
                            option.caution ? 'text-warning-text' : 'text-muted-foreground',
                          )}
                        >
                          {option.status}
                        </span>
                      </span>
                      {option.minutes !== null && (
                        <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                          {option.rate && (
                            <span className="block" data-sensitive>
                              {formatMoney(option.rate, currency)}/h
                            </span>
                          )}
                          <span className="block">{formatHours(option.minutes)} rostered</span>
                        </span>
                      )}
                    </button>
                  );
                })}
                {options.length === 0 && search && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    Nobody matches that search.
                  </p>
                )}
              </div>
              {errors.userId?.message && (
                <p className="text-sm text-destructive-text">{errors.userId.message}</p>
              )}
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <Field
                name="teamId"
                label="Team"
                error={errors.teamId?.message}
                hint={userId && teamsOf(userId).length === 0 ? 'Not in a team yet' : undefined}
              >
                <NativeSelect
                  {...fieldA11y('teamId', errors.teamId?.message)}
                  {...register('teamId')}
                >
                  <option value="">No team</option>
                  {teamsOf(userId).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field name="date" label="Day" error={errors.date?.message} required>
                <NativeSelect {...fieldA11y('date', errors.date?.message)} {...register('date')}>
                  {days.map((day) => (
                    <option key={day.date} value={day.date}>
                      {day.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field name="startTime" label="Start" error={errors.startTime?.message} required>
                <Input
                  type="time"
                  {...fieldA11y('startTime', errors.startTime?.message)}
                  {...register('startTime')}
                />
              </Field>
              <Field name="endTime" label="End" error={errors.endTime?.message} required>
                <Input
                  type="time"
                  {...fieldA11y('endTime', errors.endTime?.message)}
                  {...register('endTime')}
                />
              </Field>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium">Breaks</legend>
              {isAuto ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <p className="text-sm">
                    {describeBreaks(computedBreaks)}
                    <span className="block text-xs text-muted-foreground">
                      Set by your break rules for a shift this long
                    </span>
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      breakFields.replace(computedBreaks);
                      setValue('autoBreaks', false);
                    }}
                  >
                    Set by hand
                  </Button>
                </div>
              ) : (
                <>
                  {breakFields.fields.map((field, index) => (
                    <div key={field.id} className="flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={5}
                        aria-label={`Break ${index + 1}, minutes`}
                        className="w-24"
                        {...register(`breaks.${index}.minutes`)}
                      />
                      <span className="text-sm text-muted-foreground">min</span>
                      <label className="ml-2 flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          {...register(`breaks.${index}.paid`)}
                        />
                        Paid
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto"
                        aria-label={`Remove break ${index + 1}`}
                        onClick={() => breakFields.remove(index)}
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  ))}
                  {breakFields.fields.length === 0 && (
                    <p className="text-sm text-muted-foreground">No breaks on this shift.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => breakFields.append({ minutes: 30, paid: false })}
                    >
                      <Plus aria-hidden /> Add break
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setValue('autoBreaks', true)}
                    >
                      Use break rules
                    </Button>
                  </div>
                </>
              )}
              {breaksError && <p className="text-sm text-destructive-text">{breaksError}</p>}
            </fieldset>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-muted px-3 py-2.5 text-sm">
              <dt className="text-muted-foreground">Hours worked</dt>
              <dd className="text-right font-medium tabular-nums">
                {length > 0 ? formatHours(paidMinutes) : '—'}
                {overnight && <span className="font-normal text-muted-foreground"> +1 day</span>}
              </dd>
              {award && (
                <>
                  {award.lines.map((line) => (
                    <div key={`${line.kind}|${line.label}`} className="contents">
                      <dt className="text-muted-foreground">
                        {line.label}
                        <span className="block text-xs">
                          {line.minutes === null
                            ? `${formatMoney(line.rate, currency)} each`
                            : `${formatHours(line.minutes)} at ${formatMoney(line.rate, currency)}`}{' '}
                          · cl {line.clause}
                        </span>
                      </dt>
                      <dd className="text-right tabular-nums" data-sensitive>
                        {formatMoney(centsToAmount(line.cents), currency)}
                      </dd>
                    </div>
                  ))}
                  <dt className="font-medium">Cost under the award</dt>
                  <dd className="text-right font-medium tabular-nums" data-sensitive>
                    {formatMoney(centsToAmount(award.cents), currency)}
                  </dd>
                </>
              )}
              {cost && !award && (
                <>
                  <dt className="text-muted-foreground">Day</dt>
                  <dd className="text-right tabular-nums">
                    {DAY_KIND_LABEL[cost.kind]}
                    {cost.loading !== 1 && ` × ${Number(cost.loading.toFixed(2))}`}
                    {cost.kind !== 'ordinary' && (
                      <span className="block text-xs text-muted-foreground">
                        {cost.source === 'award' ? 'Award rate' : 'Your loading'}
                      </span>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Cost</dt>
                  <dd className="text-right font-medium tabular-nums" data-sensitive>
                    {cost.cents === null ? '—' : formatMoney(centsToAmount(cost.cents), currency)}
                  </dd>
                </>
              )}
            </dl>

            <Field name="note" label="Note" error={errors.note?.message}>
              <Textarea
                rows={2}
                maxLength={300}
                {...fieldA11y('note', errors.note?.message)}
                {...register('note')}
              />
            </Field>

            {award && (
              <p className="text-xs text-muted-foreground">
                Worked out from the award’s rules and the Fair Work Commission’s rates, taking this
                person’s other shifts into account. Lines show the award minimum; the total keeps
                any margin their agreed rate has over it. Check it before relying on it for pay.
              </p>
            )}
            {(warnings.length > 0 || (award?.warnings.length ?? 0) > 0) && (
              <ul className="flex flex-col gap-1 rounded-lg border border-warning-border bg-warning px-3 py-2 text-sm text-warning-text">
                {award?.warnings.map((warning) => (
                  <li
                    key={`${warning.clause}|${warning.message}`}
                    className="flex items-start gap-2"
                  >
                    <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {warning.message} <span className="opacity-80">(cl {warning.clause})</span>
                    </span>
                  </li>
                ))}
                {warnings.map((warning) => (
                  <li key={warning} className="flex items-start gap-2">
                    <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    {selected && !warning.startsWith('Nobody')
                      ? `${selected.fullName.split(' ')[0]}: ${warning}`
                      : warning}
                  </li>
                ))}
              </ul>
            )}

            {editing && days.length > 1 && (
              <fieldset className="flex flex-col gap-2 border-t pt-4">
                <legend className="sr-only">Copy this shift to other days</legend>
                <p className="text-sm font-medium">Copy to other days</p>
                <div className="flex flex-wrap gap-1.5">
                  {days
                    .filter((day) => day.date !== editing.date)
                    .map((day) => {
                      const on = copyDates.includes(day.date);
                      return (
                        <label
                          key={day.date}
                          className={cn(
                            'cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50',
                            on
                              ? 'border-primary bg-accent text-accent-foreground'
                              : 'hover:bg-muted',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={on}
                            onChange={() =>
                              setCopyDates((current) =>
                                on
                                  ? current.filter((value) => value !== day.date)
                                  : [...current, day.date],
                              )
                            }
                          />
                          {day.label}
                        </label>
                      );
                    })}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={busy || copyDates.length === 0}
                  onClick={copy}
                >
                  <Copy aria-hidden /> Copy to {copyDates.length || ''}{' '}
                  {copyDates.length === 1 ? 'day' : 'days'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Copies the shift as last saved, for the same person and team.
                </p>
              </fieldset>
            )}

            {formError && (
              <p role="alert" className="text-sm text-destructive-text">
                {formError}
              </p>
            )}
          </div>

          <SheetFooter className="flex-row items-center">
            {editing && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive-text"
                onClick={remove}
                disabled={busy}
              >
                <Trash2 aria-hidden /> Delete
              </Button>
            )}
            <Button type="button" variant="outline" className="ml-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {editing ? 'Save changes' : 'Add shift'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
