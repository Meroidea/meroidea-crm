'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

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
  LEAD_TYPE_LABELS,
  type ContactFormValues,
  type CreateContactInput,
  type LeadType,
} from '@/modules/contacts/schemas';
import type { DuplicateMatch } from '@/modules/contacts/types';
import { CustomFieldInputs } from '@/modules/custom-fields/components/custom-field-inputs';
import type { CustomFieldDefinition } from '@/modules/custom-fields/validation';

type Option = { value: string; label: string };

export type SourceOption = {
  id: string;
  name: string;
  subSources: { id: string; name: string }[];
};

const MATCH_LABEL: Record<DuplicateMatch['matchKind'], string> = {
  email: 'Same email',
  phone: 'Same phone',
  name_dob: 'Similar name, same date of birth',
  company_name: 'Similar name, same company',
};

export function ContactForm({
  contactId,
  isLeadRecord,
  defaults,
  label,
  owners,
  sources,
  leadTypes,
  customFields,
  canAssign,
  canQueue,
  ownerHint,
  canViewSensitive,
}: {
  contactId?: string;
  /** Editing a contact that is already a lead (its source is then required). */
  isLeadRecord?: boolean;
  defaults: ContactFormValues;
  label: ObjectLabel;
  owners: Option[];
  sources: SourceOption[];
  /** The workflows this business runs: one fixes the type, two let the person choose. */
  leadTypes: LeadType[];
  customFields: CustomFieldDefinition[];
  canAssign: boolean;
  /** May leave a new lead in the unassigned queue (contacts.assign across the business). */
  canQueue?: boolean;
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
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues, unknown, CreateContactInput>({
    resolver: zodResolver(createContactSchema),
    defaultValues: defaults,
  });
  const [isLead, sourceId, leadType, assignment] = useWatch({
    control,
    name: ['isLead', 'sourceId', 'leadType', 'assignment'],
  });
  const leadForm = contactId ? Boolean(isLeadRecord) : Boolean(isLead);
  const subSources = sources.find((source) => source.id === sourceId)?.subSources ?? [];
  const isBusiness = leadType === 'b2b' || (leadTypes.length === 1 && leadTypes[0] === 'b2b');

  const lookForDuplicates = async () => {
    const values = getValues();
    const result = await checkContactDuplicatesAction({
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      phone: values.phone,
      dateOfBirth: values.dateOfBirth,
      companyName: values.companyName,
      excludeId: contactId,
    });
    if (result.ok) setDuplicates(result.data);
  };

  const save = async (
    values: CreateContactInput,
    choice: { confirmDuplicate?: boolean; mergeIntoId?: string } = {},
  ) => {
    setFormError(null);
    const result = contactId
      ? await updateContactAction({ ...values, id: contactId })
      : await createContactAction({ ...values, ...choice });

    if (!result.ok) {
      if (result.error.code === 'DUPLICATE') {
        await lookForDuplicates();
        setFormError(result.error.message);
        return;
      }
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        const path = field.startsWith('custom.') ? `customFields.${field.slice(7)}` : field;
        setError(path as keyof ContactFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    router.push(`/contacts/${result.data.id}`);
    router.refresh();
  };

  const onSubmit = handleSubmit((values) => save(values));
  const onCreateAnyway = handleSubmit((values) => save(values, { confirmDuplicate: true }));
  const onMerge = (targetId: string) =>
    handleSubmit((values) => save(values, { mergeIntoId: targetId }))();
  const blurCheck = contactId ? undefined : () => void lookForDuplicates();
  const customError = (key: string) =>
    (errors.customFields as Record<string, { message?: string }> | undefined)?.[key]?.message;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {!contactId && (
        <label className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" {...register('isLead')} />
          <span>
            <span className="font-medium">Add as a lead to qualify</span>
            <span className="block text-muted-foreground">
              Leads start as New, need a source, and can be routed, worked, handed over and
              converted. Untick to add someone you already work with.
            </span>
          </span>
        </label>
      )}

      {leadForm && leadTypes.length > 1 && (
        <FormSection title="Lead type" description="Who you are selling to decides the workflow.">
          <Field name="leadType" label="Selling to" required error={errors.leadType?.message}>
            <NativeSelect
              disabled={Boolean(contactId) && !leadTypes.includes(defaults.leadType as LeadType)}
              {...fieldA11y('leadType', errors.leadType?.message)}
              {...register('leadType')}
            >
              <option value="">Choose…</option>
              {leadTypes.map((type) => (
                <option key={type} value={type}>
                  {LEAD_TYPE_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </FormSection>
      )}

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
            {...register('lastName', { onBlur: blurCheck })}
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
        <Field name="language" label="Preferred language" error={errors.language?.message}>
          <Input
            autoComplete="off"
            {...fieldA11y('language', errors.language?.message)}
            {...register('language')}
          />
        </Field>
      </FormSection>

      {(leadForm || isBusiness) && (
        <FormSection
          title="Company"
          description={
            isBusiness
              ? 'Research the business: the more you fill in, the more complete the lead.'
              : 'Optional: where this person works.'
          }
        >
          <Field name="companyName" label="Company" error={errors.companyName?.message}>
            <Input
              autoComplete="off"
              {...fieldA11y('companyName', errors.companyName?.message)}
              {...register('companyName', { onBlur: blurCheck })}
            />
          </Field>
          <Field name="jobTitle" label="Job title" error={errors.jobTitle?.message}>
            <Input
              autoComplete="off"
              {...fieldA11y('jobTitle', errors.jobTitle?.message)}
              {...register('jobTitle')}
            />
          </Field>
          <Field name="companyWebsite" label="Website" error={errors.companyWebsite?.message}>
            <Input
              autoComplete="off"
              placeholder="example.com"
              {...fieldA11y('companyWebsite', errors.companyWebsite?.message)}
              {...register('companyWebsite')}
            />
          </Field>
          <Field name="linkedinUrl" label="LinkedIn" error={errors.linkedinUrl?.message}>
            <Input
              type="url"
              autoComplete="off"
              placeholder="https://www.linkedin.com/in/…"
              {...fieldA11y('linkedinUrl', errors.linkedinUrl?.message)}
              {...register('linkedinUrl')}
            />
          </Field>
          <Field name="industry" label="Industry" error={errors.industry?.message}>
            <Input
              autoComplete="off"
              {...fieldA11y('industry', errors.industry?.message)}
              {...register('industry')}
            />
          </Field>
          <Field
            name="companySize"
            label="Company size"
            hint="e.g. 1–10, 11–50, 51–200"
            error={errors.companySize?.message}
          >
            <Input
              autoComplete="off"
              {...fieldA11y('companySize', errors.companySize?.message)}
              {...register('companySize')}
            />
          </Field>
        </FormSection>
      )}

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
      </FormSection>

      <FormSection
        title="Source"
        description={
          leadForm
            ? 'Where this lead came from. Required, so every channel can be measured.'
            : 'Where this person came from, if known.'
        }
      >
        <Field name="sourceId" label="Source" required={leadForm} error={errors.sourceId?.message}>
          <NativeSelect
            {...fieldA11y('sourceId', errors.sourceId?.message)}
            {...register('sourceId', { onChange: () => setValue('subSourceId', '') })}
          >
            <option value="">{leadForm ? 'Choose…' : 'Not recorded'}</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          name="subSourceId"
          label="Sub-source"
          required={leadForm && subSources.length > 0}
          error={errors.subSourceId?.message}
        >
          <NativeSelect
            disabled={subSources.length === 0}
            {...fieldA11y('subSourceId', errors.subSourceId?.message)}
            {...register('subSourceId')}
          >
            <option value="">{subSources.length === 0 ? 'None for this source' : 'Choose…'}</option>
            {subSources.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          name="campaignName"
          label="Campaign or event"
          hint="e.g. Spring expo 2026"
          error={errors.campaignName?.message}
        >
          <Input
            autoComplete="off"
            {...fieldA11y('campaignName', errors.campaignName?.message)}
            {...register('campaignName')}
          />
        </Field>
        <Field
          name="interest"
          label="Interested in"
          hint="The product or service they asked about"
          error={errors.interest?.message}
        >
          <Input
            autoComplete="off"
            {...fieldA11y('interest', errors.interest?.message)}
            {...register('interest')}
          />
        </Field>
      </FormSection>

      <FormSection
        title="Consent"
        description="What this person has agreed to and asked us not to do."
      >
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            {...register('marketingConsent')}
          />
          <span>Agreed to receive marketing</span>
        </label>
        <Field name="consentSource" label="Consent given via" error={errors.consentSource?.message}>
          <Input
            autoComplete="off"
            placeholder="Web form, in person, phone…"
            {...fieldA11y('consentSource', errors.consentSource?.message)}
            {...register('consentSource')}
          />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            {...register('doNotEmail')}
          />
          <span>Do not email</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            {...register('doNotCall')}
          />
          <span>Do not call</span>
        </label>
      </FormSection>

      {customFields.some((field) => field.isActive) && (
        <FormSection title="More details" description="Fields your business has added.">
          <CustomFieldInputs
            fields={customFields}
            register={(key) => register(`customFields.${key}`)}
            errorFor={customError}
          />
        </FormSection>
      )}

      <FormSection title="Ownership" description="Who looks after this record.">
        {!contactId && leadForm && (
          <Field name="assignment" label="Assign" error={errors.assignment?.message}>
            <NativeSelect
              {...fieldA11y('assignment', errors.assignment?.message)}
              {...register('assignment')}
            >
              <option value="choose">To a person</option>
              <option value="auto">By the routing rules</option>
              {canQueue && <option value="queue">Leave in the unassigned queue</option>}
            </NativeSelect>
          </Field>
        )}
        {(contactId || !leadForm || assignment === 'choose' || !assignment) && (
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
        )}
        {assignment === 'auto' && !contactId && leadForm && (
          <p className="text-sm text-muted-foreground sm:col-span-2">
            The first matching routing rule picks the owner. If none matches, it stays with you.
          </p>
        )}
        <Field name="status" label="Record status" error={errors.status?.message}>
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
          <ul className="flex flex-col gap-2">
            {duplicates.map((match, index) => (
              <li
                key={match.contact?.id ?? `hidden-${index}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1"
              >
                <span className="font-medium">{MATCH_LABEL[match.matchKind]}</span>
                <span>· {match.ownerName ? `owned by ${match.ownerName}` : 'unassigned'}</span>
                {match.contact ? (
                  <>
                    <Link
                      className="underline"
                      href={`/contacts/${match.contact.id}`}
                      target="_blank"
                    >
                      Open {label.singular.toLowerCase()}
                    </Link>
                    {!contactId && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isSubmitting}
                        onClick={() => match.contact && void onMerge(match.contact.id)}
                      >
                        Merge into it
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="text-warning-text/80">(ask them before creating another)</span>
                )}
              </li>
            ))}
          </ul>
          {!contactId && (
            <p className="text-warning-text/80">
              Merge adds what you typed to the existing record without overwriting anything. Skip by
              cancelling, or create a separate record anyway — families often share a phone or
              email.
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
              : leadForm
                ? 'Add lead'
                : `Create ${label.singular.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}
