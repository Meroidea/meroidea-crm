'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';

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
import { daysBetweenDates } from '@/lib/dates';
import {
  cancelLeaveAction,
  decideLeaveAction,
  requestLeaveAction,
  saveLeaveTypeAction,
} from '@/modules/timeoff/actions';
import {
  requestLeaveSchema,
  type RequestLeaveInput,
  type RequestLeaveValues,
} from '@/modules/timeoff/schemas';

type TypeOption = { id: string; name: string; isPaid: boolean; isActive: boolean };

export function RequestLeaveButton({
  types,
  today,
  people,
}: {
  types: TypeOption[];
  today: string;
  /** Given only to people who manage time off, so they can enter leave for someone else. */
  people?: { userId: string; fullName: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const active = types.filter((type) => type.isActive);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RequestLeaveValues, unknown, RequestLeaveInput>({
    resolver: zodResolver(requestLeaveSchema),
    defaultValues: {
      leaveTypeId: active[0]?.id ?? '',
      startsOn: today,
      endsOn: today,
      days: '1',
      note: '',
    },
  });

  /** Suggests the number of days from the dates; the person corrects it for weekends or half days. */
  const suggestDays = () => {
    const { startsOn, endsOn } = getValues();
    if (startsOn && endsOn && endsOn >= startsOn) {
      setValue('days', String(daysBetweenDates(startsOn, endsOn) + 1));
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await requestLeaveAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof RequestLeaveValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    reset();
    setOpen(false);
    router.refresh();
  });

  const input = (name: keyof RequestLeaveValues) => ({
    ...fieldA11y(name, errors[name]?.message),
    ...register(name),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={active.length === 0}>
        <Plus aria-hidden /> Request time off
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Request time off</SheetTitle>
            <SheetDescription>
              It goes to a manager to approve. You will see their answer here.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col gap-4 px-4 pb-4">
            {people && (
              <Field name="userId" label="Who is it for?" error={errors.userId?.message}>
                <NativeSelect {...input('userId')}>
                  <option value="">Me</option>
                  {people.map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.fullName}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field name="leaveTypeId" label="Type of leave" error={errors.leaveTypeId?.message}>
              <NativeSelect {...input('leaveTypeId')}>
                {active.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                    {type.isPaid ? '' : ' (unpaid)'}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field name="startsOn" label="First day" error={errors.startsOn?.message}>
                <Input type="date" {...input('startsOn')} onBlur={suggestDays} />
              </Field>
              <Field name="endsOn" label="Last day" error={errors.endsOn?.message}>
                <Input type="date" {...input('endsOn')} onBlur={suggestDays} />
              </Field>
            </div>
            <Field
              name="days"
              label="Working days away"
              hint="Leave out days you would not have worked. Use 0.5 for a half day."
              error={errors.days?.message}
            >
              <Input inputMode="decimal" {...input('days')} />
            </Field>
            <Field name="note" label="Note (optional)" error={errors.note?.message}>
              <Textarea rows={3} {...input('note')} />
            </Field>
            {formError && (
              <p role="alert" className="text-sm text-destructive-text">
                {formError}
              </p>
            )}
            <SheetFooter className="mt-auto px-0">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send request'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The buttons on one request: approve and decline for managers, cancel where allowed. */
export function RequestActions({
  id,
  canDecide,
  canCancel,
}: {
  id: string;
  canDecide: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (action: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.error?.message ?? 'That did not work.');
      router.refresh();
    });

  if (!canDecide && !canCancel) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {canDecide && (
          <>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => run(() => decideLeaveAction({ id, decision: 'approved' }))}
            >
              <Check aria-hidden /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => run(() => decideLeaveAction({ id, decision: 'declined' }))}
            >
              <X aria-hidden /> Decline
            </Button>
          </>
        )}
        {canCancel && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => run(() => cancelLeaveAction({ id }))}
          >
            Cancel
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

function LeaveTypeRow({ type, onDone }: { type?: TypeOption; onDone?: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(!type);
  const [name, setName] = useState(type?.name ?? '');
  const [isPaid, setIsPaid] = useState(type?.isPaid ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = (changes: Partial<TypeOption>) =>
    startTransition(async () => {
      setError(null);
      const result = await saveLeaveTypeAction({
        id: type?.id,
        name,
        isPaid,
        isActive: type?.isActive ?? true,
        ...changes,
      });
      if (!result.ok) return setError(result.error.fieldErrors?.name?.[0] ?? result.error.message);
      setEditing(false);
      if (!type) setName('');
      onDone?.();
      router.refresh();
    });

  if (!editing && type) {
    return (
      <li className="flex flex-wrap items-center gap-3 px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{type.name}</p>
        <Badge variant="secondary">{type.isPaid ? 'Paid' : 'Unpaid'}</Badge>
        {!type.isActive && <Badge variant="outline">Switched off</Badge>}
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          <Pencil aria-hidden /> Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => save({ isActive: !type.isActive })}
        >
          {type.isActive ? 'Switch off' : 'Switch on'}
        </Button>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save({});
        }}
      >
        <Input
          aria-label="Leave type name"
          placeholder="Name, such as Study leave"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="min-w-40 flex-1"
        />
        <NativeSelect
          aria-label="Paid or unpaid"
          value={isPaid ? 'paid' : 'unpaid'}
          onChange={(event) => setIsPaid(event.target.value === 'paid')}
          className="w-auto"
        >
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </NativeSelect>
        <Button type="submit" size="sm" disabled={isPending}>
          {type ? 'Save' : 'Add'}
        </Button>
        {type && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </li>
  );
}

export function LeaveTypeManager({ types }: { types: TypeOption[] }) {
  return (
    <ul className="flex flex-col divide-y rounded-xl border bg-card">
      {types.map((type) => (
        <LeaveTypeRow key={type.id} type={type} />
      ))}
      <LeaveTypeRow key={`new-${types.length}`} />
    </ul>
  );
}
