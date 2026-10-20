'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Field, fieldA11y, searchA11y } from '@/components/forms/field';
import { FormSection } from '@/components/forms/form-section';
import { NativeSelect } from '@/components/forms/native-select';
import { SearchSelect, type SearchOption } from '@/components/forms/search-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Labels } from '@/lib/tenant/labels';
import { CustomFieldInputs } from '@/modules/custom-fields/components/custom-field-inputs';
import type { CustomFieldDefinition } from '@/modules/custom-fields/validation';
import { searchContactOptionsAction } from '@/modules/contacts/actions';
import { createOpportunityAction, updateOpportunityAction } from '@/modules/opportunities/actions';
import { searchOrganizationOptionsAction } from '@/modules/organizations/actions';
import {
  createOpportunitySchema,
  type OpportunityFormValues,
} from '@/modules/opportunities/schemas';

type Option = { value: string; label: string };

async function searchContacts(q: string): Promise<SearchOption[]> {
  const result = await searchContactOptionsAction({ q });
  return result.ok ? result.data : [];
}

async function searchOrganizations(q: string): Promise<SearchOption[]> {
  const result = await searchOrganizationOptionsAction({ q });
  return result.ok ? result.data : [];
}

export function OpportunityForm({
  opportunityId,
  defaults,
  labels,
  contactLabel,
  organizationLabel,
  canPickOrganization,
  stages,
  pipelines = [],
  customFields = [],
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
  /** Names of the contact and organization already chosen, shown before any search. */
  contactLabel?: string | null;
  organizationLabel?: string | null;
  canPickOrganization: boolean;
  stages: Option[];
  /** Pipelines with their open stages; the form offers a choice when there is more than one. */
  pipelines?: (Option & { stages: Option[] })[];
  customFields?: CustomFieldDefinition[];
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
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<OpportunityFormValues, unknown, OpportunityFormValues>({
    // Submits what was typed; the Server Action parses it with the same schema.
    resolver: zodResolver(createOpportunitySchema, undefined, { raw: true }),
    defaultValues: defaults,
  });
  const pipelineId = useWatch({ control, name: 'pipelineId' });
  const stageOptions =
    pipelines.length > 1
      ? (pipelines.find((pipeline) => pipeline.value === pipelineId)?.stages ?? stages)
      : stages;
  const customError = (key: string) =>
    (errors.customFields as Record<string, { message?: string }> | undefined)?.[key]?.message;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = opportunityId
      ? await updateOpportunityAction({ ...values, id: opportunityId })
      : await createOpportunityAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        const path = field.startsWith('custom.') ? `customFields.${field.slice(7)}` : field;
        setError(path as keyof OpportunityFormValues, { message: messages[0] });
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
        {!opportunityId && pipelines.length > 1 && (
          <Field name="pipelineId" label="Pipeline" error={errors.pipelineId?.message}>
            <NativeSelect
              {...fieldA11y('pipelineId', errors.pipelineId?.message)}
              {...register('pipelineId', {
                onChange: (event: { target: { value: string } }) =>
                  setValue(
                    'stageId',
                    pipelines.find((pipeline) => pipeline.value === event.target.value)?.stages[0]
                      ?.value ?? '',
                  ),
              })}
            >
              {pipelines.map((pipeline) => (
                <option key={pipeline.value} value={pipeline.value}>
                  {pipeline.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {!opportunityId && (
          <Field name="stageId" label="Starting stage" error={errors.stageId?.message}>
            <NativeSelect
              {...fieldA11y('stageId', errors.stageId?.message)}
              {...register('stageId')}
            >
              {stageOptions.map((stage) => (
                <option key={stage.value} value={stage.value}>
                  {stage.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </FormSection>

      <FormSection
        title="The deal"
        description="What is being sold, how likely it is, and what happens next."
      >
        <Field name="product" label="Product or service" error={errors.product?.message}>
          <Input
            autoComplete="off"
            {...fieldA11y('product', errors.product?.message)}
            {...register('product')}
          />
        </Field>
        <Field
          name="probability"
          label="Probability (%)"
          hint="Leave empty to use the stage's probability"
          error={errors.probability?.message}
        >
          <Input
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            {...fieldA11y('probability', errors.probability?.message)}
            {...register('probability')}
          />
        </Field>
        <Field
          name="nextStep"
          label="Next step"
          error={errors.nextStep?.message}
          className="sm:col-span-2"
        >
          <Input
            autoComplete="off"
            placeholder="e.g. Send revised quote by Friday"
            {...fieldA11y('nextStep', errors.nextStep?.message)}
            {...register('nextStep')}
          />
        </Field>
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
          <Controller
            control={control}
            name="contactId"
            render={({ field }) => (
              <SearchSelect
                {...searchA11y('contactId', errors.contactId?.message)}
                value={field.value ?? ''}
                selectedLabel={contactLabel}
                onChange={(value) => field.onChange(value)}
                search={searchContacts}
                placeholder={`Search ${labels.contact.plural.toLowerCase()}…`}
              />
            )}
          />
        </Field>
        <Field
          name="organizationId"
          label={labels.organization.singular}
          error={errors.organizationId?.message}
        >
          <Controller
            control={control}
            name="organizationId"
            render={({ field }) => (
              <SearchSelect
                {...searchA11y('organizationId', errors.organizationId?.message)}
                value={field.value ?? ''}
                selectedLabel={organizationLabel}
                onChange={(value) => field.onChange(value)}
                search={searchOrganizations}
                placeholder="None"
                clearable
                disabled={!canPickOrganization}
              />
            )}
          />
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
