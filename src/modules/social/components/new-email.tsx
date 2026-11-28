'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PenSquare, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Field } from '@/components/forms/field';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { startEmailAction } from '@/modules/social/actions';

import { newEmailSchema } from '../schemas';

type FormValues = z.input<typeof newEmailSchema>;
type SubmitValues = z.output<typeof newEmailSchema>;

export type EmailInboxOption = { id: string; address: string; name: string };

/**
 * Writes a new email from one of the business's inbox addresses to anyone (ADR-089). It opens
 * as its own thread, which waits in Sent until the person answers.
 */
export function NewEmail({ inboxes }: { inboxes: EmailInboxOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run, error, isPending, setError } = useActionRunner();
  const form = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(newEmailSchema),
    defaultValues: { accountId: inboxes[0]?.id ?? '', to: '', subject: '', body: '' },
  });
  const errors = form.formState.errors;
  if (inboxes.length === 0) return null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm">
          <PenSquare aria-hidden /> New email
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>New email</SheetTitle>
          <SheetDescription>
            Their reply comes back to this thread. For one person at a time: marketing to many
            people belongs in campaigns, with their consent.
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-col gap-3 px-4 pb-6"
          onSubmit={form.handleSubmit((values) =>
            run(
              () => startEmailAction(values),
              (data) => {
                form.reset({ accountId: values.accountId, to: '', subject: '', body: '' });
                setOpen(false);
                router.push(`/email/${data.conversationId}`);
              },
            ),
          )}
        >
          {inboxes.length > 1 ? (
            <Field name="accountId" label="From" error={errors.accountId?.message}>
              <select
                id="accountId"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                {...form.register('accountId')}
              >
                {inboxes.map((inbox) => (
                  <option key={inbox.id} value={inbox.id}>
                    {inbox.name} &lt;{inbox.address}&gt;
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">
              From <span className="font-medium text-foreground">{inboxes[0]!.name}</span> &lt;
              {inboxes[0]!.address}&gt;
            </p>
          )}
          <Field name="to" label="To" error={errors.to?.message}>
            <Input
              id="to"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="name@example.com"
              {...form.register('to')}
            />
          </Field>
          <Field name="subject" label="Subject" error={errors.subject?.message}>
            <Input id="subject" maxLength={200} {...form.register('subject')} />
          </Field>
          <Field name="body" label="Message" error={errors.body?.message}>
            <Textarea id="body" rows={12} maxLength={20000} {...form.register('body')} />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" className="w-fit" disabled={isPending}>
            <Send aria-hidden /> {isPending ? 'Sending…' : 'Send'}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
