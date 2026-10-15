'use client';

import { CheckCircle2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { RenderedField } from '@/modules/leads/form-fields';

type Value = string | boolean | string[];

const AUTOCOMPLETE: Record<string, string> = {
  firstName: 'given-name',
  lastName: 'family-name',
  email: 'email',
  phone: 'tel',
  city: 'address-level2',
  region: 'address-level1',
  companyName: 'organization',
  jobTitle: 'organization-title',
  companyWebsite: 'url',
};

const INPUT_TYPE: Partial<Record<RenderedField['kind'], string>> = {
  email: 'email',
  phone: 'tel',
  url: 'url',
  number: 'number',
  date: 'date',
};

function FieldInput({
  field,
  value,
  onChange,
  invalid,
}: {
  field: RenderedField;
  value: Value | undefined;
  onChange: (value: Value) => void;
  invalid: boolean;
}) {
  const id = `wf-${field.id}`;
  const describedBy = field.help ? `${id}-help` : undefined;
  if (field.kind === 'checkbox') {
    return (
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-primary"
        checked={value === true}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }
  if (field.kind === 'textarea') {
    return (
      <Textarea
        id={id}
        rows={4}
        maxLength={field.max}
        value={typeof value === 'string' ? value : ''}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.kind === 'select') {
    return (
      <NativeSelect
        id={id}
        value={typeof value === 'string' ? value : ''}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose…</option>
        {field.choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </NativeSelect>
    );
  }
  if (field.kind === 'multi_select') {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-col gap-1.5" role="group" aria-labelledby={`${id}-label`}>
        {field.choices.map((choice) => (
          <label key={choice.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={chosen.includes(choice.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...chosen, choice.value]
                    : chosen.filter((item) => item !== choice.value),
                )
              }
            />
            {choice.label}
          </label>
        ))}
      </div>
    );
  }
  return (
    <Input
      id={id}
      type={INPUT_TYPE[field.kind] ?? 'text'}
      autoComplete={AUTOCOMPLETE[field.target]}
      maxLength={field.kind === 'number' || field.kind === 'date' ? undefined : field.max}
      value={typeof value === 'string' ? value : ''}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * A business's website form, drawn from the fields its admin built (docs/leads.md §3.1). The
 * builder shows the same component as a live preview, where it cannot be sent.
 */
export function WebForm({
  formKey,
  businessName,
  fields,
  submitLabel,
  thankYouMessage,
  utm = {},
  initiallySent = false,
  initiallyFailed = false,
  preview = false,
}: {
  formKey?: string;
  businessName: string;
  fields: RenderedField[];
  submitLabel: string | null;
  thankYouMessage: string | null;
  utm?: Record<string, string>;
  initiallySent?: boolean;
  initiallyFailed?: boolean;
  preview?: boolean;
}) {
  const [values, setValues] = useState<Record<string, Value>>({});
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

  const half = (field: RenderedField) =>
    ['text', 'email', 'phone', 'url', 'number', 'date', 'select'].includes(field.kind);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (preview || !formKey) return;
        startTransition(async () => {
          setError(null);
          setFieldErrors({});
          try {
            const response = await fetch(`/api/forms/${formKey}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ...values, website, ...utm }),
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
        {fields.map((field) => {
          const id = `wf-${field.id}`;
          const problem = fieldErrors[field.target]?.[0];
          const control = (
            <FieldInput
              field={field}
              value={values[field.target]}
              invalid={Boolean(problem)}
              onChange={(value) => setValues((current) => ({ ...current, [field.target]: value }))}
            />
          );
          const label = (
            <>
              {field.label}
              {field.required && <span className="text-destructive-text"> *</span>}
            </>
          );
          return (
            <div
              key={field.id}
              className={cn('flex flex-col gap-1.5', !half(field) && 'sm:col-span-2')}
            >
              {field.kind === 'checkbox' ? (
                <label htmlFor={id} className="flex items-start gap-2 text-sm">
                  {control}
                  <span>{label}</span>
                </label>
              ) : (
                <>
                  <Label htmlFor={id} id={`${id}-label`}>
                    {label}
                  </Label>
                  {control}
                </>
              )}
              {field.help && (
                <p id={`${id}-help`} className="text-xs text-muted-foreground">
                  {field.help}
                </p>
              )}
              {problem && <p className="text-xs text-destructive-text">{problem}</p>}
            </div>
          );
        })}
      </div>
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
      <Button type="submit" size="lg" disabled={isPending || preview}>
        {isPending ? 'Sending…' : submitLabel || 'Send enquiry'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        {preview
          ? 'Preview — this form cannot be sent from here.'
          : `Your details go only to ${businessName}.`}
      </p>
    </form>
  );
}
