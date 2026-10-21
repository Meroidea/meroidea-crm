'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Send } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { submitEnquiryAction } from '@/modules/enquiries/actions';
import {
  submitEnquirySchema,
  TEAM_SIZES,
  type SubmitEnquiryInput,
} from '@/modules/enquiries/schemas';

const EMPTY: SubmitEnquiryInput = {
  name: '',
  email: '',
  phone: '',
  company: '',
  businessType: '',
  teamSize: '',
  message: '',
  website: '',
};

export function ContactForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SubmitEnquiryInput, unknown, SubmitEnquiryInput>({
    // Submits what was typed; the Server Action parses it with the same schema.
    resolver: zodResolver(submitEnquirySchema, undefined, { raw: true }),
    defaultValues: EMPTY,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await submitEnquiryAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof SubmitEnquiryInput, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    setSentTo(values.name.trim().split(/\s+/)[0] ?? '');
    reset(EMPTY);
  });

  if (sentTo !== null) {
    return (
      <div
        role="status"
        className="flex min-h-80 animate-in flex-col items-center justify-center gap-3 text-center duration-500 zoom-in-95 fade-in motion-reduce:animate-none"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 aria-hidden className="size-7" />
        </span>
        <h3 className="text-xl font-semibold">Thanks{sentTo ? `, ${sentTo}` : ''}!</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your message is with the Meroidea team. We&rsquo;ll reply by email soon.
        </p>
        <Button variant="outline" className="mt-2" onClick={() => setSentTo(null)}>
          Send another message
        </Button>
      </div>
    );
  }

  const input = (name: keyof SubmitEnquiryInput) => ({
    ...fieldA11y(name, errors[name]?.message),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="relative grid gap-4 sm:grid-cols-2">
      <Field name="name" label="Your name" error={errors.name?.message} required>
        <Input autoComplete="name" {...input('name')} />
      </Field>
      <Field name="company" label="Business name" error={errors.company?.message} required>
        <Input autoComplete="organization" {...input('company')} />
      </Field>
      <Field name="email" label="Work email" error={errors.email?.message} required>
        <Input type="email" autoComplete="email" {...input('email')} />
      </Field>
      <Field name="phone" label="Phone" error={errors.phone?.message}>
        <Input type="tel" autoComplete="tel" {...input('phone')} />
      </Field>
      <Field
        name="businessType"
        label="What does your business do?"
        error={errors.businessType?.message}
      >
        <Input placeholder="e.g. a cafe, a consultancy, a shop" {...input('businessType')} />
      </Field>
      <Field name="teamSize" label="Team size" error={errors.teamSize?.message}>
        <NativeSelect {...input('teamSize')}>
          <option value="">Choose…</option>
          {TEAM_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        name="message"
        label="How can we help?"
        error={errors.message?.message}
        required
        className="sm:col-span-2"
      >
        <Textarea
          rows={4}
          placeholder="What do you use today, and what would you like to run more smoothly?"
          {...input('message')}
        />
      </Field>

      {/* Honeypot: hidden from people and screen readers; bots tend to fill every field. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" tabIndex={-1} autoComplete="off" {...register('website')} />
      </div>

      {formError && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text sm:col-span-2"
        >
          {formError}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          We use your details only to reply to you. No newsletters.
        </p>
        <Button type="submit" size="lg" disabled={isSubmitting} className="group">
          {isSubmitting ? 'Sending…' : 'Send message'}
          <Send
            aria-hidden
            className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
          />
        </Button>
      </div>
    </form>
  );
}
