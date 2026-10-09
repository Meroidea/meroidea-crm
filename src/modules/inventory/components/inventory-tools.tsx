'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ArchiveRestore, ArrowLeftRight, Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';

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
import { cn } from '@/lib/utils';
import {
  createItemAction,
  recordMovementAction,
  setItemActiveAction,
  updateItemAction,
} from '@/modules/inventory/actions';
import { formatQuantity } from '@/modules/inventory/format';
import {
  createItemSchema,
  MOVEMENT_KIND_LABELS,
  MOVEMENT_KINDS,
  recordMovementSchema,
  type CreateItemInput,
  type ItemFormValues,
  type MovementFormValues,
  type RecordMovementInput,
} from '@/modules/inventory/schemas';
import type { InventoryItemDetail } from '@/modules/inventory/types';

function Panel({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}

function ItemForm({
  item,
  categories,
  currency,
  onDone,
}: {
  item?: InventoryItemDetail;
  categories: string[];
  currency: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormValues, unknown, CreateItemInput>({
    resolver: zodResolver(createItemSchema),
    defaultValues: {
      name: item?.name ?? '',
      sku: item?.sku ?? '',
      category: item?.categoryName ?? '',
      unit: item?.unit ?? 'each',
      reorderLevel: item?.reorderLevel ? formatQuantity(item.reorderLevel) : '',
      unitCost: item?.unitCost ?? '',
      supplierName: item?.supplierName ?? '',
      notes: item?.notes ?? '',
      openingQuantity: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = item
      ? await updateItemAction({ ...values, id: item.id })
      : await createItemAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof ItemFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    onDone();
    router.refresh();
  });

  const input = (name: keyof ItemFormValues) => ({
    ...fieldA11y(name, errors[name]?.message),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
      <div className="grid grid-cols-2 gap-4 px-4">
        <Field
          name="name"
          label="Item"
          error={errors.name?.message}
          className="col-span-2"
          required
        >
          <Input autoComplete="off" {...input('name')} />
        </Field>
        <Field
          name="sku"
          label="Code"
          hint="Your own reference, if you use one"
          error={errors.sku?.message}
        >
          <Input autoComplete="off" {...input('sku')} />
        </Field>
        <Field
          name="unit"
          label="Counted in"
          hint="each, kg, box, litre…"
          error={errors.unit?.message}
          required
        >
          <Input autoComplete="off" list="inventory-units" {...input('unit')} />
          <datalist id="inventory-units">
            {['each', 'kg', 'g', 'L', 'mL', 'box', 'pack', 'carton', 'm'].map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
        </Field>
        <Field
          name="category"
          label="Category"
          hint="Pick one or type a new one"
          error={errors.category?.message}
          className="col-span-2"
        >
          <Input autoComplete="off" list="inventory-categories" {...input('category')} />
          <datalist id="inventory-categories">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </Field>
        {!item && (
          <Field
            name="openingQuantity"
            label="On hand now"
            hint="Recorded as the first count"
            error={errors.openingQuantity?.message}
          >
            <Input inputMode="decimal" autoComplete="off" {...input('openingQuantity')} />
          </Field>
        )}
        <Field
          name="reorderLevel"
          label="Reorder at"
          hint="Flag as low at or below this"
          error={errors.reorderLevel?.message}
        >
          <Input inputMode="decimal" autoComplete="off" {...input('reorderLevel')} />
        </Field>
        <Field
          name="unitCost"
          label={`Cost per unit (${currency})`}
          error={errors.unitCost?.message}
        >
          <Input inputMode="decimal" autoComplete="off" {...input('unitCost')} />
        </Field>
        <Field
          name="supplierName"
          label="Supplier"
          error={errors.supplierName?.message}
          className="col-span-2"
        >
          <Input autoComplete="off" {...input('supplierName')} />
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
          {item ? 'Save changes' : 'Add item'}
        </Button>
      </SheetFooter>
    </form>
  );
}

export function AddItemButton({
  categories,
  currency,
}: {
  categories: string[];
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add item
      </Button>
      <Panel
        open={open}
        onClose={() => setOpen(false)}
        title="Add an item"
        description="Something you keep in stock and want to keep count of."
      >
        {open && (
          <ItemForm categories={categories} currency={currency} onDone={() => setOpen(false)} />
        )}
      </Panel>
    </>
  );
}

export function EditItemButton({
  item,
  categories,
}: {
  item: InventoryItemDetail;
  categories: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil aria-hidden /> Edit details
      </Button>
      <Panel
        open={open}
        onClose={() => setOpen(false)}
        title="Edit item"
        description="Quantity is changed by recording stock, not here, so every change leaves a record."
      >
        {open && (
          <ItemForm
            item={item}
            categories={categories}
            currency={item.currency}
            onDone={() => setOpen(false)}
          />
        )}
      </Panel>
    </>
  );
}

function StockForm({
  item,
  onDone,
}: {
  item: { id: string; unit: string; quantityOnHand: string; currency: string };
  onDone: () => void;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MovementFormValues, unknown, RecordMovementInput>({
    resolver: zodResolver(recordMovementSchema),
    defaultValues: { itemId: item.id, kind: 'received', quantity: '', unitCost: '', note: '' },
  });
  const kind = useWatch({ control, name: 'kind' });
  const needsReason = kind === 'wasted' || kind === 'add' || kind === 'remove';

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await recordMovementAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof MovementFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    onDone();
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
      <div className="flex flex-col gap-4 px-4">
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          On hand now:{' '}
          <span className="font-medium text-foreground tabular-nums">
            {formatQuantity(item.quantityOnHand)} {item.unit}
          </span>
        </p>
        <fieldset>
          <legend className="text-sm font-medium">What happened?</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {MOVEMENT_KINDS.map((option) => (
              <label
                key={option}
                className={cn(
                  'flex cursor-pointer flex-col rounded-lg border px-3 py-2 transition-colors',
                  kind === option
                    ? 'border-primary bg-accent text-accent-foreground'
                    : 'hover:bg-muted',
                )}
              >
                <input type="radio" value={option} className="sr-only" {...register('kind')} />
                <span className="text-sm font-medium">{MOVEMENT_KIND_LABELS[option].title}</span>
                <span className="text-xs text-muted-foreground">
                  {MOVEMENT_KIND_LABELS[option].hint}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-4">
          <Field
            name="quantity"
            label={kind === 'stocktake' ? `Counted (${item.unit})` : `Quantity (${item.unit})`}
            error={errors.quantity?.message}
            required
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              {...fieldA11y('quantity', errors.quantity?.message)}
              {...register('quantity')}
            />
          </Field>
          {kind === 'received' && (
            <Field
              name="unitCost"
              label={`Cost per unit (${item.currency})`}
              hint="Updates the item’s cost"
              error={errors.unitCost?.message}
            >
              <Input
                inputMode="decimal"
                autoComplete="off"
                {...fieldA11y('unitCost', errors.unitCost?.message)}
                {...register('unitCost')}
              />
            </Field>
          )}
        </div>
        <Field
          name="note"
          label={needsReason ? 'Reason' : 'Note'}
          error={errors.note?.message}
          required={needsReason}
        >
          <Input
            autoComplete="off"
            {...fieldA11y('note', errors.note?.message)}
            {...register('note')}
          />
        </Field>
        {formError && (
          <p role="alert" className="text-sm text-destructive-text">
            {formError}
          </p>
        )}
      </div>
      <SheetFooter className="flex-row justify-end">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          Record
        </Button>
      </SheetFooter>
    </form>
  );
}

export function UpdateStockButton({
  item,
  compact = false,
}: {
  item: { id: string; name: string; unit: string; quantityOnHand: string; currency: string };
  /** A small button for table rows. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={compact ? 'outline' : 'default'}
        size={compact ? 'sm' : 'default'}
        onClick={() => setOpen(true)}
        aria-label={compact ? `Update stock for ${item.name}` : undefined}
      >
        <ArrowLeftRight aria-hidden /> Update stock
      </Button>
      <Panel
        open={open}
        onClose={() => setOpen(false)}
        title={`Update stock: ${item.name}`}
        description="Every change is kept in the item’s history and cannot be edited afterwards."
      >
        {open && <StockForm item={item} onDone={() => setOpen(false)} />}
      </Panel>
    </>
  );
}

export function ArchiveItemButton({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await setItemActiveAction({ id, isActive: !isActive });
          router.refresh();
        })
      }
    >
      {isActive ? <Archive aria-hidden /> : <ArchiveRestore aria-hidden />}
      {isActive ? 'Archive' : 'Restore'}
    </Button>
  );
}
