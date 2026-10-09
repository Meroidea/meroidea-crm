'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ArchiveRestore, FileSpreadsheet, Pencil, Plus, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/lib/format';
import { readSpreadsheet } from '@/lib/spreadsheet';
import {
  createSupplierAction,
  importPriceListAction,
  setSupplierActiveAction,
  updateSupplierAction,
} from '@/modules/purchasing/actions';
import { parsePriceList, type ParsedPriceList } from '@/modules/purchasing/price-list';
import { WEEKDAYS } from '@/modules/purchasing/schedule';
import {
  createSupplierSchema,
  type CreateSupplierInput,
  type SupplierFormValues,
} from '@/modules/purchasing/schemas';
import type { SupplierDetail } from '@/modules/purchasing/types';

function SupplierForm({ supplier, onDone }: { supplier?: SupplierDetail; onDone: () => void }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SupplierFormValues, unknown, CreateSupplierInput>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: {
      name: supplier?.name ?? '',
      contactName: supplier?.contactName ?? '',
      orderEmail: supplier?.orderEmail ?? '',
      phone: supplier?.phone ?? '',
      accountNumber: supplier?.accountNumber ?? '',
      notes: supplier?.notes ?? '',
      deliveryDays: (supplier?.deliveryDays ?? []).map(String) as unknown as number[],
      leadDays: supplier?.leadDays ?? 1,
      cutoffTime: supplier?.cutoffTime ?? '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = supplier
      ? await updateSupplierAction({ ...values, id: supplier.id })
      : await createSupplierAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof SupplierFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    onDone();
    if (!supplier) router.push(`/suppliers/${result.data.id}`);
    router.refresh();
  });

  const input = (name: keyof SupplierFormValues) => ({
    ...fieldA11y(name, errors[name]?.message),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
      <div className="grid grid-cols-2 gap-4 px-4">
        <Field
          name="name"
          label="Supplier"
          error={errors.name?.message}
          className="col-span-2"
          required
        >
          <Input autoComplete="off" {...input('name')} />
        </Field>
        <Field
          name="orderEmail"
          label="Order email"
          hint="Orders are sent here"
          error={errors.orderEmail?.message}
          className="col-span-2"
        >
          <Input type="email" autoComplete="off" {...input('orderEmail')} />
        </Field>
        <Field name="contactName" label="Contact person" error={errors.contactName?.message}>
          <Input autoComplete="off" {...input('contactName')} />
        </Field>
        <Field name="phone" label="Phone" error={errors.phone?.message}>
          <Input type="tel" autoComplete="off" {...input('phone')} />
        </Field>
        <Field
          name="accountNumber"
          label="Your account number"
          hint="Quoted on every order"
          error={errors.accountNumber?.message}
          className="col-span-2"
        >
          <Input autoComplete="off" {...input('accountNumber')} />
        </Field>

        <fieldset className="col-span-2">
          <legend className="text-sm font-medium">Delivery days</legend>
          <p className="text-xs text-muted-foreground">
            Leave all unticked if they deliver any day.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day, index) => (
              <label
                key={day}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm has-checked:border-primary has-checked:bg-accent has-checked:text-accent-foreground"
              >
                <input
                  type="checkbox"
                  value={index}
                  className="size-3.5 accent-primary"
                  {...register('deliveryDays')}
                />
                {day.slice(0, 3)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          name="leadDays"
          label="Order ahead (days)"
          hint="0 = same day"
          error={errors.leadDays?.message}
        >
          <Input type="number" min={0} max={60} inputMode="numeric" {...input('leadDays')} />
        </Field>
        <Field
          name="cutoffTime"
          label="Order by (time)"
          hint="On the last ordering day"
          error={errors.cutoffTime?.message}
        >
          <Input type="time" {...input('cutoffTime')} />
        </Field>
        <Field name="notes" label="Notes" error={errors.notes?.message} className="col-span-2">
          <Textarea rows={2} {...input('notes')} />
        </Field>
        {formError && (
          <p role="alert" className="col-span-2 text-sm text-destructive-text">
            {formError}
          </p>
        )}
      </div>
      <SheetFooter className="flex-row justify-end">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {supplier ? 'Save changes' : 'Add supplier'}
        </Button>
      </SheetFooter>
    </form>
  );
}

export function SupplierFormButton({ supplier }: { supplier?: SupplierDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={supplier ? 'outline' : 'default'} onClick={() => setOpen(true)}>
        {supplier ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {supplier ? 'Edit details' : 'Add supplier'}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{supplier ? 'Edit supplier' : 'Add a supplier'}</SheetTitle>
            <SheetDescription>
              Who you order from, where orders go, and when they deliver. You add their price list
              next.
            </SheetDescription>
          </SheetHeader>
          {open && <SupplierForm supplier={supplier} onDone={() => setOpen(false)} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function ArchiveSupplierButton({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await setSupplierActiveAction({ id, isActive: !isActive });
          router.refresh();
        })
      }
    >
      {isActive ? <Archive aria-hidden /> : <ArchiveRestore aria-hidden />}
      {isActive ? 'Archive' : 'Restore'}
    </Button>
  );
}

/** Upload a supplier's price list, check what was understood, then load it. */
export function PriceListImport({
  supplierId,
  currency,
  hasItems,
}: {
  supplierId: string;
  currency: string;
  hasItems: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedPriceList | null>(null);
  const [replace, setReplace] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const choose = async (file: File | undefined) => {
    setParsed(null);
    setMessage(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const result = parsePriceList(await readSpreadsheet(file));
      if ('error' in result) return setMessage({ tone: 'error', text: result.error });
      if (result.items.length === 0) {
        return setMessage({
          tone: 'error',
          text: 'No rows with both an item name and a price were found.',
        });
      }
      setParsed(result);
    } catch {
      setMessage({
        tone: 'error',
        text: 'That file could not be read. Use an Excel workbook (.xlsx) or a CSV file. Older .xls files need saving as .xlsx first.',
      });
    }
  };

  const load = () =>
    startTransition(async () => {
      if (!parsed) return;
      const result = await importPriceListAction({ supplierId, replace, items: parsed.items });
      if (!result.ok) return setMessage({ tone: 'error', text: result.error.message });
      const { added, updated, removed } = result.data;
      setMessage({
        tone: 'ok',
        text: `Price list loaded: ${added} added, ${updated} updated${removed ? `, ${removed} removed` : ''}.`,
      });
      setParsed(null);
      setFileName(null);
      if (fileInput.current) fileInput.current.value = '';
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4">
      <div className="flex flex-wrap items-center gap-3">
        <FileSpreadsheet aria-hidden className="size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {hasItems ? 'Update the price list' : 'Upload their price list'}
          </p>
          <p className="text-xs text-muted-foreground">
            An Excel (.xlsx) or CSV file with a header row: an item column and a price column, and
            optionally a code and a unit or pack-size column.
          </p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.csv"
          className="sr-only"
          id="price-list-file"
          onChange={(event) => choose(event.target.files?.[0])}
        />
        <Button asChild variant="outline">
          <label htmlFor="price-list-file" className="cursor-pointer">
            <Upload aria-hidden /> Choose file
          </label>
        </Button>
      </div>

      {parsed && (
        <div className="flex flex-col gap-3 rounded-lg bg-muted/60 p-3 text-sm">
          <p>
            <span className="font-medium">{fileName}</span>: {parsed.items.length} items found
            {parsed.skipped > 0 &&
              `, ${parsed.skipped} ${parsed.skipped === 1 ? 'row' : 'rows'} skipped (no name or no price)`}
            .
          </p>
          <p className="text-xs text-muted-foreground">
            Read “{parsed.columns.name}” as the item and “{parsed.columns.price}” as the price
            {parsed.columns.code && `, “${parsed.columns.code}” as the code`}
            {parsed.columns.unit && `, “${parsed.columns.unit}” as the unit`}.
          </p>
          <ul className="divide-y rounded-md border bg-card">
            {parsed.items.slice(0, 5).map((item, index) => (
              <li key={index} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 truncate">
                  {item.code && <span className="text-muted-foreground">{item.code} · </span>}
                  {item.name}
                  {item.unit && <span className="text-muted-foreground"> · {item.unit}</span>}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatMoney(item.unitPrice, currency)}
                </span>
              </li>
            ))}
          </ul>
          {parsed.items.length > 5 && (
            <p className="text-xs text-muted-foreground">…and {parsed.items.length - 5} more.</p>
          )}
          {hasItems && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={replace}
                onChange={(event) => setReplace(event.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                Remove items that are not in this file
                <span className="block text-xs text-muted-foreground">
                  Leave unticked to only add new items and update prices.
                </span>
              </span>
            </label>
          )}
          <Button onClick={load} disabled={isPending} className="self-start">
            Load {parsed.items.length} items
          </Button>
        </div>
      )}
      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={
            message.tone === 'error' ? 'text-sm text-destructive-text' : 'text-sm text-foreground'
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
