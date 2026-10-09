'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Ban, CircleCheck, Plus, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/lib/format';
import {
  markInvoicePaidAction,
  markInvoiceSentAction,
  saveInvoiceAction,
  sendInvoiceAction,
  voidInvoiceAction,
} from '@/modules/invoices/actions';
import {
  saveInvoiceSchema,
  type InvoiceFormValues,
  type SaveInvoiceInput,
} from '@/modules/invoices/schemas';
import type { InvoiceDetail, InvoiceStatus } from '@/modules/invoices/types';

/** Whole-number previews: cents × thousandths, rounded half up. The saved figures come from the database. */
function lineCents(unitPrice: string, quantity: string): bigint | null {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(unitPrice) || !/^\d{1,7}(\.\d{1,3})?$/.test(quantity))
    return null;
  const scaled = (value: string, places: number) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(places, '0'));
  };
  return (scaled(unitPrice, 2) * scaled(quantity, 3) + 500n) / 1000n;
}
const centsToMoney = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

export function InvoiceEditor({
  invoice,
  defaults,
  currency,
}: {
  invoice?: InvoiceDetail;
  defaults: { fromDetails: string; issueDate: string; dueDate: string; taxRate: string };
  currency: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InvoiceFormValues, unknown, SaveInvoiceInput>({
    resolver: zodResolver(saveInvoiceSchema),
    defaultValues: {
      id: invoice?.id,
      customerName: invoice?.customerName ?? '',
      customerEmail: invoice?.customerEmail ?? '',
      customerAddress: invoice?.customerAddress ?? '',
      fromDetails: invoice?.fromDetails ?? defaults.fromDetails,
      issueDate: invoice?.issueDate ?? defaults.issueDate,
      dueDate: invoice?.dueDate ?? defaults.dueDate,
      taxRate: invoice ? String(Number(invoice.taxRate)) : defaults.taxRate,
      notes: invoice?.notes ?? '',
      lines: invoice?.lines.map((line) => ({
        description: line.description,
        quantity: String(Number(line.quantity)),
        unitPrice: line.unitPrice,
      })) ?? [{ description: '', quantity: '1', unitPrice: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const [lines, taxRate] = useWatch({ control, name: ['lines', 'taxRate'] });

  const subtotal = (lines ?? []).reduce(
    (sum, line) => sum + (lineCents(line?.unitPrice ?? '', line?.quantity ?? '') ?? 0n),
    0n,
  );
  const rate = /^\d{1,3}(\.\d{1,2})?$/.test(taxRate ?? '') ? taxRate : '0';
  const [rateWhole = '0', rateFraction = ''] = rate.split('.');
  const tax = (subtotal * BigInt(rateWhole + rateFraction.padEnd(2, '0')) + 5000n) / 10000n;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await saveInvoiceAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof InvoiceFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    router.push(`/invoices/${result.data.id}`);
    router.refresh();
  });

  const input = (name: 'customerName' | 'customerEmail' | 'issueDate' | 'dueDate' | 'taxRate') => ({
    ...fieldA11y(name, errors[name]?.message),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <section className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2">
        <Field name="customerName" label="Customer" error={errors.customerName?.message} required>
          <Input autoComplete="off" {...input('customerName')} />
        </Field>
        <Field
          name="customerEmail"
          label="Customer email"
          hint="Needed to email the invoice"
          error={errors.customerEmail?.message}
        >
          <Input type="email" autoComplete="off" {...input('customerEmail')} />
        </Field>
        <Field
          name="customerAddress"
          label="Customer address"
          error={errors.customerAddress?.message}
        >
          <Textarea rows={3} {...fieldA11y('customerAddress')} {...register('customerAddress')} />
        </Field>
        <Field
          name="fromDetails"
          label="Your business details"
          hint="Name, business number and address, as printed on the invoice"
          error={errors.fromDetails?.message}
        >
          <Textarea rows={3} {...fieldA11y('fromDetails')} {...register('fromDetails')} />
        </Field>
        <Field name="issueDate" label="Invoice date" error={errors.issueDate?.message} required>
          <Input type="date" {...input('issueDate')} />
        </Field>
        <Field name="dueDate" label="Due date" error={errors.dueDate?.message} required>
          <Input type="date" {...input('dueDate')} />
        </Field>
      </section>

      <section className="rounded-xl border bg-card">
        <header className="border-b bg-muted/40 px-4 py-2.5 text-sm font-medium">Lines</header>
        <ul className="divide-y">
          {fields.map((field, index) => {
            const line = lines?.[index];
            const cents = lineCents(line?.unitPrice ?? '', line?.quantity ?? '');
            const lineErrors = errors.lines?.[index];
            return (
              <li key={field.id} className="flex flex-wrap items-start gap-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <Input
                    aria-label={`Line ${index + 1} description`}
                    aria-invalid={Boolean(lineErrors?.description)}
                    placeholder="Description"
                    {...register(`lines.${index}.description`)}
                  />
                </div>
                <Input
                  aria-label={`Line ${index + 1} quantity`}
                  aria-invalid={Boolean(lineErrors?.quantity)}
                  inputMode="decimal"
                  placeholder="Qty"
                  className="w-20 text-right tabular-nums"
                  {...register(`lines.${index}.quantity`)}
                />
                <Input
                  aria-label={`Line ${index + 1} price`}
                  aria-invalid={Boolean(lineErrors?.unitPrice)}
                  inputMode="decimal"
                  placeholder="Price"
                  className="w-28 text-right tabular-nums"
                  {...register(`lines.${index}.unitPrice`)}
                />
                <span className="w-24 py-2 text-right text-sm font-medium tabular-nums">
                  {cents === null ? '' : formatMoney(centsToMoney(cents), currency)}
                </span>
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
                {(lineErrors?.description ?? lineErrors?.quantity ?? lineErrors?.unitPrice) && (
                  <p className="w-full text-sm text-destructive-text">
                    {
                      (lineErrors.description ?? lineErrors.quantity ?? lineErrors.unitPrice)
                        ?.message
                    }
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-start justify-between gap-4 border-t px-4 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => append({ description: '', quantity: '1', unitPrice: '' })}
          >
            <Plus aria-hidden /> Add line
          </Button>
          <dl className="grid w-full max-w-xs grid-cols-2 items-center gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right tabular-nums">
              {formatMoney(centsToMoney(subtotal), currency)}
            </dd>
            <dt className="flex items-center gap-2 text-muted-foreground">
              <label htmlFor="taxRate">Tax %</label>
              <Input inputMode="decimal" className="h-8 w-16 text-right" {...input('taxRate')} />
            </dt>
            <dd className="text-right tabular-nums">{formatMoney(centsToMoney(tax), currency)}</dd>
            <dt className="border-t pt-2 font-semibold">Total</dt>
            <dd className="border-t pt-2 text-right text-lg font-semibold tabular-nums">
              {formatMoney(centsToMoney(subtotal + tax), currency)}
            </dd>
          </dl>
        </div>
        {errors.taxRate && (
          <p className="px-4 pb-3 text-sm text-destructive-text">{errors.taxRate.message}</p>
        )}
      </section>

      <Field
        name="notes"
        label="Notes on the invoice"
        hint="Payment details, terms or a thank-you"
        error={errors.notes?.message}
      >
        <Textarea rows={3} {...fieldA11y('notes')} {...register('notes')} />
      </Field>

      {formError && (
        <p role="alert" className="text-sm text-destructive-text">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push('/invoices')}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {invoice ? 'Save draft' : 'Create draft'}
        </Button>
      </div>
    </form>
  );
}

export function InvoiceActions({ id, status }: { id: string; status: InvoiceStatus }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (
    action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: { message: string } }>,
    confirm?: string,
  ) => {
    if (confirm && !window.confirm(confirm)) return;
    startTransition(async () => {
      setNote(null);
      const result = await action();
      if (!result.ok) return setNote(result.error.message);
      const data = result.data as { sent?: boolean; reason?: string | null };
      if (data.sent === false) setNote(data.reason ?? 'It could not be sent.');
      else if (data.sent) setNote('Emailed to the customer.');
      router.refresh();
    });
  };

  if (status === 'paid' || status === 'void') return null;
  return (
    <div className="no-print flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button disabled={isPending} onClick={() => run(() => sendInvoiceAction({ id }))}>
          <Send aria-hidden /> {status === 'sent' ? 'Email again' : 'Email to customer'}
        </Button>
        {status === 'draft' && (
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => markInvoiceSentAction({ id }))}
          >
            Mark as sent
          </Button>
        )}
        {status === 'sent' && (
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => markInvoicePaidAction({ id }))}
          >
            <CircleCheck aria-hidden /> Mark as paid
          </Button>
        )}
        <Button
          variant="outline"
          className="text-destructive-text"
          disabled={isPending}
          onClick={() =>
            run(
              () => voidInvoiceAction({ id }),
              'Void this invoice? It stays on record but is no longer owed.',
            )
          }
        >
          <Ban aria-hidden /> Void
        </Button>
      </div>
      {note && (
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}
