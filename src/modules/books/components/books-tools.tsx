'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { saveCsv } from '@/components/data/csv-download';
import { Field, fieldA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toCsv } from '@/lib/csv';

import {
  archiveAccountAction,
  catchUpBooksAction,
  payPayslipAction,
  recordBooksExportAction,
  saveAccountAction,
  saveBooksSettingsAction,
  saveTaxCodeAction,
  setupBooksAction,
  voidEntryAction,
} from '../actions';
import { MONTHS } from '../labels';
import { ACCOUNT_TYPES, SUBTYPE_LABELS, TAX_KIND_LABELS, type AccountSubtype } from '../packs';
import {
  booksSettingsSchema,
  saveAccountSchema,
  saveTaxCodeSchema,
  setupBooksSchema,
  type AccountFormValues,
  type BooksSettingsFormValues,
  type ExportReportInput,
} from '../schemas';
import type { AccountOption, TaxOption } from './entry-forms';

export function SetupBooksForm({ defaultStart }: { defaultStart: string }) {
  const router = useRouter();
  const { run, error, isPending } = useActionRunner();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.input<typeof setupBooksSchema>, unknown, z.output<typeof setupBooksSchema>>({
    resolver: zodResolver(setupBooksSchema),
    defaultValues: { country: 'AU', startDate: defaultStart, financialYearStartMonth: 7 },
  });
  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        run(
          () => setupBooksAction(values),
          // The page becomes the overview once the books exist; it carries the confirmation.
          (data) => router.replace(`/books?setup=${data.posted}`),
        ),
      )}
      className="grid gap-4 sm:grid-cols-3"
    >
      <Field name="country" label="Country">
        <NativeSelect {...fieldA11y('country')} {...register('country')}>
          <option value="AU">Australia (GST, BAS, PAYG, super)</option>
        </NativeSelect>
      </Field>
      <Field
        name="startDate"
        label="Books start on"
        hint="Earlier activity comes in as opening balances"
        error={errors.startDate?.message}
      >
        <Input type="date" {...fieldA11y('startDate')} {...register('startDate')} />
      </Field>
      <Field name="financialYearStartMonth" label="Financial year starts in">
        <NativeSelect
          {...fieldA11y('financialYearStartMonth')}
          {...register('financialYearStartMonth')}
        >
          {MONTHS.map((month, index) => (
            <option key={month} value={index + 1}>
              {month}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-3">
        <ErrorNote error={error} />
        <div>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Setting up…' : 'Set up the books'}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Voids an entry by posting its reversal. Asks first: it cannot be undone. */
export function VoidEntryButton({ id }: { id: string }) {
  const router = useRouter();
  const { run, error, isPending } = useActionRunner();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Void
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
      <p>
        Voiding posts a reversing entry. The original stays on record. If its date is locked, the
        reversal is dated today.
      </p>
      <Input
        aria-label="Reason (optional)"
        placeholder="Reason (optional)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={isPending}
          onClick={() =>
            run(
              () => voidEntryAction({ id, reason }),
              (data) => router.push(`/books/entries/${data.reversalId}`),
            )
          }
        >
          {isPending ? 'Voiding…' : 'Void this entry'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

export function CatchUpButton() {
  const { run, error, isPending } = useActionRunner();
  const [posted, setPosted] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() =>
            run(
              () => catchUpBooksAction({}),
              (data) => setPosted(data.posted),
            )
          }
        >
          Bring in missing invoices and payslips
        </Button>
      </div>
      {posted !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          {posted === 0 ? 'Everything was already in the books.' : `${posted} entries brought in.`}
        </p>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

export function PayPayslipForm({
  payslipId,
  today,
  banks,
}: {
  payslipId: string;
  today: string;
  banks: AccountOption[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [bankAccountId, setBank] = useState(banks[0]?.id ?? '');
  const [date, setDate] = useState(today);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <NativeSelect
        aria-label="Paid from"
        className="w-auto"
        value={bankAccountId}
        onChange={(event) => setBank(event.target.value)}
      >
        {banks.map((bank) => (
          <option key={bank.id} value={bank.id}>
            {bank.name}
          </option>
        ))}
      </NativeSelect>
      <Input
        type="date"
        aria-label="Paid on"
        className="w-auto"
        value={date}
        onChange={(event) => setDate(event.target.value)}
      />
      <Button
        size="sm"
        disabled={isPending}
        onClick={() => run(() => payPayslipAction({ payslipId, bankAccountId, date }))}
      >
        Record paid
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}

/** Audits the download first, then saves the rows already on the page as a CSV file. */
export function ReportExport({
  report,
  fileName,
  rows,
}: {
  report: ExportReportInput;
  fileName: string;
  rows: Record<string, string | number | null>[];
}) {
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="no-print flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending || rows.length === 0}
        onClick={() =>
          run(
            () => recordBooksExportAction(report),
            () => saveCsv(fileName, toCsv(rows)),
          )
        }
      >
        Export CSV
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}

export function BooksSettingsForm({
  defaults,
  banks,
  incomeAccounts,
}: {
  defaults: BooksSettingsFormValues;
  banks: AccountOption[];
  incomeAccounts: AccountOption[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BooksSettingsFormValues, unknown, z.output<typeof booksSettingsSchema>>({
    resolver: zodResolver(booksSettingsSchema),
    defaultValues: defaults,
  });
  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        run(
          () => saveBooksSettingsAction(values),
          () => setSaved(true),
        ),
      )}
      className="grid gap-4 sm:grid-cols-2"
    >
      <Field name="financialYearStartMonth" label="Financial year starts in">
        <NativeSelect
          {...fieldA11y('financialYearStartMonth')}
          {...register('financialYearStartMonth')}
        >
          {MONTHS.map((month, index) => (
            <option key={month} value={index + 1}>
              {month}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        name="lockDate"
        label="Lock date"
        hint="Nothing on or before this day can change, except by you"
        error={errors.lockDate?.message}
      >
        <Input type="date" {...fieldA11y('lockDate')} {...register('lockDate')} />
      </Field>
      <Field name="receiptsAccountId" label="Invoice payments go into">
        <NativeSelect {...fieldA11y('receiptsAccountId')} {...register('receiptsAccountId')}>
          {banks.map((bank) => (
            <option key={bank.id} value={bank.id}>
              {bank.code} · {bank.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field name="invoiceIncomeAccountId" label="Invoices count as income in">
        <NativeSelect
          {...fieldA11y('invoiceIncomeAccountId')}
          {...register('invoiceIncomeAccountId')}
        >
          {incomeAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} · {account.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <ErrorNote error={error} />
        {saved && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            Saved.
          </p>
        )}
        <div>
          <Button type="submit" disabled={isPending}>
            Save settings
          </Button>
        </div>
      </div>
    </form>
  );
}

export function AccountForm({
  account,
  taxCodes,
}: {
  account?: AccountFormValues & { id: string };
  taxCodes: TaxOption[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<AccountFormValues, unknown, z.output<typeof saveAccountSchema>>({
    resolver: zodResolver(saveAccountSchema),
    defaultValues: account ?? {
      code: '',
      name: '',
      type: 'expense',
      subtype: 'expense',
      isBank: false,
      defaultTaxCodeId: '',
      description: '',
    },
  });
  const type = useWatch({ control, name: 'type' });
  const subtypes = ACCOUNT_TYPES.find((entry) => entry.type === type)?.subtypes ?? [];
  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        run(
          () => saveAccountAction(values),
          () => {
            setSaved(true);
            if (!account) reset();
          },
        ),
      )}
      className="grid gap-4 sm:grid-cols-3"
    >
      <Field name="code" label="Code" error={errors.code?.message} required>
        <Input
          autoComplete="off"
          {...fieldA11y('code', errors.code?.message)}
          {...register('code')}
        />
      </Field>
      <Field
        name="name"
        label="Name"
        error={errors.name?.message}
        required
        className="sm:col-span-2"
      >
        <Input
          autoComplete="off"
          {...fieldA11y('name', errors.name?.message)}
          {...register('name')}
        />
      </Field>
      <Field name="type" label="Type">
        <NativeSelect {...fieldA11y('type')} {...register('type')}>
          {ACCOUNT_TYPES.map((entry) => (
            <option key={entry.type} value={entry.type}>
              {entry.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field name="subtype" label="Report section" error={errors.subtype?.message}>
        <NativeSelect {...fieldA11y('subtype', errors.subtype?.message)} {...register('subtype')}>
          {subtypes.map((subtype: AccountSubtype) => (
            <option key={subtype} value={subtype}>
              {SUBTYPE_LABELS[subtype]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field name="defaultTaxCodeId" label="Usual tax code">
        <NativeSelect {...fieldA11y('defaultTaxCodeId')} {...register('defaultTaxCodeId')}>
          <option value="">None</option>
          {taxCodes.map((code) => (
            <option key={code.id} value={code.id}>
              {code.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {(type === 'asset' || type === 'liability') && (
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input type="checkbox" className="size-4" {...register('isBank')} />
          Money moves through it: a bank, cash or credit card account
        </label>
      )}
      <div className="flex flex-col gap-2 sm:col-span-3">
        <ErrorNote error={error} />
        {saved && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            Saved.
          </p>
        )}
        <div>
          <Button type="submit" disabled={isPending}>
            {account ? 'Save account' : 'Add account'}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function ArchiveAccountButton({ id, archived }: { id: string; archived: boolean }) {
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => run(() => archiveAccountAction({ id, archived: !archived }))}
        >
          {archived ? 'Restore account' : 'Archive account'}
        </Button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

export function TaxCodeForm({ taxCode }: { taxCode?: z.input<typeof saveTaxCodeSchema> }) {
  const { run, error, isPending } = useActionRunner();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.input<typeof saveTaxCodeSchema>, unknown, z.output<typeof saveTaxCodeSchema>>({
    resolver: zodResolver(saveTaxCodeSchema),
    defaultValues: taxCode ?? { code: '', name: '', rate: '0', kind: 'taxable', appliesTo: 'both' },
  });
  const prefix = taxCode?.id ? `tax-${taxCode.id}` : 'tax-new';
  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        run(
          () => saveTaxCodeAction(values),
          () => (taxCode ? undefined : reset()),
        ),
      )}
      className="grid items-end gap-2 sm:grid-cols-12"
    >
      <Field
        name={`${prefix}-code`}
        label="Code"
        error={errors.code?.message}
        className="sm:col-span-2"
      >
        <Input id={`${prefix}-code`} autoComplete="off" {...register('code')} />
      </Field>
      <Field
        name={`${prefix}-name`}
        label="Name"
        error={errors.name?.message}
        className="sm:col-span-3"
      >
        <Input id={`${prefix}-name`} autoComplete="off" {...register('name')} />
      </Field>
      <Field
        name={`${prefix}-rate`}
        label="Rate %"
        error={errors.rate?.message}
        className="sm:col-span-2"
      >
        <Input id={`${prefix}-rate`} inputMode="decimal" {...register('rate')} />
      </Field>
      <Field name={`${prefix}-kind`} label="Kind" className="sm:col-span-2">
        <NativeSelect id={`${prefix}-kind`} {...register('kind')}>
          {Object.entries(TAX_KIND_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field name={`${prefix}-applies`} label="Used on" className="sm:col-span-2">
        <NativeSelect id={`${prefix}-applies`} {...register('appliesTo')}>
          <option value="sales">Sales</option>
          <option value="purchases">Purchases</option>
          <option value="both">Both</option>
        </NativeSelect>
      </Field>
      <div className="sm:col-span-1">
        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
          {taxCode ? 'Save' : 'Add'}
        </Button>
      </div>
      <div className="sm:col-span-12">
        <ErrorNote error={error} />
      </div>
    </form>
  );
}
