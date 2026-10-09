'use client';

import { Check, Copy, Lock, Plus, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Field } from '@/components/forms/field';
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
  createTicketAction,
  deleteTicketAction,
  replyToTicketAction,
  setFormOpenAction,
  updateTicketAction,
} from '@/modules/helpdesk/actions';
import {
  CATEGORIES,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUSES,
  type Priority,
  type TicketStatus,
} from '@/modules/helpdesk/schemas';

type Person = { userId: string; fullName: string };
type Failure = { ok: false; error: { message: string; fieldErrors?: Record<string, string[]> } };

const firstError = (result: Failure) =>
  Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message;

const ErrorNote = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="text-sm text-destructive-text">
      {error}
    </p>
  ) : null;

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} aria-label={label} className="h-8" />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export function NewTicketButton({ people }: { people: Person[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const blank = {
    requesterName: '',
    requesterEmail: '',
    subject: '',
    description: '',
    priority: 'normal' as Priority,
    category: '',
    assigneeUserId: '',
  };
  const [values, setValues] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set = (key: keyof typeof blank) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> New ticket
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>New ticket</SheetTitle>
            <SheetDescription>
              For a request that came in by phone, in person or by email.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                setError(null);
                const result = await createTicketAction(values);
                if (!result.ok) return setError(firstError(result));
                setOpen(false);
                setValues(blank);
                router.push(`/helpdesk/${result.data.id}`);
              });
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field name="ticket-name" label="Customer">
                <Input
                  id="ticket-name"
                  required
                  value={values.requesterName}
                  onChange={set('requesterName')}
                />
              </Field>
              <Field name="ticket-email" label="Email (optional)">
                <Input
                  id="ticket-email"
                  type="email"
                  value={values.requesterEmail}
                  onChange={set('requesterEmail')}
                />
              </Field>
            </div>
            <Field name="ticket-subject" label="Subject">
              <Input
                id="ticket-subject"
                required
                value={values.subject}
                onChange={set('subject')}
              />
            </Field>
            <Field name="ticket-description" label="What do they need?">
              <Textarea
                id="ticket-description"
                rows={5}
                required
                value={values.description}
                onChange={set('description')}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field name="ticket-priority" label="Priority">
                <NativeSelect
                  id="ticket-priority"
                  value={values.priority}
                  onChange={set('priority')}
                >
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field name="ticket-category" label="Category">
                <Input
                  id="ticket-category"
                  list="ticket-categories"
                  value={values.category}
                  onChange={set('category')}
                />
              </Field>
            </div>
            <Field name="ticket-assignee" label="Assign to">
              <NativeSelect
                id="ticket-assignee"
                value={values.assigneeUserId}
                onChange={set('assigneeUserId')}
              >
                <option value="">Nobody yet</option>
                {people.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.fullName}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <datalist id="ticket-categories">
              {CATEGORIES.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
            <ErrorNote error={error} />
            <SheetFooter className="mt-auto px-0">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Creating…' : 'Create ticket'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Switches the public contact form on or off, and shows its address while it is on. */
export function PublicFormCard({
  url,
  isOpen,
  canManage,
}: {
  url: string | null;
  isOpen: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set = (next: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await setFormOpenAction({ isOpen: next });
      if (!result.ok) setError(firstError(result));
      router.refresh();
    });

  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Public contact form</h2>
          <p className="text-sm text-muted-foreground">
            {isOpen
              ? 'Customers who use this address create a ticket and get a page to follow it.'
              : 'Switch it on to get an address customers can use to ask for help.'}
          </p>
        </div>
        {canManage && (
          <Button
            size="sm"
            variant={isOpen ? 'outline' : 'default'}
            disabled={isPending}
            onClick={() => set(!isOpen)}
          >
            {isOpen ? 'Switch off' : 'Switch on'}
          </Button>
        )}
      </div>
      {isOpen && url && <CopyField value={url} label="Contact form address" />}
      <ErrorNote error={error} />
    </section>
  );
}

/** The reply box: answer the customer, or keep a private note for the team. */
export function ReplyBox({
  ticketId,
  hasEmail,
  customerLink,
}: {
  ticketId: string;
  hasEmail: boolean;
  customerLink: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<TicketStatus>('pending');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<'emailed' | 'link' | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-4',
        mode === 'note' && 'border-warning-border bg-warning/40',
      )}
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          setSent(null);
          const result = await replyToTicketAction({
            ticketId,
            body,
            isInternal: mode === 'note',
            status: mode === 'reply' ? status : undefined,
          });
          if (!result.ok) return setError(firstError(result));
          setBody('');
          if (mode === 'reply') setSent(result.data.emailed ? 'emailed' : 'link');
          router.refresh();
        });
      }}
    >
      <div role="tablist" aria-label="What to write" className="flex gap-1">
        {(
          [
            ['reply', 'Reply to customer'],
            ['note', 'Private note'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
              mode === key && 'bg-accent font-medium text-foreground',
            )}
          >
            {key === 'note' && <Lock aria-hidden className="size-3.5" />}
            {label}
          </button>
        ))}
      </div>
      <Textarea
        aria-label={mode === 'reply' ? 'Reply to the customer' : 'Private note'}
        placeholder={mode === 'reply' ? 'Write your reply…' : 'Only your team sees this…'}
        rows={5}
        required
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={isPending}>
          <Send aria-hidden /> {mode === 'reply' ? 'Send reply' : 'Add note'}
        </Button>
        {mode === 'reply' && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            and set to
            <NativeSelect
              aria-label="Status after replying"
              value={status}
              onChange={(event) => setStatus(event.target.value as TicketStatus)}
              className="h-8 w-auto"
            >
              {(['pending', 'open', 'on_hold', 'solved'] as const).map((option) => (
                <option key={option} value={option}>
                  {STATUS_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
      </div>
      <ErrorNote error={error} />
      {sent === 'emailed' && (
        <p role="status" className="text-sm text-muted-foreground">
          Sent, and emailed to the customer.
        </p>
      )}
      {sent === 'link' && (
        <div role="status" className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <p>
            Saved.{' '}
            {hasEmail
              ? 'Email is not set up, so nothing was sent.'
              : 'This customer has no email on the ticket.'}{' '}
            They can read it on their ticket page:
          </p>
          <CopyField value={customerLink} label="Customer's ticket page" />
        </div>
      )}
    </form>
  );
}

/** Status, priority, category and who is working on it. */
export function TicketControls({
  ticket,
  people,
  canDelete,
}: {
  ticket: {
    id: string;
    status: TicketStatus;
    priority: Priority;
    category: string | null;
    assigneeUserId: string | null;
  };
  people: Person[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [category, setCategory] = useState(ticket.category ?? '');
  const update = (changes: Record<string, string>) =>
    startTransition(async () => {
      setError(null);
      const result = await updateTicketAction({ id: ticket.id, ...changes });
      if (!result.ok) setError(firstError(result));
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <Field name="control-status" label="Status">
        <NativeSelect
          id="control-status"
          value={ticket.status}
          disabled={isPending}
          onChange={(event) => update({ status: event.target.value })}
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field name="control-assignee" label="Assigned to">
        <NativeSelect
          id="control-assignee"
          value={ticket.assigneeUserId ?? ''}
          disabled={isPending}
          onChange={(event) => update({ assigneeUserId: event.target.value })}
        >
          <option value="">Nobody</option>
          {people.map((person) => (
            <option key={person.userId} value={person.userId}>
              {person.fullName}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field name="control-priority" label="Priority">
        <NativeSelect
          id="control-priority"
          value={ticket.priority}
          disabled={isPending}
          onChange={(event) => update({ priority: event.target.value })}
        >
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field name="control-category" label="Category">
        <Input
          id="control-category"
          list="control-categories"
          value={category}
          disabled={isPending}
          onChange={(event) => setCategory(event.target.value)}
          onBlur={() => category !== (ticket.category ?? '') && update({ category })}
        />
        <datalist id="control-categories">
          {CATEGORIES.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </Field>
      <ErrorNote error={error} />
      {canDelete && (
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          className="self-start"
          onClick={() => {
            if (!window.confirm('Delete this ticket and its messages?')) return;
            startTransition(async () => {
              const result = await deleteTicketAction({ id: ticket.id });
              if (!result.ok) return setError(firstError(result));
              router.replace('/helpdesk');
            });
          }}
        >
          Delete ticket
        </Button>
      )}
    </div>
  );
}
