'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Field, fieldA11y, searchA11y } from '@/components/forms/field';
import { FormSection } from '@/components/forms/form-section';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createPartnerAction } from '@/modules/partners/actions';
import { SearchSelect, type SearchOption } from '@/components/forms/search-select';
import { searchOrganizationOptionsAction } from '@/modules/organizations/actions';
import {
  PARTNER_STATUS_LABELS,
  PARTNER_STATUSES,
  partnerFieldsSchema,
  type PartnerFormValues,
} from '@/modules/partners/schemas';

async function searchOrganizations(q: string): Promise<SearchOption[]> {
  const result = await searchOrganizationOptionsAction({ q });
  return result.ok ? result.data : [];
}

export function PartnerForm({
  canPickOrganization,
  organizationLabel,
  partnerLabel,
  currency,
}: {
  /** Whether the viewer may look existing organizations up (organizations.view). */
  canPickOrganization: boolean;
  organizationLabel: string;
  partnerLabel: string;
  currency: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<PartnerFormValues, unknown, PartnerFormValues>({
    // Submits what was typed; the Server Action parses it with the same schema.
    resolver: zodResolver(partnerFieldsSchema, undefined, { raw: true }),
    defaultValues: {
      organizationId: '',
      organizationName: '',
      status: 'active',
      commissionType: 'none',
      commissionValue: '',
      notes: '',
    },
  });
  const commissionType = useWatch({ control, name: 'commissionType' });
  const pickedExisting = Boolean(useWatch({ control, name: 'organizationId' }));

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await createPartnerAction(values);
    if (!result.ok) {
      setFormError(result.error.message);
      return;
    }
    router.push(`/partners/${result.data.id}`);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection
        title={organizationLabel}
        description={`Every ${partnerLabel.toLowerCase()} is an ${organizationLabel.toLowerCase()}. Pick one or create it here.`}
      >
        <Field
          name="organizationId"
          label={`Existing ${organizationLabel.toLowerCase()}`}
          error={errors.organizationId?.message}
        >
          <Controller
            control={control}
            name="organizationId"
            render={({ field }) => (
              <SearchSelect
                {...searchA11y('organizationId', errors.organizationId?.message)}
                value={field.value ?? ''}
                onChange={(value) => field.onChange(value)}
                search={searchOrganizations}
                placeholder={`Search, or leave empty to create a new ${organizationLabel.toLowerCase()}`}
                clearable
                disabled={!canPickOrganization}
              />
            )}
          />
        </Field>
        {!pickedExisting && (
          <Field name="organizationName" label="New name" error={errors.organizationName?.message}>
            <Input
              autoComplete="off"
              {...fieldA11y('organizationName', errors.organizationName?.message)}
              {...register('organizationName')}
            />
          </Field>
        )}
      </FormSection>

      <FormSection title="Terms" description="What they earn when they send you business.">
        <Field name="status" label="Status" error={errors.status?.message}>
          <NativeSelect {...fieldA11y('status', errors.status?.message)} {...register('status')}>
            {PARTNER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PARTNER_STATUS_LABELS[status]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field name="commissionType" label="Commission" error={errors.commissionType?.message}>
          <NativeSelect
            {...fieldA11y('commissionType', errors.commissionType?.message)}
            {...register('commissionType')}
          >
            <option value="none">None</option>
            <option value="percentage">Percentage of our revenue</option>
            <option value="fixed">Fixed amount per win</option>
          </NativeSelect>
        </Field>
        {commissionType !== 'none' && (
          <Field
            name="commissionValue"
            label={commissionType === 'percentage' ? 'Percent' : `Amount (${currency})`}
            error={errors.commissionValue?.message}
          >
            <Input
              inputMode="decimal"
              {...fieldA11y('commissionValue', errors.commissionValue?.message)}
              {...register('commissionValue')}
            />
          </Field>
        )}
        <Field name="notes" label="Notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea
            rows={3}
            {...fieldA11y('notes', errors.notes?.message)}
            {...register('notes')}
          />
        </Field>
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
          {isSubmitting ? 'Saving…' : `Add ${partnerLabel.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}
