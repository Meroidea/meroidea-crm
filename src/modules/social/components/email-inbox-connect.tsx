'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Field } from '@/components/forms/field';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createEmailInboxAction } from '@/modules/social/actions';

import { emailInboxSchema } from '../schemas';

type FormValues = z.input<typeof emailInboxSchema>;
type SubmitValues = z.output<typeof emailInboxSchema>;

/**
 * Creates an email inbox (ADR-070): an address at the platform's inbox domain whose mail arrives
 * in the inbox. The business publishes it, or forwards its own address to it.
 */
export function EmailInboxConnect({
  domain,
  defaultName,
  defaultLocal,
  contactLabel,
  crm,
}: {
  domain: string;
  defaultName: string;
  defaultLocal: string;
  contactLabel: string;
  crm: boolean;
}) {
  const { run, error, isPending } = useActionRunner();
  const [created, setCreated] = useState<string | null>(null);
  const form = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(emailInboxSchema),
    defaultValues: { name: defaultName, localPart: defaultLocal, createLeadForUnknown: crm },
  });
  const errors = form.formState.errors;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={form.handleSubmit((values) =>
        run(
          () => createEmailInboxAction(values),
          (data) => {
            setCreated(data.address);
            form.reset({ ...values, localPart: '' });
          },
        ),
      )}
    >
      <Field
        name="name"
        label="Shown as"
        error={errors.name?.message}
        hint="The sender's name on replies."
      >
        <Input id="name" {...form.register('name')} />
      </Field>
      <Field name="localPart" label="Address" error={errors.localPart?.message}>
        <div className="flex items-center gap-1">
          <Input id="localPart" className="min-w-0" {...form.register('localPart')} />
          <span className="shrink-0 text-sm text-muted-foreground">@{domain}</span>
        </div>
      </Field>
      {crm && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            {...form.register('createLeadForUnknown')}
          />
          Make a new lead when someone who is not a {contactLabel.toLowerCase()} writes
        </label>
      )}
      <ErrorNote error={error} />
      {created && (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm">
          Created <span className="font-medium">{created}</span>. Publish it, or forward your own
          support address to it; replies are sent from it.
        </p>
      )}
      <Button type="submit" className="w-fit" disabled={isPending}>
        <Mail aria-hidden /> {isPending ? 'Creating…' : 'Create email inbox'}
      </Button>
    </form>
  );
}
