'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { FormSection } from '@/components/forms/form-section';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Labels } from '@/lib/tenant/labels';
import { createOpportunityAction, updateOpportunityAction } from '@/modules/opportunities/actions';
import {
  createOpportunitySchema,
  type CreateOpportunityInput,
  type OpportunityFormValues,
} from '@/modules/opportunities/schemas';

type Option = { value: string; label: string };

export function OpportunityForm({
  opportunityId,
  defaults,
  labels,
  contacts,
  organizations,
  stages,
  owners,
  sources,
  partners,
  canAssign,
  canViewRevenue,
  currency,
}: {
  opportunityId?: string;
  defaults: OpportunityFormValues;
  labels: Labels;
  contacts: Option[];
  organizations: Option[];
  stages: Option[];
  owners: Option[];
  sources: Option[];
  partners: Option[];
  canAssign: boolean;
  canViewRevenue: boolean;
  currency: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OpportunityFormValues, unknown, CreateOpportunityInput>({
    resolver: zodResolver(createOpportunitySchema),
    defaultValues: defaults,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = opportunityId
      ? await updateOpportunityAction({ ...values, id: opportunityId })
      : await createOpportunityAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof OpportunityFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    router.push(`/opportunities/${result.data.id}`);
    router.refresh();
  });

  const singular = labels.opportunity.singular.toLowerCase();

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection
        title="What"
        description={`Name the ${singular} so the team recognises it on the board.`}
      >
        <Field
          name="name"
          label="Name"
          required
          error={errors.name?.message}
          className="sm:col-span-2"
        >
          <Input
            placeholder="e.g. Annual support plan"
            autoComplete="off"
            {...fieldA11y('name', errors.name?.message)}
            {...register('name')}
          />
        </Field>
        {canViewRevenue && (
          <Field name="amount" label={`Value (${currency})`} error={errors.amount?.message}>
            <Input
              inputMode="decimal"
              placeholder="0"
              autoComplete="off"
              {...fieldA11y('amount', errors.amount?.message)}
              {...register('amount')}
            />
          </Field>
        )}
        <Field
          name="expectedCloseDate"
          label="Expected close"
          error={errors.expectedCloseDate?.message}
        >
          <Input
            type="date"
            {...fieldA11y('expectedCloseDate', errors.expectedCloseDate?.message)}
            {...register('expectedCloseDate')}
          />
        </Field>
        {!opportunityId && (
          <Field name="stageId" label="Starting stage" error={errors.stageId?.message}>
            <NativeSelect
              {...fieldA11y('stageId', errors.stageId?.message)}
              {...register('stageId')}
            >
              {stages.map((stage) => (
                <option key={stage.value} value={stage.value}>
                  {stage.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </FormSection>

      <FormSection
        title="Who"
        description={`The ${labels.contact.singular.toLowerCase()} and, for B2B, their ${labels.organization.singular.toLowerCase()}.`}
      >
        <Field
          name="contactId"
          label={labels.contact.singular}
          required
          error={errors.contactId?.message}
        >
          <NativeSelect
            {...fieldA11y('contactId', errors.contactId?.message)}
            {...register('contactId')}
          >
            <option value="">Choose…</option>
            {contacts.map((contact) => (
              <option key={contact.value} value={contact.value}>
                {contact.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          name="organizationId"
          label={labels.organization.singular}
          error={errors.organizationId?.message}
        >
          <NativeSelect
            {...fieldA11y('organizationId', errors.organizationId?.message)}
            {...register('organizationId')}
          >
            <option value="">None</option>
            {organizations.map((org) => (
              <option key={org.value} value={org.value}>
                {org.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </FormSection>

      <FormSection title="Ownership & source" description="Who works it, and where it came from.">
        <Field name="ownerUserId" label="Owner" error={errors.ownerUserId?.message}>
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
        <Field
          name="sourceId"
          label="Source"
          hint="Defaults to the contact's source"
          error={errors.sourceId?.message}
        >
          <NativeSelect
            {...fieldA11y('sourceId', errors.sourceId?.message)}
            {...register('sourceId')}
          >
            <option value="">Same as contact</option>
            {sources.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {partners.length > 0 && (
          <Field
            name="partnerId"
            label={`Referring ${labels.partner.singular.toLowerCase()}`}
            error={errors.partnerId?.message}
          >
            <NativeSelect
              {...fieldA11y('partnerId', errors.partnerId?.message)}
              {...register('partnerId')}
            >
              <option value="">None</option>
              {partners.map((partner) => (
                <option key={partner.value} value={partner.value}>
                  {partner.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
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
          {isSubmitting ? 'Saving…' : opportunityId ? 'Save changes' : `Create ${singular}`}
        </Button>
      </div>
    </form>
  );
}
