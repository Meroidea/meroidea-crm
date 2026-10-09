'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { FormSection } from '@/components/forms/form-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Label as ObjectLabel } from '@/lib/tenant/labels';
import {
  createOrganizationAction,
  updateOrganizationAction,
} from '@/modules/organizations/actions';
import {
  organizationFieldsSchema,
  type OrganizationFormValues,
  type OrganizationInput,
} from '@/modules/organizations/schemas';

export function OrganizationForm({
  organizationId,
  defaults,
  label,
  knownTypes,
}: {
  organizationId?: string;
  defaults: OrganizationFormValues;
  label: ObjectLabel;
  knownTypes: string[];
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OrganizationFormValues, unknown, OrganizationInput>({
    resolver: zodResolver(organizationFieldsSchema),
    defaultValues: defaults,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = organizationId
      ? await updateOrganizationAction({ ...values, id: organizationId })
      : await createOrganizationAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof OrganizationFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    router.push(`/organizations/${result.data.id}`);
    router.refresh();
  });

  const text = (
    name: keyof OrganizationFormValues,
    fieldLabel: string,
    extra: { type?: string; hint?: string; required?: boolean; maxLength?: number } = {},
  ) => (
    <Field
      name={name}
      label={fieldLabel}
      error={errors[name]?.message}
      hint={extra.hint}
      required={extra.required}
    >
      <Input
        type={extra.type ?? 'text'}
        maxLength={extra.maxLength}
        autoComplete="off"
        {...fieldA11y(name, errors[name]?.message)}
        {...register(name)}
      />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection title="About" description={`What this ${label.singular.toLowerCase()} is.`}>
        {text('name', 'Name', { required: true })}
        <Field
          name="type"
          label="Type"
          hint="e.g. partner, supplier, client — your own words"
          error={errors.type?.message}
        >
          <Input
            list="organization-types"
            autoComplete="off"
            {...fieldA11y('type', errors.type?.message)}
            {...register('type')}
          />
          <datalist id="organization-types">
            {knownTypes.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
        </Field>
        {text('website', 'Website', { type: 'url', hint: 'https://…' })}
      </FormSection>
      <FormSection title="Contact details">
        {text('email', 'Email', { type: 'email' })}
        {text('phone', 'Phone', { type: 'tel' })}
        {text('addressLine', 'Address')}
        {text('city', 'City')}
        {text('region', 'State / region')}
        {text('country', 'Country', { hint: '2-letter code, e.g. AU', maxLength: 2 })}
      </FormSection>

      {formError && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          {formError}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? 'Saving…'
            : organizationId
              ? 'Save changes'
              : `Create ${label.singular.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}
