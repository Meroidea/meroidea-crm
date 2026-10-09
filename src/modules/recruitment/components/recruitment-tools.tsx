'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy, Paperclip, Pencil, Plus, Star, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';

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
import { cn } from '@/lib/utils';
import {
  addApplicantAction,
  addApplicantNoteAction,
  deleteApplicantAction,
  getResumeUrlAction,
  moveApplicantAction,
  rateApplicantAction,
  saveOpeningAction,
  setOpeningStatusAction,
} from '@/modules/recruitment/actions';
import {
  JOB_TYPE_LABELS,
  JOB_TYPES,
  saveOpeningSchema,
  STAGE_LABELS,
  STAGES,
  type OpeningStatus,
  type SaveOpeningInput,
  type SaveOpeningValues,
  type Stage,
} from '@/modules/recruitment/schemas';

type Result =
  { ok: true } | { ok: false; error: { message: string; fieldErrors?: Record<string, string[]> } };

function useRun() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        return setError(
          Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message,
        );
      }
      after?.();
      router.refresh();
    });
  return { run, error, isPending };
}

const ErrorNote = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="text-sm text-destructive-text">
      {error}
    </p>
  ) : null;

export function OpeningButton({ opening }: { opening?: SaveOpeningValues & { id: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SaveOpeningValues, unknown, SaveOpeningInput>({
    resolver: zodResolver(saveOpeningSchema),
    defaultValues: opening ?? {
      title: '',
      employmentType: 'part_time',
      location: '',
      description: '',
    },
  });
  const input = (name: keyof SaveOpeningValues) => ({
    ...fieldA11y(name, errors[name]?.message),
    ...register(name),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await saveOpeningAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof SaveOpeningValues, { message: messages[0] });
      }
      return setFormError(result.error.message);
    }
    setOpen(false);
    if (opening) router.refresh();
    else {
      reset();
      router.push(`/recruitment/${result.data.id}`);
    }
  });

  return (
    <>
      <Button variant={opening ? 'outline' : 'default'} onClick={() => setOpen(true)}>
        {opening ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {opening ? 'Edit job' : 'New job'}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{opening ? 'Edit job' : 'New job'}</SheetTitle>
            <SheetDescription>
              This is what applicants read. A new job starts as a draft; nothing is public until you
              open it.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col gap-4 px-4 pb-4">
            <Field name="title" label="Job title" error={errors.title?.message}>
              <Input {...input('title')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field name="employmentType" label="Type" error={errors.employmentType?.message}>
                <NativeSelect {...input('employmentType')}>
                  {JOB_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {JOB_TYPE_LABELS[type]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field name="location" label="Location (optional)" error={errors.location?.message}>
                <Input {...input('location')} />
              </Field>
            </div>
            <Field
              name="description"
              label="About the job"
              hint="Duties, hours, what you are looking for, and how the pay is set."
              error={errors.description?.message}
            >
              <Textarea rows={12} {...input('description')} />
            </Field>
            <ErrorNote error={formError} />
            <SheetFooter className="mt-auto px-0">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Opens or closes a job and, while it is open, shows the address applicants use. */
export function OpeningStatusControls({
  id,
  status,
  applyUrl,
}: {
  id: string;
  status: OpeningStatus;
  applyUrl: string;
}) {
  const { run, error, isPending } = useRun();
  const [copied, setCopied] = useState(false);
  const set = (next: OpeningStatus) => run(() => setOpeningStatusAction({ id, status: next }));

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      {status === 'open' ? (
        <>
          <p className="text-sm">
            <span className="font-medium">This job is open.</span> Share this address anywhere you
            advertise it; applications arrive on this page.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={applyUrl} aria-label="Apply page address" />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(applyUrl);
                setCopied(true);
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <div>
            <Button variant="outline" size="sm" disabled={isPending} onClick={() => set('closed')}>
              Close to applications
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {status === 'draft'
              ? 'This job is a draft. Open it to get an apply page you can share.'
              : 'This job is closed. Its apply page no longer accepts applications.'}
          </p>
          <Button disabled={isPending} onClick={() => set('open')}>
            {status === 'draft' ? 'Open to applications' : 'Reopen'}
          </Button>
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

export function AddApplicantButton({ jobOpeningId }: { jobOpeningId: string }) {
  const { run, error, isPending } = useRun();
  const [open, setOpen] = useState(false);
  const blank = { fullName: '', email: '', phone: '', coverNote: '' };
  const [values, setValues] = useState(blank);
  const set = (key: keyof typeof blank) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden /> Add applicant
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Add an applicant</SheetTitle>
            <SheetDescription>
              For someone who applied in person, by email or through a referral.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () => addApplicantAction({ jobOpeningId, ...values }),
                () => {
                  setValues(blank);
                  setOpen(false);
                },
              );
            }}
          >
            <Field name="applicant-name" label="Full name">
              <Input
                id="applicant-name"
                required
                value={values.fullName}
                onChange={set('fullName')}
              />
            </Field>
            <Field name="applicant-email" label="Email">
              <Input
                id="applicant-email"
                type="email"
                required
                value={values.email}
                onChange={set('email')}
              />
            </Field>
            <Field name="applicant-phone" label="Phone (optional)">
              <Input id="applicant-phone" value={values.phone} onChange={set('phone')} />
            </Field>
            <Field name="applicant-note" label="Notes from their application (optional)">
              <Textarea
                id="applicant-note"
                rows={4}
                value={values.coverNote}
                onChange={set('coverNote')}
              />
            </Field>
            <ErrorNote error={error} />
            <SheetFooter className="mt-auto px-0">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Adding…' : 'Add applicant'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Moves an applicant between stages. Choosing "Not progressing" asks for a reason first. */
export function StageSelect({ id, stage, name }: { id: string; stage: Stage; name: string }) {
  const { run, error, isPending } = useRun();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  if (rejecting) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => moveApplicantAction({ id, stage: 'rejected', rejectionReason: reason }),
            () => setRejecting(false),
          );
        }}
      >
        <Input
          aria-label="Reason (kept for your records, not sent to the applicant)"
          placeholder="Reason (for your records)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-8"
        />
        <div className="flex gap-1.5">
          <Button type="submit" size="sm" variant="destructive" disabled={isPending}>
            Confirm
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </div>
        <ErrorNote error={error} />
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <NativeSelect
        aria-label={`Stage for ${name}`}
        value={stage}
        disabled={isPending}
        className="h-8"
        onChange={(event) => {
          const next = event.target.value as Stage;
          if (next === 'rejected') return setRejecting(true);
          run(() => moveApplicantAction({ id, stage: next }));
        }}
      >
        {STAGES.map((option) => (
          <option key={option} value={option}>
            {STAGE_LABELS[option]}
          </option>
        ))}
      </NativeSelect>
      <ErrorNote error={error} />
    </div>
  );
}

export function RatingStars({ id, rating }: { id: string; rating: number | null }) {
  const { run, isPending } = useRun();
  return (
    <div className="flex items-center" role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          key={value}
          type="button"
          disabled={isPending}
          aria-label={`${value} out of 5`}
          aria-pressed={rating === value}
          className="rounded p-0.5 text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() =>
            run(() => rateApplicantAction({ id, rating: rating === value ? null : value }))
          }
        >
          <Star
            aria-hidden
            className={cn(
              'size-4',
              rating !== null && value <= rating && 'fill-primary text-primary',
            )}
          />
        </button>
      ))}
    </div>
  );
}

export function ResumeButton({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await getResumeUrlAction({ id });
            if (!result.ok) return setError(result.error.message);
            window.open(result.data.url, '_blank', 'noopener');
          })
        }
      >
        <Paperclip aria-hidden /> Open résumé
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}

export function NoteForm({ applicantId }: { applicantId: string }) {
  const { run, error, isPending } = useRun();
  const [body, setBody] = useState('');
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => addApplicantNoteAction({ applicantId, body }),
          () => setBody(''),
        );
      }}
    >
      <Textarea
        aria-label="Add a note"
        placeholder="Screening call, interview feedback, reference check…"
        rows={3}
        required
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          Add note
        </Button>
      </div>
      <ErrorNote error={error} />
    </form>
  );
}

export function DeleteApplicantButton({ id, backTo }: { id: string; backTo: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Delete applicant
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm">This removes their details and résumé. It cannot be undone.</p>
      <div className="flex gap-1.5">
        <Button
          variant="destructive"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteApplicantAction({ id });
              if (!result.ok) return setError(result.error.message);
              router.replace(backTo);
              router.refresh();
            })
          }
        >
          Delete
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}
