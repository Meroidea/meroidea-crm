'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import {
  creditBillAction,
  enterBillAction,
  payBillsAction,
  voidBillAction,
  voidBillCreditAction,
  voidBillPaymentAction,
} from '../actions';
import { formatAmount } from '../labels';
import { formatCents, parseCents, rateBasisPoints, taxInInclusive, taxOnExclusive } from '../money';
import { billSchema, type BillFormValues } from '../schemas';
import type { AccountOption, TaxOption } from './entry-forms';

const label = (account: AccountOption) => `${account.code} · ${account.name}`;

export type SupplierDefault = { supplierName: string; accountId: string; taxCodeId: string | null };

export function BillForm({
  today,
  accounts,
  taxCodes,
  suppliers,
  currency,
}: {
  today: string;
  accounts: AccountOption[];
  taxCodes: TaxOption[];
  suppliers: SupplierDefault[];
  currency: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const choices = accounts.filter((account) => !account.isBank);
  const purchaseCodes = taxCodes.filter((code) => code.appliesTo !== 'sales');
  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<BillFormValues, unknown, BillFormValues>({
    resolver: zodResolver(billSchema, undefined, { raw: true }),
    defaultValues: {
      supplierName: '',
      supplierReference: '',
      date: today,
      dueDate: today,
      amountsAre: 'inclusive',
      notes: '',
      allowDuplicate: false,
      items: [{ accountId: '', description: '', amount: '', taxCodeId: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const [items, amountsAre] = useWatch({ control, name: ['items', 'amountsAre'] });

  let total = 0n;
  let tax = 0n;
  for (const item of items ?? []) {
    const amount = parseCents(item?.amount ?? '') ?? 0n;
    const rate = taxCodes.find((code) => code.id === item?.taxCodeId)?.rate;
    const points = amountsAre === 'no_tax' ? 0n : (rateBasisPoints(rate ?? '0') ?? 0n);
    const lineTax =
      amountsAre === 'inclusive' ? taxInInclusive(amount, points) : taxOnExclusive(amount, points);
    tax += amountsAre === 'no_tax' ? 0n : lineTax;
    total += amountsAre === 'exclusive' ? amount + lineTax : amount;
  }

  // The supplier's usual account and tax code, from their last bill.
  const fillFromSupplier = () => {
    const name = getValues('supplierName')?.trim().toLowerCase();
    const known = suppliers.find((supplier) => supplier.supplierName.toLowerCase() === name);
    if (known && !getValues('items.0.accountId')) {
      setValue('items.0.accountId', known.accountId);
      setValue('items.0.taxCodeId', known.taxCodeId ?? '');
    }
  };

  const save = async (values: BillFormValues) => {
    setFormError(null);
    const result = await enterBillAction(values);
    if (!result.ok) {
      if (result.error.code === 'DUPLICATE') {
        setDuplicate(result.error.message);
        return;
      }
      setFormError(Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message);
      return;
    }
    router.push(`/books/bills/${result.data.id}`);
    router.refresh();
  };

  return (
    <form
      onSubmit={handleSubmit(save, () => setFormError('Please check the highlighted fields.'))}
      noValidate
      className="flex flex-col gap-5"
    >
      <section className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2">
        <Field name="supplierName" label="Supplier" error={errors.supplierName?.message} required>
          <Input
            list="known-suppliers"
            autoComplete="off"
            {...fieldA11y('supplierName', errors.supplierName?.message)}
            {...register('supplierName', { onBlur: fillFromSupplier })}
          />
        </Field>
        <datalist id="known-suppliers">
          {suppliers.map((supplier) => (
            <option key={supplier.supplierName} value={supplier.supplierName} />
          ))}
        </datalist>
        <Field name="supplierReference" label="Their invoice number">
          <Input
            autoComplete="off"
            {...fieldA11y('supplierReference')}
            {...register('supplierReference')}
          />
        </Field>
        <Field name="date" label="Bill date" error={errors.date?.message} required>
          <Input type="date" {...fieldA11y('date', errors.date?.message)} {...register('date')} />
        </Field>
        <Field name="dueDate" label="Due" error={errors.dueDate?.message} required>
          <Input
            type="date"
            {...fieldA11y('dueDate', errors.dueDate?.message)}
            {...register('dueDate')}
          />
        </Field>
        <Field name="amountsAre" label="Amounts are">
          <NativeSelect {...fieldA11y('amountsAre')} {...register('amountsAre')}>
            <option value="inclusive">Including GST</option>
            <option value="exclusive">Excluding GST</option>
            <option value="no_tax">No GST</option>
          </NativeSelect>
        </Field>
        <Field name="notes" label="Notes">
          <Input autoComplete="off" {...fieldA11y('notes')} {...register('notes')} />
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
                  onChange: (event: { target: { value: string } }) => {
                    const chosen = choices.find((account) => account.id === event.target.value);
                    if (chosen?.defaultTaxCodeId) {
                      setValue(`items.${index}.taxCodeId`, chosen.defaultTaxCodeId);
                    }
                  },
                })}
              >
                <option value="">Choose…</option>
                {choices.map((account) => (
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
                {purchaseCodes.map((code) => (
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
              <dt>Bill total</dt>
              <dd className="tabular-nums">{formatAmount(formatCents(total), currency)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {duplicate && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-warning-border bg-warning p-4 text-sm text-warning-text"
        >
          <p>{duplicate}</p>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                setDuplicate(null);
                void save({ ...getValues(), allowDuplicate: true });
              }}
            >
              It is a different bill: save anyway
            </Button>
          </div>
        </div>
      )}
      <ErrorNote error={formError} />
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Enter bill'}
        </Button>
      </div>
    </form>
  );
}

export type BankChoice = { id: string; label: string };

/** Pays this bill, all of what is owed by default. */
export function PayBillForm({
  billId,
  balance,
  supplierName,
  today,
  banks,
}: {
  billId: string;
  balance: string;
  supplierName: string;
  today: string;
  banks: BankChoice[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [amount, setAmount] = useState(balance);
  const [date, setDate] = useState(today);
  const [bank, setBank] = useState(banks[0]?.id ?? '');
  const [reference, setReference] = useState('');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(() =>
          payBillsAction({
            date,
            bankAccountId: bank,
            payeeName: supplierName,
            reference,
            allocations: [{ billId, amount }],
          }),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Amount
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Paid on
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Paid from
          <NativeSelect value={bank} onChange={(e) => setBank(e.target.value)}>
            {banks.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Reference
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>
      <ErrorNote error={error} />
      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Recording…' : 'Record payment'}
        </Button>
      </div>
    </form>
  );
}

/** A credit note from the supplier, against this bill. */
export function BillCreditForm({
  billId,
  today,
  accounts,
  taxCodes,
  defaultAccountId,
  defaultTaxCodeId,
}: {
  billId: string;
  today: string;
  accounts: AccountOption[];
  taxCodes: TaxOption[];
  defaultAccountId: string;
  defaultTaxCodeId: string | null;
}) {
  const { run, error, isPending } = useActionRunner();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [taxCodeId, setTaxCodeId] = useState(defaultTaxCodeId ?? '');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            creditBillAction({
              billId,
              date,
              amount,
              reason,
              supplierReference: reference,
              accountId,
              taxCodeId,
            }),
          () => {
            setAmount('');
            setReason('');
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Credit, including GST
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Date
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Their credit note number
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-3">
          Reason
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Account
          <NativeSelect value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts
              .filter((account) => !account.isBank)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {label(account)}
                </option>
              ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tax
          <NativeSelect value={taxCodeId} onChange={(e) => setTaxCodeId(e.target.value)}>
            <option value="">None</option>
            {taxCodes
              .filter((code) => code.appliesTo !== 'sales')
              .map((code) => (
                <option key={code.id} value={code.id}>
                  {code.name}
                </option>
              ))}
          </NativeSelect>
        </label>
      </div>
      <ErrorNote error={error} />
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
          {isPending ? 'Saving…' : 'Record supplier credit'}
        </Button>
      </div>
    </form>
  );
}

export function VoidBillThing({ id, kind }: { id: string; kind: 'bill' | 'payment' | 'credit' }) {
  const router = useRouter();
  const { run, error, isPending } = useActionRunner();
  const [confirming, setConfirming] = useState(false);
  const word = { bill: 'bill', payment: 'payment', credit: 'credit' }[kind];
  if (!confirming) {
    return (
      <Button
        size="sm"
        variant={kind === 'bill' ? 'outline' : 'ghost'}
        onClick={() => setConfirming(true)}
      >
        {kind === 'bill' ? 'Void bill' : 'Void'}
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="destructive"
        disabled={isPending}
        onClick={() =>
          run(
            () =>
              kind === 'bill'
                ? voidBillAction({ id })
                : kind === 'payment'
                  ? voidBillPaymentAction({ id })
                  : voidBillCreditAction({ id }),
            () => (kind === 'bill' ? router.push('/books/bills?status=void') : undefined),
          )
        }
      >
        Void this {word}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      <ErrorNote error={error} />
    </span>
  );
}

export type OpenBill = {
  id: string;
  number: number;
  supplierName: string;
  dueDate: string;
  balance: string;
};

/** One payment that settles several bills, or parts of them. */
export function PayBillsForm({
  bills,
  today,
  currency,
  banks,
}: {
  bills: OpenBill[];
  today: string;
  currency: string;
  banks: BankChoice[];
}) {
  const router = useRouter();
  const { run, error, isPending } = useActionRunner();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [bank, setBank] = useState(banks[0]?.id ?? '');
  const [payeeName, setPayee] = useState('');
  const [reference, setReference] = useState('');
  const chosen = Object.entries(amounts).filter(([, amount]) => amount.trim() !== '');
  const total = chosen.reduce((sum, [, amount]) => sum + (parseCents(amount) ?? 0n), 0n);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            payBillsAction({
              date,
              bankAccountId: bank,
              payeeName,
              reference,
              allocations: chosen.map(([billId, amount]) => ({ billId, amount })),
            }),
          () => router.push('/books/bills'),
        );
      }}
    >
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Paid on
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Paid from
          <NativeSelect value={bank} onChange={(e) => setBank(e.target.value)}>
            {banks.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <Input value={payeeName} onChange={(e) => setPayee(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Reference
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>
      <ul className="divide-y rounded-xl border bg-card px-4">
        {bills.map((bill) => (
          <li key={bill.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="w-24 font-medium tabular-nums">
              BILL-{String(bill.number).padStart(4, '0')}
            </span>
            <span className="min-w-0 flex-1 basis-40 truncate">{bill.supplierName}</span>
            <span className="text-sm text-muted-foreground tabular-nums">
              owe {formatAmount(bill.balance, currency)}
            </span>
            <Input
              aria-label={`Amount for BILL-${String(bill.number).padStart(4, '0')}`}
              inputMode="decimal"
              className="w-28"
              value={amounts[bill.id] ?? ''}
              onChange={(e) => setAmounts({ ...amounts, [bill.id]: e.target.value })}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAmounts({ ...amounts, [bill.id]: bill.balance })}
            >
              All
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-right font-semibold tabular-nums">
        Payment total {formatAmount(formatCents(total), currency)}
      </p>
      <ErrorNote error={error} />
      <div>
        <Button type="submit" disabled={isPending || chosen.length === 0}>
          {isPending ? 'Recording…' : 'Record payment'}
        </Button>
      </div>
    </form>
  );
}
