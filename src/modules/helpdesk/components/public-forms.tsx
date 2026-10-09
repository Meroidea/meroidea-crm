'use client';

import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Reply<T> = {
  ok: boolean;
  data?: T;
  error?: { message: string; fieldErrors?: Record<string, string[]> };
};

async function post<T>(url: string, body: unknown): Promise<Reply<T>> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Reply<T>;
  } catch {
    return {
      ok: false,
      error: { message: 'Could not send. Check your connection and try again.' },
    };
  }
}

/** The public "contact support" form. On success it shows the link to follow the request. */
export function SupportForm({ token }: { token: string }) {
  const blank = {
    requesterName: '',
    requesterEmail: '',
    subject: '',
    description: '',
    website: '',
  };
  const [values, setValues] = useState(blank);
  const [created, setCreated] = useState<
    { number: number; ticketToken: string } | 'received' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();
  const set = (key: keyof typeof blank) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  if (created) {
    return (
      <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 aria-hidden className="size-10 text-primary" />
        <p className="text-lg font-semibold">
          {created === 'received' ? 'Request received' : `Request #${created.number} received`}
        </p>
        <p className="text-sm text-muted-foreground">
          Thank you. The team will get back to you as soon as they can.
        </p>
        {created !== 'received' && (
          <>
            <Button asChild className="mt-2">
              <Link href={`/support/ticket/${created.ticketToken}`}>Follow your request</Link>
            </Button>
            <p className="text-xs text-muted-foreground">
              Keep that page’s address: it is how you see replies and write back.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          setFieldErrors({});
          const reply = await post<{ number: number; ticketToken: string } | null>(
            `/api/support/${token}`,
            values,
          );
          if (reply.ok) return setCreated(reply.data ?? 'received');
          setFieldErrors(reply.error?.fieldErrors ?? {});
          setError(reply.error?.message ?? 'Something went wrong. Try again.');
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="requesterName"
          label="Your name"
          required
          error={fieldErrors.requesterName?.[0]}
        >
          <Input
            id="requesterName"
            autoComplete="name"
            required
            value={values.requesterName}
            onChange={set('requesterName')}
          />
        </Field>
        <Field name="requesterEmail" label="Email" required error={fieldErrors.requesterEmail?.[0]}>
          <Input
            id="requesterEmail"
            type="email"
            autoComplete="email"
            required
            value={values.requesterEmail}
            onChange={set('requesterEmail')}
          />
        </Field>
      </div>
      <Field name="subject" label="Subject" required error={fieldErrors.subject?.[0]}>
        <Input
          id="subject"
          required
          maxLength={160}
          value={values.subject}
          onChange={set('subject')}
        />
      </Field>
      <Field
        name="description"
        label="How can we help?"
        required
        error={fieldErrors.description?.[0]}
      >
        <Textarea
          id="description"
          rows={6}
          required
          maxLength={8000}
          value={values.description}
          onChange={set('description')}
        />
      </Field>
      {/* Hidden from people; scripts that fill every field give themselves away. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label>
          Website
          <input
            tabIndex={-1}
            autoComplete="off"
            value={values.website}
            onChange={set('website')}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? 'Sending…' : 'Send request'}
      </Button>
    </form>
  );
}

/** The customer's reply box on their own ticket page. */
export function CustomerReply({ token }: { token: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          const reply = await post(`/api/support/ticket/${token}`, { body });
          if (!reply.ok)
            return setError(reply.error?.message ?? 'Something went wrong. Try again.');
          setBody('');
          router.refresh();
        });
      }}
    >
      <Textarea
        aria-label="Your reply"
        placeholder="Write a reply…"
        rows={4}
        required
        maxLength={8000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Sending…' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}
