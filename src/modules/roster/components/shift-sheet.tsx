'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';

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
import { Textarea } from '@/components/ui/textarea';
import { deleteShiftAction, saveShiftAction } from '@/modules/roster/actions';
import { formatHours } from '@/modules/roster/hours';
import {
  saveShiftSchema,
  type SaveShiftInput,
  type ShiftFormValues,
} from '@/modules/roster/schemas';
import type { RosterPerson, RosterShift } from '@/modules/roster/types';

export type ShiftDraft = { userId: string; date: string; shift?: RosterShift };

const minutesOf = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

/** Side panel for adding or changing one shift. Remounted per draft, so defaults are fresh. */
export function ShiftSheet({
  rosterId,
  draft,
  people,
  days,
  positions,
  onClose,
}: {
  rosterId: string;
  draft: ShiftDraft;
  people: RosterPerson[];
  days: { date: string; label: string }[];
  /** Tags already used on this roster, offered as suggestions. */
  positions: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const editing = draft.shift;
  const [formError, setFormError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ShiftFormValues, unknown, SaveShiftInput>({
    resolver: zodResolver(saveShiftSchema),
    defaultValues: {
      id: editing?.id,
      rosterId,
      userId: draft.userId,
      date: draft.date,
      startTime: editing?.startTime ?? '09:00',
      endTime: editing?.endTime ?? '17:00',
      breakMinutes: editing?.breakMinutes ?? 30,
      position: editing?.position ?? '',
      note: editing?.note ?? '',
    },
  });

  const [startTime, endTime, breakMinutes] = useWatch({
    control,
    name: ['startTime', 'endTime', 'breakMinutes'],
  });
  const overnight = Boolean(startTime && endTime) && endTime <= startTime;
  const length =
    startTime && endTime ? minutesOf(endTime) - minutesOf(startTime) + (overnight ? 1440 : 0) : 0;
  const paid = length - (Number(breakMinutes) || 0);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await saveShiftAction(values);
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

  const remove = () =>
    startDelete(async () => {
      if (!editing) return;
      const result = await deleteShiftAction({ id: editing.id });
      if (!result.ok) {
        setFormError(result.error.message);
        return;
      }
      onClose();
      router.refresh();
    });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editing ? 'Edit shift' : 'Add shift'}</SheetTitle>
          <SheetDescription>
            Times are in your workspace’s timezone. An end time before the start runs overnight.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
          <div className="flex flex-col gap-4 px-4">
            <Field name="userId" label="Person" error={errors.userId?.message} required>
              <NativeSelect
                {...fieldA11y('userId', errors.userId?.message)}
                {...register('userId')}
              >
                {people.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.fullName}
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

            <div className="grid grid-cols-2 gap-3">
              <Field
                name="breakMinutes"
                label="Break (minutes)"
                error={errors.breakMinutes?.message}
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={5}
                  {...fieldA11y('breakMinutes', errors.breakMinutes?.message)}
                  {...register('breakMinutes')}
                />
              </Field>
              <Field
                name="position"
                label="Tag"
                hint="A short label, such as a duty or area"
                error={errors.position?.message}
              >
                <Input
                  list="roster-positions"
                  maxLength={24}
                  {...fieldA11y('position', errors.position?.message)}
                  {...register('position')}
                />
                <datalist id="roster-positions">
                  {positions.map((position) => (
                    <option key={position} value={position} />
                  ))}
                </datalist>
              </Field>
            </div>

            <Field name="note" label="Note" error={errors.note?.message}>
              <Textarea
                rows={2}
                maxLength={300}
                {...fieldA11y('note', errors.note?.message)}
                {...register('note')}
              />
            </Field>

            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {paid > 0 ? (
                <>
                  <span className="font-medium text-foreground">{formatHours(paid)}</span> worked
                  {overnight ? ', ending the next day' : ''}
                </>
              ) : (
                'Set a start and end time'
              )}
            </p>

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
                disabled={isDeleting || isSubmitting}
              >
                <Trash2 aria-hidden /> Delete
              </Button>
            )}
            <Button type="button" variant="outline" className="ml-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isDeleting}>
              {editing ? 'Save changes' : 'Add shift'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
