'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { FormSection } from '@/components/forms/form-section';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Label as ObjectLabel } from '@/lib/tenant/labels';
import {
  checkContactDuplicatesAction,
  createContactAction,
  updateContactAction,
} from '@/modules/contacts/actions';
import {
  CONTACT_STATUS_LABELS,
  CONTACT_STATUSES,
  createContactSchema,
  type ContactFormValues,
  type CreateContactInput,
} from '@/modules/contacts/schemas';
import type { DuplicateMatch } from '@/modules/contacts/types';

type Option = { value: string; label: string };

const MATCH_LABEL: Record<DuplicateMatch['matchKind'], string> = {
  email: 'Same email',
  phone: 'Same phone',
  name_dob: 'Similar name, same date of birth',
};

export function ContactForm({
  contactId,
  defaults,
  label,
  owners,
  sources,
  canAssign,
  ownerHint,
  canViewSensitive,
}: {
  contactId?: string;
  defaults: ContactFormValues;
  label: ObjectLabel;
  owners: Option[];
  sources: Option[];
  canAssign: boolean;
  ownerHint?: string;
  canViewSensitive: boolean;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues, unknown, CreateContactInput>({
    resolver: zodResolver(createContactSchema),
    defaultValues: defaults,
  });

  const lookForDuplicates = async () => {
    const values = getValues();
    const result = await checkContactDuplicatesAction({
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      phone: values.phone,
      dateOfBirth: values.dateOfBirth,
      excludeId: contactId,
    });
    if (result.ok) setDuplicates(result.data);
  };

  const save = async (values: CreateContactInput, confirmDuplicate: boolean) => {
    setFormError(null);
    const result = contactId
      ? await updateContactAction({ ...values, id: contactId })
      : await createContactAction({ ...values, confirmDuplicate });

    if (!result.ok) {
      if (result.error.code === 'DUPLICATE') {
        await lookForDuplicates();
        setFormError(result.error.message);
        return;
      }
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof ContactFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    router.push(`/contacts/${result.data.id}`);
    router.refresh();
  };

  const onSubmit = handleSubmit((values) => save(values, false));
  const onCreateAnyway = handleSubmit((values) => save(values, true));
  const blurCheck = contactId ? undefined : () => void lookForDuplicates();

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection title="Identity" description={`Who this ${label.singular.toLowerCase()} is.`}>
        <Field name="firstName" label="First name" required error={errors.firstName?.message}>
          <Input
            autoComplete="off"
            {...fieldA11y('firstName', errors.firstName?.message)}
            {...register('firstName')}
          />
        </Field>
        <Field name="lastName" label="Last name" error={errors.lastName?.message}>
          <Input
            autoComplete="off"
            {...fieldA11y('lastName', errors.lastName?.message)}
            {...register('lastName')}
          />
        </Field>
        {canViewSensitive && (
          <Field
            name="dateOfBirth"
            label="Date of birth"
            error={errors.dateOfBirth?.message}
            hint="Sensitive — only visible to roles allowed to see personal details."
          >
            <Input
              type="date"
              {...fieldA11y('dateOfBirth', errors.dateOfBirth?.message)}
              {...register('dateOfBirth', { onBlur: blurCheck })}
            />
          </Field>
        )}
        <Field name="gender" label="Gender" error={errors.gender?.message}>
          <Input
            autoComplete="off"
            {...fieldA11y('gender', errors.gender?.message)}
            {...register('gender')}
          />
        </Field>
      </FormSection>

      <FormSection title="Contact details" description="We check these for duplicates as you type.">
        <Field name="email" label="Email" error={errors.email?.message}>
          <Input
            type="email"
            autoComplete="off"
            {...fieldA11y('email', errors.email?.message)}
            {...register('email', { onBlur: blurCheck })}
          />
        </Field>
        <Field name="phone" label="Phone" error={errors.phone?.message}>
          <Input
            type="tel"
            autoComplete="off"
            {...fieldA11y('phone', errors.phone?.message)}
            {...register('phone', { onBlur: blurCheck })}
          />
        </Field>
        <Field name="altPhone" label="Other phone" error={errors.altPhone?.message}>
          <Input
            type="tel"
            autoComplete="off"
            {...fieldA11y('altPhone', errors.altPhone?.message)}
            {...register('altPhone')}
          />
        </Field>
        <Field name="addressLine" label="Address" error={errors.addressLine?.message}>
          <Input
            autoComplete="off"
            {...fieldA11y('addressLine', errors.addressLine?.message)}
            {...register('addressLine')}
          />
        </Field>
        <Field name="city" label="City" error={errors.city?.message}>
          <Input
            autoComplete="off"
            {...fieldA11y('city', errors.city?.message)}
            {...register('city')}
          />
        </Field>
        <Field name="region" label="State / region" error={errors.region?.message}>
          <Input
            autoComplete="off"
            {...fieldA11y('region', errors.region?.message)}
            {...register('region')}
          />
        </Field>
        <Field
          name="country"
          label="Country"
          hint="2-letter code, e.g. AU"
          error={errors.country?.message}
        >
          <Input
            maxLength={2}
            className="uppercase"
            autoComplete="off"
            {...fieldA11y('country', errors.country?.message)}
            {...register('country')}
          />
        </Field>
        <label className="flex items-start gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            {...register('marketingConsent')}
          />
          <span>Agreed to receive marketing</span>
        </label>
      </FormSection>

      <FormSection
        title="Ownership"
        description="Who looks after this record, and where it came from."
      >
        <Field
          name="ownerUserId"
          label="Owner"
          error={errors.ownerUserId?.message}
          hint={ownerHint}
        >
          <NativeSelect
            disabled={!canAssign}
            {...fieldA11y('ownerUserId', errors.ownerUserId?.message)}
            {...register('ownerUserId')}
          >
            {owners.map((owner) => (
              <option key={owner.value} value={owner.value}>
                {owner.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field name="sourceId" label="Source" error={errors.sourceId?.message}>
          <NativeSelect
            {...fieldA11y('sourceId', errors.sourceId?.message)}
            {...register('sourceId')}
          >
            <option value="">Not recorded</option>
            {sources.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field name="status" label="Status" error={errors.status?.message}>
          <NativeSelect {...fieldA11y('status', errors.status?.message)} {...register('status')}>
            {CONTACT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CONTACT_STATUS_LABELS[status]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </FormSection>

      {duplicates.length > 0 && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning p-4 text-sm text-warning-text"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle aria-hidden className="size-4" />
            This might already be in your workspace
          </p>
          <ul className="flex flex-col gap-1.5">
            {duplicates.map((match, index) => (
              <li key={match.contact?.id ?? `hidden-${index}`} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{MATCH_LABEL[match.matchKind]}</span>
                <span>· {match.ownerName ? `owned by ${match.ownerName}` : 'unassigned'}</span>
                {match.contact ? (
                  <Link
                    className="underline"
                    href={`/contacts/${match.contact.id}`}
                    target="_blank"
                  >
                    Open {label.singular.toLowerCase()}
                  </Link>
                ) : (
                  <span className="text-warning-text/80">(ask them before creating another)</span>
                )}
              </li>
            ))}
          </ul>
          {!contactId && (
            <p className="text-warning-text/80">
              Families often share a phone or email, so you can still create a new one.
            </p>
          )}
        </div>
      )}

      {formError && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          {formError}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        {!contactId && duplicates.length > 0 && (
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCreateAnyway}>
            Create anyway
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? 'Saving…'
            : contactId
              ? 'Save changes'
              : `Create ${label.singular.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}
