'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Plus, RotateCcw, Search } from 'lucide-react';
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
import {
  raiseConcernAction,
  replyToConcernAction,
  setConcernStatusAction,
} from '@/modules/concerns/actions';
import {
  CONCERN_CATEGORIES,
  RAISED_WITH_LABELS,
  raiseConcernSchema,
  type ConcernStatus,
  type RaiseConcernInput,
  type RaiseConcernValues,
} from '@/modules/concerns/schemas';

export function RaiseConcernButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<RaiseConcernValues, unknown, RaiseConcernInput>({
    resolver: zodResolver(raiseConcernSchema),
    defaultValues: { raisedWith: 'manager', category: 'other', subject: '', details: '' },
  });
  const raisedWith = useWatch({ control, name: 'raisedWith' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await raiseConcernAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof RaiseConcernValues, { message: messages[0] });
      }
      return setFormError(result.error.message);
    }
    reset();
    setOpen(false);
    router.push(`/concerns/${result.data.id}`);
  });

  const input = (name: keyof RaiseConcernValues) => ({
    ...fieldA11y(name, errors[name]?.message),
    ...register(name),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Raise a concern
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Raise a concern</SheetTitle>
            <SheetDescription>
              Your name is shown with it. It stays between you and the people you raise it with.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col gap-4 px-4 pb-4">
            <Field
              name="raisedWith"
              label="Raise it with"
              hint={
                raisedWith === 'admin'
                  ? 'Only the business’s admin can read it. Managers cannot.'
                  : 'Managers and the business’s admin can read it.'
              }
              error={errors.raisedWith?.message}
              required
            >
              <NativeSelect {...input('raisedWith')}>
                {Object.entries(RAISED_WITH_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field name="category" label="About" error={errors.category?.message} required>
              <NativeSelect {...input('category')}>
                {Object.entries(CONCERN_CATEGORIES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field name="subject" label="Title" error={errors.subject?.message} required>
              <Input maxLength={150} {...input('subject')} />
            </Field>
            <Field
              name="details"
              label="What happened"
              hint="Say what, when and who, and what you would like to happen."
              error={errors.details?.message}
              required
            >
              <Textarea rows={7} maxLength={5000} {...input('details')} />
            </Field>
            {formError && (
              <p role="alert" className="text-sm text-destructive-text">
                {formError}
              </p>
            )}
            <SheetFooter className="mt-auto px-0">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Raise concern'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function ConcernReply({ concernId }: { concernId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await replyToConcernAction({ id: concernId, body });
          if (!result.ok) {
            return setError(result.error.fieldErrors?.body?.[0] ?? result.error.message);
          }
          setBody('');
          router.refresh();
        });
      }}
    >
      <Field name="concern-reply" label="Reply" error={error ?? undefined}>
        <Textarea
          rows={4}
          maxLength={5000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          {...fieldA11y('concern-reply', error ?? undefined)}
        />
      </Field>
      <Button type="submit" className="self-end" disabled={isPending || body.trim().length === 0}>
        {isPending ? 'Sending…' : 'Send reply'}
      </Button>
    </form>
  );
}

/** For whoever answers it: move it along, resolve it, or reopen it. */
export function ConcernStatusControls({
  concernId,
  status,
}: {
  concernId: string;
  status: ConcernStatus;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set = (next: ConcernStatus) =>
    startTransition(async () => {
      setError(null);
      const result = await setConcernStatusAction({ id: concernId, status: next });
      if (!result.ok) return setError(result.error.message);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'open' && (
        <Button variant="outline" disabled={isPending} onClick={() => set('in_progress')}>
          <Search aria-hidden /> Mark as being looked at
        </Button>
      )}
      {status !== 'resolved' ? (
        <Button disabled={isPending} onClick={() => set('resolved')}>
          <CheckCircle2 aria-hidden /> Mark resolved
        </Button>
      ) : (
        <Button variant="outline" disabled={isPending} onClick={() => set('open')}>
          <RotateCcw aria-hidden /> Reopen
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
