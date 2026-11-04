'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch, type FieldErrors } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { recordJournalAction, recordMoneyAction, recordTransferAction } from '../actions';
import { formatAmount } from '../labels';
import { formatCents, parseCents, rateBasisPoints, taxInInclusive, taxOnExclusive } from '../money';
import {
  journalSchema,
  moneySchema,
  transferSchema,
  type JournalFormValues,
  type MoneyFormValues,
  type TransferFormValues,
} from '../schemas';

export type AccountOption = {
  id: string;
  code: string;
  name: string;
  type: string;
  isBank: boolean;
  defaultTaxCodeId: string | null;
};
export type TaxOption = { id: string; code: string; name: string; rate: string; appliesTo: string };

const label = (account: AccountOption) => `${account.code} · ${account.name}`;

function firstError(errors: FieldErrors): string | null {
  for (const value of Object.values(errors)) {
    if (!value) continue;
    if (typeof value.message === 'string' && value.message) return value.message;
    if (typeof value === 'object') {
      const nested = firstError(value as FieldErrors);
      if (nested) return nested;
    }
  }
  return null;
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
    >
      {message}
    </p>
  ) : null;
}

/** Money in or money out, split across accounts and tax codes. */
export function MoneyForm({
  kind,
  today,
  accounts,
  taxCodes,
  currency,
}: {
  kind: 'money_in' | 'money_out';
  today: string;
  accounts: AccountOption[];
  taxCodes: TaxOption[];
  currency: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const banks = accounts.filter((account) => account.isBank);
  const others = accounts.filter((account) => !account.isBank);
  const taxFor = taxCodes.filter((code) =>
    kind === 'money_in' ? code.appliesTo !== 'purchases' : code.appliesTo !== 'sales',
  );
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<MoneyFormValues, unknown, MoneyFormValues>({
    resolver: zodResolver(moneySchema, undefined, { raw: true }),
    defaultValues: {
      kind,
      date: today,
      bankAccountId: banks[0]?.id ?? '',
      contactName: '',
      reference: '',
      description: '',
      amountsAre: 'inclusive',
      items: [{ accountId: '', description: '', amount: '', taxCodeId: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const [items, amountsAre] = useWatch({ control, name: ['items', 'amountsAre'] });

  let gross = 0n;
  let tax = 0n;
  for (const item of items ?? []) {
    const amount = parseCents(item?.amount ?? '') ?? 0n;
    const rate = taxCodes.find((code) => code.id === item?.taxCodeId)?.rate;
    const points = amountsAre === 'no_tax' ? 0n : (rateBasisPoints(rate ?? '0') ?? 0n);
    const lineTax =
      amountsAre === 'inclusive' ? taxInInclusive(amount, points) : taxOnExclusive(amount, points);
    tax += amountsAre === 'no_tax' ? 0n : lineTax;
    gross += amountsAre === 'exclusive' ? amount + lineTax : amount;
  }

  const onSubmit = handleSubmit(
    async (values) => {
      setFormError(null);
      const result = await recordMoneyAction(values);
      if (!result.ok) {
        setFormError(Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message);
        return;
      }
      router.push(`/books/entries/${result.data.id}`);
      router.refresh();
    },
    (invalid) => setFormError(firstError(invalid)),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <section className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2">
        <Field name="date" label="Date" error={errors.date?.message} required>
          <Input type="date" {...fieldA11y('date', errors.date?.message)} {...register('date')} />
        </Field>
        <Field
          name="bankAccountId"
          label={kind === 'money_in' ? 'Into' : 'Paid from'}
          error={errors.bankAccountId?.message}
          required
        >
          <NativeSelect
            {...fieldA11y('bankAccountId', errors.bankAccountId?.message)}
            {...register('bankAccountId')}
          >
            {banks.map((account) => (
              <option key={account.id} value={account.id}>
                {label(account)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field name="contactName" label={kind === 'money_in' ? 'From' : 'Paid to'}>
          <Input autoComplete="off" {...fieldA11y('contactName')} {...register('contactName')} />
        </Field>
        <Field name="reference" label="Reference" hint="A receipt or statement reference">
          <Input autoComplete="off" {...fieldA11y('reference')} {...register('reference')} />
        </Field>
        <Field
          name="description"
          label="What was it for?"
          error={errors.description?.message}
          required
          className="sm:col-span-2"
        >
          <Input
            autoComplete="off"
            {...fieldA11y('description', errors.description?.message)}
            {...register('description')}
          />
        </Field>
        <Field name="amountsAre" label="Amounts are">
          <NativeSelect {...fieldA11y('amountsAre')} {...register('amountsAre')}>
            <option value="inclusive">Including GST</option>
            <option value="exclusive">Excluding GST</option>
            <option value="no_tax">No GST</option>
          </NativeSelect>
        </Field>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h2 className="font-medium">Lines</h2>
        {fields.map((field, index) => (
          <div key={field.id} className="grid gap-3 border-b pb-3 sm:grid-cols-12 sm:items-end">
            <Field name={`items.${index}.accountId`} label="Account" className="sm:col-span-4">
              <NativeSelect
                {...fieldA11y(`items.${index}.accountId`)}
                {...register(`items.${index}.accountId`, {
                  // Smart default: the account's usual tax code.
                  onChange: (event: { target: { value: string } }) => {
                    const chosen = others.find((account) => account.id === event.target.value);
                    if (chosen?.defaultTaxCodeId) {
                      setValue(`items.${index}.taxCodeId`, chosen.defaultTaxCodeId);
                    }
                  },
                })}
              >
                <option value="">Choose…</option>
                {others.map((account) => (
                  <option key={account.id} value={account.id}>
                    {label(account)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field name={`items.${index}.description`} label="Note" className="sm:col-span-3">
              <Input
                autoComplete="off"
                {...fieldA11y(`items.${index}.description`)}
                {...register(`items.${index}.description`)}
              />
            </Field>
            <Field name={`items.${index}.amount`} label="Amount" className="sm:col-span-2">
              <Input
                inputMode="decimal"
                {...fieldA11y(`items.${index}.amount`)}
                {...register(`items.${index}.amount`)}
              />
            </Field>
            <Field name={`items.${index}.taxCodeId`} label="Tax" className="sm:col-span-2">
              <NativeSelect
                {...fieldA11y(`items.${index}.taxCodeId`)}
                {...register(`items.${index}.taxCodeId`)}
              >
                <option value="">None</option>
                {taxFor.map((code) => (
                  <option key={code.id} value={code.id}>
                    {code.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="sm:col-span-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove line ${index + 1}`}
                disabled={fields.length === 1}
                onClick={() => remove(index)}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ accountId: '', description: '', amount: '', taxCodeId: '' })}
          >
            <Plus aria-hidden /> Add a line
          </Button>
          <dl className="text-right text-sm">
            <div className="flex justify-end gap-3 text-muted-foreground">
              <dt>GST</dt>
              <dd className="tabular-nums">{formatAmount(formatCents(tax), currency)}</dd>
            </div>
            <div className="flex justify-end gap-3 font-semibold">
              <dt>{kind === 'money_in' ? 'Total received' : 'Total spent'}</dt>
              <dd className="tabular-nums">{formatAmount(formatCents(gross), currency)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <FormError message={formError} />
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : kind === 'money_in' ? 'Record money in' : 'Record money out'}
        </Button>
      </div>
    </form>
  );
}

export function TransferForm({ today, accounts }: { today: string; accounts: AccountOption[] }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const banks = accounts.filter((account) => account.isBank);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TransferFormValues, unknown, TransferFormValues>({
    resolver: zodResolver(transferSchema, undefined, { raw: true }),
    defaultValues: {
      date: today,
      fromAccountId: banks[0]?.id ?? '',
      toAccountId: banks[1]?.id ?? '',
      amount: '',
      description: 'Transfer',
      reference: '',
    },
  });
  const onSubmit = handleSubmit(
    async (values) => {
      setFormError(null);
      const result = await recordTransferAction(values);
      if (!result.ok) return setFormError(result.error.message);
      router.push(`/books/entries/${result.data.id}`);
      router.refresh();
    },
    (invalid) => setFormError(firstError(invalid)),
  );
  const bankSelect = (name: 'fromAccountId' | 'toAccountId') => (
    <NativeSelect {...fieldA11y(name, errors[name]?.message)} {...register(name)}>
      {banks.map((account) => (
        <option key={account.id} value={account.id}>
          {label(account)}
        </option>
      ))}
    </NativeSelect>
  );
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <section className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2">
        <Field name="date" label="Date" error={errors.date?.message} required>
          <Input type="date" {...fieldA11y('date', errors.date?.message)} {...register('date')} />
        </Field>
        <Field name="amount" label="Amount" error={errors.amount?.message} required>
          <Input
            inputMode="decimal"
            {...fieldA11y('amount', errors.amount?.message)}
            {...register('amount')}
          />
        </Field>
        <Field name="fromAccountId" label="From" required>
          {bankSelect('fromAccountId')}
        </Field>
        <Field name="toAccountId" label="To" required>
          {bankSelect('toAccountId')}
        </Field>
        <Field
          name="description"
          label="Description"
          error={errors.description?.message}
          required
          className="sm:col-span-2"
        >
          <Input autoComplete="off" {...fieldA11y('description')} {...register('description')} />
        </Field>
      </section>
      <FormError message={formError} />
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Record transfer'}
        </Button>
      </div>
    </form>
  );
}

/** A manual journal in debits and credits, or the opening balances when the books begin. */
export function JournalForm({
  kind,
  today,
  accounts,
  currency,
  canAdjust,
}: {
  kind: 'journal' | 'opening_balance';
  today: string;
  accounts: AccountOption[];
  currency: string;
  canAdjust: boolean;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const emptyLine = { accountId: '', description: '', debit: '', credit: '' };
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<JournalFormValues, unknown, JournalFormValues>({
    resolver: zodResolver(journalSchema, undefined, { raw: true }),
    defaultValues: {
      kind,
      date: today,
      description: kind === 'opening_balance' ? 'Opening balances' : '',
      reference: '',
      isAdjustment: false,
      lines: [emptyLine, emptyLine],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = useWatch({ control, name: 'lines' });
  const debits = (lines ?? []).reduce(
    (sum, line) => sum + (parseCents(line?.debit ?? '') ?? 0n),
    0n,
  );
  const credits = (lines ?? []).reduce(
    (sum, line) => sum + (parseCents(line?.credit ?? '') ?? 0n),
    0n,
  );
  const difference = debits - credits;

  const onSubmit = handleSubmit(
    async (values) => {
      setFormError(null);
      const result = await recordJournalAction({
        ...values,
        lines: values.lines.filter((line) => line.accountId),
      });
      if (!result.ok) return setFormError(result.error.message);
      router.push(`/books/entries/${result.data.id}`);
      router.refresh();
    },
    (invalid) => setFormError(firstError(invalid)),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <section className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2">
        <Field name="date" label="Date" error={errors.date?.message} required>
          <Input type="date" {...fieldA11y('date', errors.date?.message)} {...register('date')} />
        </Field>
        <Field name="reference" label="Reference">
          <Input autoComplete="off" {...fieldA11y('reference')} {...register('reference')} />
        </Field>
        <Field
          name="description"
          label="Narration"
          error={errors.description?.message}
          required
          className="sm:col-span-2"
        >
          <Input autoComplete="off" {...fieldA11y('description')} {...register('description')} />
        </Field>
        {kind === 'journal' && canAdjust && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4" {...register('isAdjustment')} />
            Mark as an accountant’s adjusting journal
          </label>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h2 className="font-medium">Lines</h2>
        {fields.map((field, index) => (
          <div key={field.id} className="grid gap-3 border-b pb-3 sm:grid-cols-12 sm:items-end">
            <Field name={`lines.${index}.accountId`} label="Account" className="sm:col-span-4">
              <NativeSelect
                {...fieldA11y(`lines.${index}.accountId`)}
                {...register(`lines.${index}.accountId`)}
              >
                <option value="">Choose…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {label(account)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field name={`lines.${index}.description`} label="Note" className="sm:col-span-3">
              <Input
                autoComplete="off"
                {...fieldA11y(`lines.${index}.description`)}
                {...register(`lines.${index}.description`)}
              />
            </Field>
            <Field name={`lines.${index}.debit`} label="Debit" className="sm:col-span-2">
              <Input
                inputMode="decimal"
                {...fieldA11y(`lines.${index}.debit`)}
                {...register(`lines.${index}.debit`)}
              />
            </Field>
            <Field name={`lines.${index}.credit`} label="Credit" className="sm:col-span-2">
              <Input
                inputMode="decimal"
                {...fieldA11y(`lines.${index}.credit`)}
                {...register(`lines.${index}.credit`)}
              />
            </Field>
            <div className="sm:col-span-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove line ${index + 1}`}
                disabled={fields.length <= 1}
                onClick={() => remove(index)}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine)}>
            <Plus aria-hidden /> Add a line
          </Button>
          <dl className="text-right text-sm tabular-nums">
            <div className="flex justify-end gap-3">
              <dt className="text-muted-foreground">Debits</dt>
              <dd>{formatAmount(formatCents(debits), currency)}</dd>
              <dt className="text-muted-foreground">Credits</dt>
              <dd>{formatAmount(formatCents(credits), currency)}</dd>
            </div>
            <p className={difference === 0n ? 'text-muted-foreground' : 'font-medium'}>
              {difference === 0n
                ? 'Balanced'
                : kind === 'opening_balance'
                  ? `${formatAmount(formatCents(difference < 0n ? -difference : difference), currency)} will go to Opening balances`
                  : `Out of balance by ${formatAmount(formatCents(difference < 0n ? -difference : difference), currency)}`}
            </p>
          </dl>
        </div>
      </section>

      <FormError message={formError} />
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? 'Saving…'
            : kind === 'opening_balance'
              ? 'Save opening balances'
              : 'Post journal'}
        </Button>
      </div>
    </form>
  );
}
