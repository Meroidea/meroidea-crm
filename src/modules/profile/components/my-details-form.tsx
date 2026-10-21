'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateMyProfileAction } from '@/modules/profile/actions';
import { updateMyProfileSchema, type UpdateMyProfileInput } from '@/modules/profile/schemas';

export function MyDetailsForm({
  fullName,
  email,
  phone,
}: {
  fullName: string;
  email: string;
  phone: string | null;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateMyProfileInput, unknown, UpdateMyProfileInput>({
    // Submits what was typed; the Server Action parses it with the same schema.
    resolver: zodResolver(updateMyProfileSchema, undefined, { raw: true }),
    defaultValues: { fullName, phone: phone ?? '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    const result = await updateMyProfileAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof UpdateMyProfileInput, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    // What was saved is the new starting point, so the form is no longer "changed".
    reset(values);
    setSaved(true);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field name="fullName" label="Full name" error={errors.fullName?.message} required>
        <Input
          autoComplete="name"
          {...fieldA11y('fullName', errors.fullName?.message)}
          {...register('fullName')}
        />
      </Field>
      <Field name="phone" label="Phone" error={errors.phone?.message}>
        <Input
          type="tel"
          autoComplete="tel"
          {...fieldA11y('phone', errors.phone?.message)}
          {...register('phone')}
        />
      </Field>
      <Field
        name="email"
        label="Email"
        hint="This is how you sign in. Ask your workspace admin if it needs to change."
        className="sm:col-span-2"
      >
        <Input id="email" type="email" value={email} readOnly disabled data-sensitive />
      </Field>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </Button>
        {saved && !isDirty && (
          <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check aria-hidden className="size-4" /> Saved
          </p>
        )}
        {formError && (
          <p role="alert" className="text-sm text-destructive-text">
            {formError}
          </p>
        )}
      </div>
    </form>
  );
}
