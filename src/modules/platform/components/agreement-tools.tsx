'use client';

import { FileSignature, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Field, fieldA11y } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  publishAgreementAction,
  resendAgreementLinkAction,
  updateBusinessIdentityAction,
} from '@/modules/platform/actions';

import { LinkHandover } from './platform-tools';

type Identity = {
  companyName: string;
  legalName: string;
  businessNumber: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
};

/** Who the business is. Only the platform owner can change it (ADR-047). */
export function BusinessIdentityForm({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: Identity;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const field = (key: keyof Identity, label: string, type = 'text') => (
    <Field name={`identity-${key}`} label={label} error={errors[key]?.[0]}>
      <Input
        type={type}
        autoComplete="off"
        value={values[key]}
        onChange={(event) => setValues({ ...values, [key]: event.target.value })}
        {...fieldA11y(`identity-${key}`, errors[key]?.[0])}
      />
    </Field>
  );

  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="font-medium">Business details</h2>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">
        Their admin sees these but cannot change them. Payslips already made keep the details
        printed on them.
      </p>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await updateBusinessIdentityAction({ tenantId, ...values });
            setErrors(result.ok ? {} : (result.error.fieldErrors ?? {}));
            setNote(result.ok ? 'Saved.' : result.error.message);
            if (result.ok) router.refresh();
          });
        }}
      >
        {field('companyName', 'Business name')}
        {field('legalName', 'Legal name')}
        {field('businessNumber', 'ABN')}
        {field('primaryContactName', 'Primary contact')}
        {field('primaryContactEmail', 'Contact email', 'email')}
        {field('primaryContactPhone', 'Contact phone', 'tel')}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={isPending}>
            Save details
          </Button>
          {note && (
            <p role="status" className="text-sm text-muted-foreground">
              {note}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

/** Where the business stands with the service agreement, and a way to send a fresh link. */
export function AgreementStatus({
  tenantId,
  summary,
  waiting,
  recipientEmail,
}: {
  tenantId: string;
  /** Already worded and dated by the page, in the platform owner's terms. */
  summary: string;
  waiting: boolean;
  recipientEmail: string | null;
}) {
  const router = useRouter();
  const [sent, setSent] = useState<{ emailed: boolean; link: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <div>
        <h2 className="flex items-center gap-2 font-medium">
          <FileSignature aria-hidden className="size-4" /> Service agreement
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
      </div>
      {waiting && !sent && (
        <Button
          variant="outline"
          className="self-start"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await resendAgreementLinkAction({ tenantId });
              if (!result.ok) return setError(result.error.message);
              setSent(result.data);
              router.refresh();
            })
          }
        >
          <Send aria-hidden /> Send a new link
        </Button>
      )}
      {sent && <LinkHandover emailed={sent.emailed} link={sent.link} to={recipientEmail ?? ''} />}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </section>
  );
}

/** Publishes new wording as the next version of the service agreement. */
export function PublishAgreementForm({ initialTitle }: { initialTitle: string }) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !window.confirm(
            'Publish this as a new version? It cannot be edited afterwards; links sent from now on use it.',
          )
        )
          return;
        startTransition(async () => {
          const result = await publishAgreementAction({ title, body });
          setErrors(result.ok ? {} : (result.error.fieldErrors ?? {}));
          if (!result.ok) return setNote(result.error.message);
          setNote(`Published as version ${result.data.version}.`);
          setBody('');
          router.refresh();
        });
      }}
    >
      <Field name="agreement-title" label="Title" error={errors.title?.[0]}>
        <Input
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          {...fieldA11y('agreement-title', errors.title?.[0])}
        />
      </Field>
      <Field
        name="agreement-body"
        label="Full wording"
        hint="A line starting with “## ” becomes a heading; a blank line starts a new paragraph."
        error={errors.body?.[0]}
      >
        <Textarea
          rows={16}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          {...fieldA11y('agreement-body', errors.body?.[0])}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          Publish new version
        </Button>
        {note && (
          <p role="status" className="text-sm text-muted-foreground">
            {note}
          </p>
        )}
      </div>
    </form>
  );
}
