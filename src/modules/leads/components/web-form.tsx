'use client';

import { CheckCircle2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Fields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  jobTitle: string;
  message: string;
};

/** A business's public enquiry form: what it asks for is set in Settings → Forms. */
export function WebForm({
  formKey,
  businessName,
  askCompany,
  askMessage,
  askConsent,
  thankYouMessage,
  utm,
  initiallySent,
  initiallyFailed,
}: {
  formKey: string;
  businessName: string;
  askCompany: boolean;
  askMessage: boolean;
  askConsent: boolean;
  thankYouMessage: string | null;
  utm: Record<string, string>;
  initiallySent: boolean;
  initiallyFailed: boolean;
}) {
  const [fields, setFields] = useState<Fields>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    companyName: '',
    jobTitle: '',
    message: '',
  });
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [done, setDone] = useState(initiallySent);
  const [error, setError] = useState<string | null>(
    initiallyFailed ? 'Your enquiry was not sent. Check the details and try again.' : null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();

  if (done) {
    return (
      <div role="status" className="flex flex-col items-center gap-2 py-8 text-center">
        <CheckCircle2 aria-hidden className="size-10 text-primary" />
        <p className="text-lg font-semibold">Thank you</p>
        <p className="max-w-sm text-sm whitespace-pre-line text-muted-foreground">
          {thankYouMessage ?? `${businessName} has your enquiry and will be in touch soon.`}
        </p>
      </div>
    );
  }

  const field = (
    name: keyof Fields,
    label: string,
    options: { type?: string; autoComplete?: string; required?: boolean; maxLength?: number } = {},
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`wf-${name}`}>
        {label}
        {options.required && <span className="text-destructive-text"> *</span>}
      </Label>
      <Input
        id={`wf-${name}`}
        type={options.type ?? 'text'}
        autoComplete={options.autoComplete}
        required={options.required}
        maxLength={options.maxLength ?? 120}
        value={fields[name]}
        aria-invalid={Boolean(fieldErrors[name])}
        onChange={(event) => setFields({ ...fields, [name]: event.target.value })}
      />
      {fieldErrors[name] && (
        <p className="text-xs text-destructive-text">{fieldErrors[name]?.[0]}</p>
      )}
    </div>
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          setFieldErrors({});
          try {
            const response = await fetch(`/api/forms/${formKey}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ...fields, consent, website, ...utm }),
            });
            const reply = (await response.json()) as {
              ok: boolean;
              error?: { message: string; fieldErrors?: Record<string, string[]> };
            };
            if (reply.ok) return setDone(true);
            setFieldErrors(reply.error?.fieldErrors ?? {});
            setError(reply.error?.message ?? 'Something went wrong. Try again.');
          } catch {
            setError('Could not send your enquiry. Check your connection and try again.');
          }
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {field('firstName', 'First name', {
          autoComplete: 'given-name',
          required: true,
          maxLength: 80,
        })}
        {field('lastName', 'Last name', { autoComplete: 'family-name', maxLength: 80 })}
        {field('email', 'Email', {
          type: 'email',
          autoComplete: 'email',
          required: true,
          maxLength: 200,
        })}
        {field('phone', 'Phone', { type: 'tel', autoComplete: 'tel', maxLength: 40 })}
        {askCompany &&
          field('companyName', 'Company', { autoComplete: 'organization', maxLength: 160 })}
        {askCompany && field('jobTitle', 'Job title', { autoComplete: 'organization-title' })}
      </div>
      {askMessage && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wf-message">How can we help?</Label>
          <Textarea
            id="wf-message"
            rows={4}
            maxLength={4000}
            value={fields.message}
            onChange={(event) => setFields({ ...fields, message: event.target.value })}
          />
        </div>
      )}
      {askConsent && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            {businessName} may send me news and offers by email. I can unsubscribe at any time.
          </span>
        </label>
      )}
      {/* Hidden from people; scripts that fill every field give themselves away. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label>
          Website
          <input
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? 'Sending…' : 'Send enquiry'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Your details go only to {businessName}.
      </p>
    </form>
  );
}
