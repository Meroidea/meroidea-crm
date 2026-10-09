'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleCheck, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Statement } from '@/modules/hiring/compliance';
import {
  acceptOfferAction,
  declineOfferAction,
  submitPayrollDetailsAction,
} from '@/modules/hiring/public-actions';
import {
  payrollDetailsSchema,
  type PayrollDetailsInput,
  type PayrollFormValues,
} from '@/modules/hiring/schemas';

/** Read, confirm, type your name, accept — or decline. */
export function AcceptOffer({
  token,
  statements,
  contractor,
}: {
  token: string;
  statements: Statement[];
  contractor: boolean;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [readContract, setReadContract] = useState(false);
  const [readStatements, setReadStatements] = useState(statements.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const ready = readContract && readStatements && fullName.trim().length > 2;

  const respond = (accept: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = accept
        ? await acceptOfferAction({ token, fullName, readContract, readStatements: true })
        : await declineOfferAction({ token });
      if (!result.ok) {
        setError(result.error.fieldErrors?.fullName?.[0] ?? result.error.message);
        return;
      }
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {statements.length > 0 && (
        <div>
          <p className="text-sm font-medium">Statements you must be given</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {statements.map((statement) => (
              <li key={statement.key}>
                <a
                  href={statement.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-4"
                >
                  {statement.title} <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={readContract}
          onChange={(event) => setReadContract(event.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        I have read and understood this {contractor ? 'agreement' : 'contract'}.
      </label>
      {statements.length > 0 && (
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={readStatements}
            onChange={(event) => setReadStatements(event.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          I have been given the {statements.length === 1 ? 'statement' : 'statements'} listed above.
        </label>
      )}

      <Field
        name="fullName"
        label="Type your full name to accept"
        hint="This is recorded with the date and time as your acceptance."
        error={error ?? undefined}
      >
        <Input
          autoComplete="name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          {...fieldA11y('fullName', error ?? undefined)}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={() => respond(true)} disabled={!ready || isPending}>
          Accept {contractor ? 'agreement' : 'offer'}
        </Button>
        <Button size="lg" variant="outline" onClick={() => respond(false)} disabled={isPending}>
          Decline
        </Button>
      </div>
    </div>
  );
}

const YES_NO = (
  <>
    <option value="yes">Yes</option>
    <option value="no">No</option>
  </>
);

/** Tax, bank and super details, entered once by the person they belong to. */
export function PayrollForm({ token }: { token: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PayrollFormValues, unknown, PayrollDetailsInput>({
    resolver: zodResolver(payrollDetailsSchema),
    defaultValues: {
      token,
      taxFileNumber: '',
      taxResident: 'yes',
      claimsTaxFreeThreshold: 'yes',
      hasStudyLoan: 'no',
      bankAccountName: '',
      bankBsb: '',
      bankAccount: '',
      superFundName: '',
      superFundUsi: '',
      superMemberNumber: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await submitPayrollDetailsAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof PayrollFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    router.refresh();
  });

  const input = (name: keyof PayrollFormValues) => ({
    ...fieldA11y(name, errors[name]?.message),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="taxFileNumber"
          label="Tax file number"
          hint="Leave blank if you do not have one yet"
          error={errors.taxFileNumber?.message}
          className="sm:col-span-2"
        >
          <Input inputMode="numeric" autoComplete="off" {...input('taxFileNumber')} />
        </Field>
        <Field
          name="taxResident"
          label="Australian resident for tax?"
          error={errors.taxResident?.message}
        >
          <NativeSelect {...input('taxResident')}>{YES_NO}</NativeSelect>
        </Field>
        <Field
          name="claimsTaxFreeThreshold"
          label="Claim the tax-free threshold here?"
          error={errors.claimsTaxFreeThreshold?.message}
        >
          <NativeSelect {...input('claimsTaxFreeThreshold')}>{YES_NO}</NativeSelect>
        </Field>
        <Field
          name="hasStudyLoan"
          label="Have a study or training support loan?"
          error={errors.hasStudyLoan?.message}
          className="sm:col-span-2"
        >
          <NativeSelect {...input('hasStudyLoan')}>{YES_NO}</NativeSelect>
        </Field>

        <Field
          name="bankAccountName"
          label="Bank account name"
          error={errors.bankAccountName?.message}
          className="sm:col-span-2"
          required
        >
          <Input autoComplete="off" {...input('bankAccountName')} />
        </Field>
        <Field name="bankBsb" label="BSB" error={errors.bankBsb?.message} required>
          <Input inputMode="numeric" autoComplete="off" {...input('bankBsb')} />
        </Field>
        <Field
          name="bankAccount"
          label="Account number"
          error={errors.bankAccount?.message}
          required
        >
          <Input inputMode="numeric" autoComplete="off" {...input('bankAccount')} />
        </Field>

        <Field
          name="superFundName"
          label="Super fund"
          error={errors.superFundName?.message}
          className="sm:col-span-2"
          required
        >
          <Input autoComplete="off" {...input('superFundName')} />
        </Field>
        <Field name="superFundUsi" label="Fund USI or ABN" error={errors.superFundUsi?.message}>
          <Input autoComplete="off" {...input('superFundUsi')} />
        </Field>
        <Field
          name="superMemberNumber"
          label="Member number"
          error={errors.superMemberNumber?.message}
        >
          <Input autoComplete="off" {...input('superMemberNumber')} />
        </Field>
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive-text">
          {formError}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isSubmitting} className="self-start">
        Send my details securely
      </Button>
    </form>
  );
}

export function Done({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-accent/60 p-4">
      <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
