'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { FormSection } from '@/components/forms/form-section';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  createHireAction,
  getMinimumRateAction,
  listClassificationsAction,
  searchAwardsAction,
} from '@/modules/hiring/actions';
import {
  EMPLOYMENT_TYPE_HINTS,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  isBelowMinimum,
} from '@/modules/hiring/compliance';
import {
  createHireSchema,
  type CreateHireInput,
  type HireFormValues,
} from '@/modules/hiring/schemas';

type Option = { value: string; label: string };

export function HireForm({
  fairWorkConnected,
  currency,
  initial,
}: {
  /** The Fair Work pay database is connected, so awards and minimums are looked up, not typed. */
  fairWorkConnected: boolean;
  currency: string;
  /** Carried over from a successful applicant, so nothing is typed twice. */
  initial?: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    positionTitle: string;
    employmentType: 'casual' | 'part_time' | 'full_time' | 'fixed_term' | 'contractor';
  };
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [awardQuery, setAwardQuery] = useState('');
  const [awards, setAwards] = useState<Option[]>([]);
  const [classifications, setClassifications] = useState<Option[]>([]);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [isLooking, startLookup] = useTransition();
  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<HireFormValues, unknown, CreateHireInput>({
    resolver: zodResolver(createHireSchema),
    defaultValues: {
      firstName: initial?.firstName ?? '',
      lastName: initial?.lastName ?? '',
      email: initial?.email ?? '',
      phone: initial?.phone ?? '',
      employmentType: initial?.employmentType ?? 'full_time',
      positionTitle: initial?.positionTitle ?? '',
      startDate: '',
      endDate: '',
      hoursPerWeek: '38',
      payBasis: 'hourly',
      payRate: '',
      awardCode: '',
      awardName: '',
      classification: '',
      classificationRef: '',
      minimumRate: '',
      belowMinimumReason: '',
      contractorAbn: '',
      probationMonths: '',
    },
  });

  const [type, payBasis, payRate, hoursPerWeek, minimumRate, awardCode, classificationRef] =
    useWatch({
      control,
      name: [
        'employmentType',
        'payBasis',
        'payRate',
        'hoursPerWeek',
        'minimumRate',
        'awardCode',
        'classificationRef',
      ],
    });
  const contractor = type === 'contractor';
  const endsOnDate = type === 'fixed_term' || contractor;
  const validMoney = (value: unknown): value is string =>
    typeof value === 'string' && /^\d{1,9}(\.\d{1,2})?$/.test(value);
  const below =
    !contractor &&
    validMoney(payRate) &&
    validMoney(minimumRate) &&
    isBelowMinimum({
      employmentType: type,
      startDate: '',
      endDate: null,
      hoursPerWeek: typeof hoursPerWeek === 'string' && hoursPerWeek ? hoursPerWeek : null,
      payBasis,
      payRate,
      awardCode: null,
      classification: null,
      minimumRate,
      belowMinimumReason: null,
      contractorAbn: null,
    });

  const findAwards = () =>
    startLookup(async () => {
      setLookupNote(null);
      const result = await searchAwardsAction({ name: awardQuery });
      if (!result.ok) return setLookupNote(result.error.message);
      setAwards(result.data.map((award) => ({ value: award.code, label: award.name })));
      if (result.data.length === 0) setLookupNote('No award matched. Try a shorter word.');
    });

  const chooseAward = (code: string) => {
    const award = awards.find((option) => option.value === code);
    setValue('awardCode', code);
    setValue('awardName', award?.label ?? '');
    setValue('classification', '');
    setValue('classificationRef', '');
    setValue('minimumRate', '');
    setClassifications([]);
    if (!code) return;
    startLookup(async () => {
      const result = await listClassificationsAction({ awardCode: code });
      if (!result.ok) return setLookupNote(result.error.message);
      setClassifications(result.data.map((item) => ({ value: item.ref, label: item.label })));
    });
  };

  const chooseClassification = (ref: string) => {
    const picked = classifications.find((option) => option.value === ref);
    setValue('classificationRef', ref);
    setValue('classification', picked?.label ?? '');
    setValue('minimumRate', '');
    if (!ref || typeof awardCode !== 'string' || !awardCode) return;
    startLookup(async () => {
      const result = await getMinimumRateAction({ awardCode, classificationRef: ref });
      if (!result.ok) return setLookupNote(result.error.message);
      if (result.data?.hourly) setValue('minimumRate', result.data.hourly);
      else setLookupNote('No minimum rate is published for that classification. Check the award.');
    });
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await createHireAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof HireFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    router.push(`/staff/${result.data.employeeId}?section=contract`);
    router.refresh();
  });

  const input = (name: keyof HireFormValues) => ({
    ...fieldA11y(name, errors[name]?.message),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection
        title="Person"
        description="Who you are hiring. The offer is sent to this email."
      >
        <Field name="firstName" label="First name" error={errors.firstName?.message} required>
          <Input autoComplete="off" {...input('firstName')} />
        </Field>
        <Field name="lastName" label="Last name" error={errors.lastName?.message} required>
          <Input autoComplete="off" {...input('lastName')} />
        </Field>
        <Field name="email" label="Email" error={errors.email?.message} required>
          <Input type="email" autoComplete="off" {...input('email')} />
        </Field>
        <Field name="phone" label="Phone" error={errors.phone?.message}>
          <Input type="tel" autoComplete="off" {...input('phone')} />
        </Field>
      </FormSection>

      <FormSection
        title="Engagement"
        description="The kind of work arrangement decides which rules apply."
      >
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium">Type</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {EMPLOYMENT_TYPES.map((option) => (
              <label
                key={option}
                className={cn(
                  'flex cursor-pointer flex-col rounded-lg border px-3 py-2.5 transition-colors',
                  type === option
                    ? 'border-primary bg-accent text-accent-foreground'
                    : 'hover:bg-muted',
                )}
              >
                <input
                  type="radio"
                  value={option}
                  className="sr-only"
                  {...register('employmentType')}
                />
                <span className="text-sm font-medium">{EMPLOYMENT_TYPE_LABELS[option]}</span>
                <span className="text-xs text-muted-foreground">
                  {EMPLOYMENT_TYPE_HINTS[option]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field name="positionTitle" label="Position" error={errors.positionTitle?.message} required>
          <Input {...input('positionTitle')} />
        </Field>
        <Field name="startDate" label="Start date" error={errors.startDate?.message} required>
          <Input type="date" {...input('startDate')} />
        </Field>
        {endsOnDate && (
          <Field name="endDate" label="End date" error={errors.endDate?.message} required>
            <Input type="date" {...input('endDate')} />
          </Field>
        )}
        {type !== 'casual' && !contractor && (
          <Field
            name="hoursPerWeek"
            label="Hours per week"
            error={errors.hoursPerWeek?.message}
            required={type === 'part_time'}
          >
            <Input inputMode="decimal" {...input('hoursPerWeek')} />
          </Field>
        )}
        {!contractor && (
          <Field
            name="probationMonths"
            label="Probation (months)"
            hint="Leave blank for none"
            error={errors.probationMonths?.message}
          >
            <Input inputMode="numeric" {...input('probationMonths')} />
          </Field>
        )}
        {contractor && (
          <Field
            name="contractorAbn"
            label="Contractor’s ABN"
            error={errors.contractorAbn?.message}
            required
          >
            <Input inputMode="numeric" {...input('contractorAbn')} />
          </Field>
        )}
      </FormSection>

      {!contractor && (
        <FormSection
          title="Award"
          description={
            fairWorkConnected
              ? 'Looked up from the Fair Work Commission’s pay database.'
              : 'The Fair Work pay database is not connected, so these are typed in and not checked.'
          }
        >
          {fairWorkConnected ? (
            <>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="award-search" className="text-sm font-medium">
                  Find the award
                </label>
                <div className="flex gap-2">
                  <Input
                    id="award-search"
                    value={awardQuery}
                    onChange={(event) => setAwardQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (awardQuery.trim().length >= 3) findAwards();
                      }
                    }}
                    placeholder="Part of the award’s name, such as “clerks” or “retail”"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={findAwards}
                    disabled={isLooking || awardQuery.trim().length < 3}
                  >
                    <Search aria-hidden /> Search
                  </Button>
                </div>
              </div>
              <Field name="awardCode" label="Award" error={errors.awardCode?.message}>
                <NativeSelect
                  {...fieldA11y('awardCode', errors.awardCode?.message)}
                  value={typeof awardCode === 'string' ? awardCode : ''}
                  onChange={(event) => chooseAward(event.target.value)}
                  disabled={awards.length === 0}
                >
                  <option value="">{awards.length ? 'Choose an award' : 'Search first'}</option>
                  {awards.map((award) => (
                    <option key={award.value} value={award.value}>
                      {award.label} ({award.value})
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                name="classification"
                label="Classification"
                error={errors.classification?.message}
              >
                <NativeSelect
                  {...fieldA11y('classification', errors.classification?.message)}
                  value={typeof classificationRef === 'string' ? classificationRef : ''}
                  onChange={(event) => chooseClassification(event.target.value)}
                  disabled={classifications.length === 0}
                >
                  <option value="">
                    {classifications.length ? 'Choose a classification' : '—'}
                  </option>
                  {classifications.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {lookupNote && (
                <p role="status" className="text-sm text-muted-foreground sm:col-span-2">
                  {lookupNote}
                </p>
              )}
            </>
          ) : (
            <>
              <Field
                name="awardName"
                label="Award name"
                hint="Leave blank if award-free"
                error={errors.awardName?.message}
              >
                <Input {...input('awardName')} />
              </Field>
              <Field
                name="awardCode"
                label="Award code"
                hint="Such as MA000002"
                error={errors.awardCode?.message}
              >
                <Input {...input('awardCode')} />
              </Field>
              <Field
                name="classification"
                label="Classification"
                error={errors.classification?.message}
              >
                <Input {...input('classification')} />
              </Field>
              <Field
                name="minimumRate"
                label={`Minimum hourly rate (${currency})`}
                hint="From the award’s current pay guide"
                error={errors.minimumRate?.message}
              >
                <Input inputMode="decimal" {...input('minimumRate')} />
              </Field>
            </>
          )}
        </FormSection>
      )}

      <FormSection
        title={contractor ? 'Fees' : 'Pay'}
        description="Before tax. Superannuation is on top."
      >
        <Field name="payBasis" label="Paid" error={errors.payBasis?.message} required>
          <NativeSelect {...input('payBasis')}>
            <option value="hourly">By the hour</option>
            <option value="annual">Annual salary</option>
          </NativeSelect>
        </Field>
        <Field
          name="payRate"
          label={`${payBasis === 'annual' ? 'Salary' : 'Hourly rate'} (${currency})`}
          error={errors.payRate?.message}
          required
        >
          <Input inputMode="decimal" {...input('payRate')} />
        </Field>
        {!contractor && validMoney(minimumRate) && (
          <p
            className={cn(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm sm:col-span-2',
              below
                ? 'border-warning-border bg-warning text-warning-text'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {below ? (
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            ) : (
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              Minimum for this classification: ${minimumRate} an hour
              {fairWorkConnected ? ' (Fair Work pay database)' : ' (entered by you, not verified)'}.
              {below && ' The pay you entered is below it.'}
            </span>
          </p>
        )}
        {below && (
          <Field
            name="belowMinimumReason"
            label="Why a lower rate lawfully applies"
            hint="For example a junior, apprentice, trainee or supported wage rate"
            error={errors.belowMinimumReason?.message}
            className="sm:col-span-2"
            required
          >
            <Input {...input('belowMinimumReason')} />
          </Field>
        )}
      </FormSection>

      {formError && (
        <p role="alert" className="text-sm text-destructive-text">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => router.push('/hiring')}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          Save and review contract
        </Button>
      </div>
    </form>
  );
}
