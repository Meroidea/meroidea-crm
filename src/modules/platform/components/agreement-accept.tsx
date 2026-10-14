'use client';

import { useState, useTransition } from 'react';

import { Field, fieldA11y } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { acceptAgreementAction } from '@/modules/platform/public-actions';

/** The business admin's acceptance of the service agreement, from its one-time page. */
export function AcceptAgreement({ token, businessName }: { token: string; businessName: string }) {
  const [fullName, setFullName] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [isPending, startTransition] = useTransition();

  const accept = () =>
    startTransition(async () => {
      setError(null);
      const result = await acceptAgreementAction({ token, fullName, agree });
      if (!result.ok) {
        setError(
          result.error.fieldErrors?.fullName?.[0] ??
            result.error.fieldErrors?.agree?.[0] ??
            result.error.message,
        );
        return;
      }
      if (result.data.passwordLink) {
        // Signs them in once and takes them to choose their password (ADR-031).
        window.location.assign(result.data.passwordLink);
      } else {
        setAccepted(true);
      }
    });

  if (accepted) {
    return (
      <p role="status" className="text-sm">
        Accepted. To sign in, use “Forgot password” on the sign-in page with this email address to
        choose your password.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        accept();
      }}
    >
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={agree}
          onChange={(event) => setAgree(event.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        I have read this agreement and accept it on behalf of {businessName}, and I am authorised to
        do so.
      </label>
      <Field
        name="fullName"
        label="Type your full name to accept"
        hint="Recorded with the date, time, network address and browser as your acceptance."
        error={error ?? undefined}
      >
        <Input
          autoComplete="name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          {...fieldA11y('fullName', error ?? undefined)}
        />
      </Field>
      <Button
        type="submit"
        size="lg"
        className="self-start"
        disabled={!agree || fullName.trim().length < 2 || isPending}
      >
        {isPending ? 'Accepting…' : 'Accept and choose my password'}
      </Button>
    </form>
  );
}
