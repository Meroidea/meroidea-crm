'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { RefreshCw, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { Field, fieldA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  createTemplateAction,
  deleteTemplateAction,
  refreshTemplatesAction,
} from '@/modules/social/actions';
import { createTemplateSchema, TEMPLATE_LANGUAGES } from '@/modules/social/schemas';

type FormValues = z.input<typeof createTemplateSchema>;

/** Brings the number's templates in line with WhatsApp Manager. */
export function RefreshTemplatesButton({ accountId }: { accountId: string }) {
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => run(() => refreshTemplatesAction({ accountId }))}
      >
        <RefreshCw aria-hidden className={isPending ? 'animate-spin' : undefined} /> Refresh
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}

export function DeleteTemplateButton({ templateId, name }: { templateId: string; name: string }) {
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        aria-label={`Delete template ${name}`}
        onClick={() => {
          if (
            window.confirm(
              `Delete the template “${name}” from WhatsApp? WhatsApp does not allow a new one with the same name for 30 days.`,
            )
          ) {
            run(() => deleteTemplateAction({ templateId }));
          }
        }}
      >
        <Trash2 aria-hidden /> Delete
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}

/** Counts the distinct {{n}} placeholders in what has been typed so far. */
function placeholderCount(body: string): number {
  return new Set([...body.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((match) => match[1])).size;
}

/**
 * A new template for Meta's review. Placeholders are typed as {{1}}, {{2}}…; each needs an
 * example, which Meta's reviewers read to judge it.
 */
export function NewTemplateForm({
  accounts,
}: {
  accounts: { id: string; name: string; phone: string | null }[];
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, FormValues>({
    resolver: zodResolver(createTemplateSchema, undefined, { raw: true }),
    defaultValues: {
      accountId: accounts[0]?.id ?? '',
      name: '',
      category: 'utility',
      language: 'en',
      body: '',
      examples: [],
      headerText: '',
      footerText: '',
    },
  });
  const body = useWatch({ control, name: 'body' }) ?? '';
  const count = Math.min(placeholderCount(body), 20);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSubmitted(null);
    const result = await createTemplateAction({
      ...values,
      examples: (values.examples ?? []).slice(0, count),
    });
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof FormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    setSubmitted(values.name);
    reset({ ...values, name: '', body: '', examples: [], headerText: '', footerText: '' });
    router.refresh();
  });

  const input = (name: keyof FormValues) => ({
    ...fieldA11y(name, errors[name]?.message as string | undefined),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      {accounts.length > 1 && (
        <Field
          name="accountId"
          label="WhatsApp number"
          error={errors.accountId?.message}
          className="sm:col-span-2"
        >
          <NativeSelect {...input('accountId')}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.phone ? ` (${account.phone})` : ''}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field
        name="name"
        label="Name"
        hint="Lower-case letters, numbers and underscores, e.g. order_ready"
        error={errors.name?.message}
        required
      >
        <Input autoComplete="off" {...input('name')} />
      </Field>
      <Field
        name="category"
        label="Kind"
        hint="Utility: about an order, booking or account. Marketing: offers and news (priced higher by Meta)."
        error={errors.category?.message}
        required
      >
        <NativeSelect {...input('category')}>
          <option value="utility">Utility</option>
          <option value="marketing">Marketing</option>
        </NativeSelect>
      </Field>
      <Field name="language" label="Language" error={errors.language?.message} required>
        <NativeSelect {...input('language')}>
          {Object.entries(TEMPLATE_LANGUAGES).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        name="headerText"
        label="Heading"
        hint="Optional, up to 60 characters"
        error={errors.headerText?.message}
      >
        <Input autoComplete="off" maxLength={60} {...input('headerText')} />
      </Field>
      <Field
        name="body"
        label="Message"
        hint="Use {{1}}, {{2}}… where a value goes, e.g. Hi {{1}}, your order {{2}} is ready to collect."
        error={errors.body?.message}
        required
        className="sm:col-span-2"
      >
        <Textarea rows={4} maxLength={1024} {...input('body')} />
      </Field>
      {Array.from({ length: count }, (_, index) => (
        <Field
          key={index}
          name={`examples.${index}`}
          label={`Example for {{${index + 1}}}`}
          error={errors.examples?.[index]?.message}
          required
        >
          <Input
            autoComplete="off"
            {...fieldA11y(`examples.${index}`, errors.examples?.[index]?.message)}
            {...register(`examples.${index}` as const)}
          />
        </Field>
      ))}
      {errors.examples?.message && (
        <p className="text-sm text-destructive-text sm:col-span-2">{errors.examples.message}</p>
      )}
      <Field
        name="footerText"
        label="Footer"
        hint="Optional, up to 60 characters, e.g. Reply STOP to opt out"
        error={errors.footerText?.message}
        className="sm:col-span-2"
      >
        <Input autoComplete="off" maxLength={60} {...input('footerText')} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
        <p className="text-xs text-muted-foreground">
          Meta reviews it, usually within minutes and at most a day. Its status updates here.
        </p>
        <Button type="submit" disabled={isSubmitting}>
          <Send aria-hidden /> {isSubmitting ? 'Submitting…' : 'Submit for review'}
        </Button>
      </div>
      {submitted && (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm sm:col-span-2">
          “{submitted}” was sent to Meta for review.
        </p>
      )}
      <div className="sm:col-span-2">
        <ErrorNote error={formError} />
      </div>
    </form>
  );
}
