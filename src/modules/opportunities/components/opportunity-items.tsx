'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { Field, fieldA11y, searchA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { SearchSelect, type SearchOption } from '@/components/forms/search-select';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CustomFieldInputs } from '@/modules/custom-fields/components/custom-field-inputs';
import { displayCustomValue, type CustomFieldDefinition } from '@/modules/custom-fields/validation';
import {
  createItemAction,
  deleteItemAction,
  moveItemStageAction,
  updateItemAction,
} from '@/modules/opportunities/actions';
import { createItemSchema, type ItemFormValues } from '@/modules/opportunities/schemas';
import type { ItemRow } from '@/modules/opportunities/types';
import type { ParentAdvance } from '@/modules/opportunities/service';
import { searchOrganizationOptionsAction } from '@/modules/organizations/actions';

import { LostReasonDialog } from './lost-reason-dialog';
import { StageBadge } from './stage-badge';

type Option = { value: string; label: string };
type ItemStage = { id: string; name: string; category: 'open' | 'won' | 'lost' };
type Names = { singular: string; plural: string };

async function searchOrganizations(q: string): Promise<SearchOption[]> {
  const result = await searchOrganizationOptionsAction({ q });
  return result.ok ? result.data : [];
}

/** What an item's move did to its opportunity, in words. */
function advanceNote(advance: ParentAdvance | null, opportunity: string): string | null {
  if (!advance) return null;
  if (advance.outcome === 'moved') return `The ${opportunity} moved to ${advance.stageName}.`;
  if (advance.outcome === 'requested') {
    return `Moving the ${opportunity} to ${advance.stageName} needs approval; the request has been sent.`;
  }
  return `The ${opportunity} stays where it is: ${advance.message ?? 'a stage rule is not met.'}`;
}

/** One line under an item: its expected revenue and how it was worked out, and why it was lost. */
function itemSummary(item: ItemRow, fallbackCurrency: string, canViewRevenue: boolean): string {
  const currency = item.currency ?? fallbackCurrency;
  const parts: string[] = [];
  if (canViewRevenue && item.expectedRevenue !== null) {
    const basis =
      item.revenueRate !== null && item.baseAmount !== null
        ? ` (${Number(item.revenueRate)}% of ${formatMoney(item.baseAmount, currency)})`
        : '';
    parts.push(`Expected ${formatMoney(item.expectedRevenue, currency)}${basis}`);
  }
  if (item.status === 'lost' && item.lostReasonName) parts.push(`Lost: ${item.lostReasonName}`);
  return parts.join(' · ');
}

function ItemForm({
  opportunityId,
  item,
  stages,
  owners,
  canAssign,
  canViewRevenue,
  currency,
  customFields,
  names,
  organizationName,
  onDone,
}: {
  opportunityId: string;
  item: ItemRow | null;
  stages: ItemStage[];
  owners: Option[];
  canAssign: boolean;
  canViewRevenue: boolean;
  currency: string;
  customFields: CustomFieldDefinition[];
  names: { item: Names; organization: Names; opportunity: Names };
  organizationName: string | null;
  onDone: (note: string | null) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const openStages = stages.filter((stage) => stage.category === 'open');
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormValues, unknown, ItemFormValues>({
    // Submits what was typed; the Server Action parses it with the same schema.
    resolver: zodResolver(createItemSchema, undefined, { raw: true }),
    defaultValues: {
      opportunityId,
      organizationId: item?.organizationId ?? '',
      title: item?.title ?? '',
      stageId: openStages[0]?.id ?? '',
      externalReference: item?.externalReference ?? '',
      baseAmount: item?.baseAmount ?? '',
      revenueRate: item?.revenueRate ?? '',
      expectedRevenue: item?.expectedRevenue ?? '',
      currency: item?.currency ?? '',
      ownerUserId: item?.ownerUserId ?? '',
      customFields: item?.customFields ?? {},
    },
  });
  const customError = (key: string) =>
    (errors.customFields as Record<string, { message?: string }> | undefined)?.[key]?.message;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = item
      ? await updateItemAction({ ...values, id: item.id })
      : await createItemAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        const path = field.startsWith('custom.') ? `customFields.${field.slice(7)}` : field;
        setError(path as keyof ItemFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    // Only a new item can enter a stage, and so move its opportunity.
    const advance: ParentAdvance | null =
      'parentAdvance' in result.data ? (result.data.parentAdvance as ParentAdvance | null) : null;
    onDone(advanceNote(advance, names.opportunity.singular.toLowerCase()));
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 px-4 pb-4">
      <Field name="item-title" label="Title" required error={errors.title?.message}>
        <Input
          autoComplete="off"
          placeholder="e.g. Master of Data Science, February intake"
          {...fieldA11y('item-title', errors.title?.message)}
          {...register('title')}
        />
      </Field>
      <Field
        name="item-organization"
        label={names.organization.singular}
        required
        error={errors.organizationId?.message}
      >
        <Controller
          control={control}
          name="organizationId"
          render={({ field }) => (
            <SearchSelect
              {...searchA11y('item-organization', errors.organizationId?.message)}
              value={field.value ?? ''}
              selectedLabel={organizationName}
              onChange={(value) => field.onChange(value)}
              search={searchOrganizations}
              placeholder={`Search ${names.organization.plural.toLowerCase()}…`}
            />
          )}
        />
      </Field>
      {!item && openStages.length > 1 && (
        <Field name="item-stage" label="Starts in" error={errors.stageId?.message}>
          <NativeSelect
            {...fieldA11y('item-stage', errors.stageId?.message)}
            {...register('stageId')}
          >
            {openStages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field
        name="item-reference"
        label="Their reference"
        hint="Their own number for it, e.g. an application or student ID."
        error={errors.externalReference?.message}
      >
        <Input
          autoComplete="off"
          {...fieldA11y('item-reference', errors.externalReference?.message)}
          {...register('externalReference')}
        />
      </Field>
      {canViewRevenue && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">Revenue</legend>
          <Field
            name="item-base"
            label="Based on"
            hint="e.g. the tuition fee a commission is paid on"
            error={errors.baseAmount?.message}
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              {...fieldA11y('item-base', errors.baseAmount?.message)}
              {...register('baseAmount')}
            />
          </Field>
          <Field name="item-rate" label="Rate (%)" error={errors.revenueRate?.message}>
            <Input
              inputMode="decimal"
              autoComplete="off"
              {...fieldA11y('item-rate', errors.revenueRate?.message)}
              {...register('revenueRate')}
            />
          </Field>
          <Field
            name="item-expected"
            label="Expected revenue"
            hint="Left empty, it is worked out from the amount and rate."
            error={errors.expectedRevenue?.message}
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              {...fieldA11y('item-expected', errors.expectedRevenue?.message)}
              {...register('expectedRevenue')}
            />
          </Field>
          <Field name="item-currency" label="Currency" error={errors.currency?.message}>
            <Input
              autoComplete="off"
              maxLength={3}
              placeholder={currency}
              className="uppercase"
              {...fieldA11y('item-currency', errors.currency?.message)}
              {...register('currency')}
            />
          </Field>
        </fieldset>
      )}
      <Field name="item-owner" label="Who handles it" error={errors.ownerUserId?.message}>
        <NativeSelect
          disabled={!canAssign}
          {...fieldA11y('item-owner', errors.ownerUserId?.message)}
          {...register('ownerUserId')}
        >
          <option value="">{`Same as the ${names.opportunity.singular.toLowerCase()}`}</option>
          {owners.map((owner) => (
            <option key={owner.value} value={owner.value}>
              {owner.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {customFields.some((field) => field.isActive) && (
        <div className="grid gap-3">
          <CustomFieldInputs
            fields={customFields}
            register={(key) => register(`customFields.${key}`)}
            errorFor={customError}
          />
        </div>
      )}
      {formError && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : item ? 'Save' : `Add ${names.item.singular.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}

/**
 * An opportunity's items (ADR-018): each with its own stage, value and outcome. Moving one may
 * move the opportunity forward, and the panel says what happened.
 */
export function OpportunityItems({
  opportunityId,
  items,
  stages,
  lostReasons,
  owners,
  customFields,
  names,
  currency,
  hasPipeline,
  canEdit,
  canDelete,
  canAssign,
  canViewRevenue,
  canConfigure,
}: {
  opportunityId: string;
  items: ItemRow[];
  /** The active stages of the item pipeline new items go into. */
  stages: ItemStage[];
  lostReasons: { id: string; name: string }[];
  owners: Option[];
  customFields: CustomFieldDefinition[];
  names: { item: Names; organization: Names; opportunity: Names };
  currency: string;
  hasPipeline: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canAssign: boolean;
  canViewRevenue: boolean;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ItemRow | 'new' | null>(null);
  const [askLost, setAskLost] = useState<{ itemId: string; stageId: string } | null>(null);
  const [removing, setRemoving] = useState<ItemRow | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opportunity = names.opportunity.singular.toLowerCase();

  const move = (itemId: string, stageId: string, lostReasonId?: string, lostReasonNote?: string) =>
    startTransition(async () => {
      setError(null);
      setNote(null);
      const result = await moveItemStageAction({
        id: itemId,
        stageId,
        lostReasonId,
        lostReasonNote,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setAskLost(null);
      setNote(advanceNote(result.data.parentAdvance, opportunity));
      router.refresh();
    });

  const remove = (item: ItemRow) =>
    startTransition(async () => {
      setError(null);
      const result = await deleteItemAction({ id: item.id });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setRemoving(null);
      router.refresh();
    });

  if (!hasPipeline && items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {`Track several ${names.item.plural.toLowerCase()} in one ${opportunity}, each with its own stage and value.`}{' '}
        {canConfigure ? (
          <Link href="/settings?tab=pipeline" className="text-primary hover:underline">
            Add a pipeline for them in Settings.
          </Link>
        ) : (
          'An admin can switch this on in Settings.'
        )}
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', isPending && 'opacity-80')}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{`No ${names.item.plural.toLowerCase()} yet.`}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {items.map((item) => {
            const shownCustom = customFields.filter(
              (field) =>
                item.customFields[field.key] !== undefined && item.customFields[field.key] !== '',
            );
            return (
              <li key={item.id} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      <Link
                        href={`/organizations/${item.organizationId}`}
                        className="hover:text-primary hover:underline"
                      >
                        {item.organizationName}
                      </Link>
                      {item.externalReference && ` · Ref ${item.externalReference}`}
                      {item.ownerName && ` · ${item.ownerName}`}
                    </p>
                  </div>
                  {canEdit ? (
                    <NativeSelect
                      aria-label={`Stage of ${item.title}`}
                      className="h-8 w-auto max-w-44"
                      value={item.stageId}
                      disabled={isPending}
                      onChange={(event) => {
                        const target = stages.find((stage) => stage.id === event.target.value);
                        if (!target) return;
                        if (target.category === 'lost')
                          setAskLost({ itemId: item.id, stageId: target.id });
                        else move(item.id, target.id);
                      }}
                    >
                      {/* An item can sit in a stage that was later switched off. */}
                      {!stages.some((stage) => stage.id === item.stageId) && (
                        <option value={item.stageId}>{item.stageName}</option>
                      )}
                      {stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <StageBadge name={item.stageName} color={item.stageColor} />
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{itemSummary(item, currency, canViewRevenue)}</span>
                  <span className="flex gap-1">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>
                        <Pencil aria-hidden /> Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(item)}>
                        <Trash2 aria-hidden /> Remove
                      </Button>
                    )}
                  </span>
                </div>
                {shownCustom.length > 0 && (
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {shownCustom.map((field) => (
                      <div key={field.id} className="min-w-0">
                        <dt className="text-muted-foreground">{field.label}</dt>
                        <dd className="truncate">
                          {displayCustomValue(field, item.customFields[field.key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {note && (
        <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">{note}</p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          {error}
        </p>
      )}
      {canEdit && hasPipeline && (
        <Button variant="outline" className="w-fit" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> {`Add ${names.item.singular.toLowerCase()}`}
        </Button>
      )}

      {editing && (
        <Sheet open onOpenChange={(open) => !open && setEditing(null)}>
          <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>
                {editing === 'new'
                  ? `Add ${names.item.singular.toLowerCase()}`
                  : `Edit ${names.item.singular.toLowerCase()}`}
              </SheetTitle>
              <SheetDescription>
                {`One ${names.item.singular.toLowerCase()} with one ${names.organization.singular.toLowerCase()}, tracked on its own stage.`}
              </SheetDescription>
            </SheetHeader>
            <ItemForm
              opportunityId={opportunityId}
              item={editing === 'new' ? null : editing}
              stages={stages}
              owners={owners}
              canAssign={canAssign}
              canViewRevenue={canViewRevenue}
              currency={currency}
              customFields={customFields}
              names={names}
              organizationName={editing === 'new' ? null : editing.organizationName}
              onDone={(message) => {
                setEditing(null);
                setNote(message);
                router.refresh();
              }}
            />
          </SheetContent>
        </Sheet>
      )}

      <LostReasonDialog
        open={askLost !== null}
        reasons={lostReasons}
        pending={isPending}
        onCancel={() => setAskLost(null)}
        onConfirm={(reasonId, lostNote) =>
          askLost && move(askLost.itemId, askLost.stageId, reasonId, lostNote)
        }
      />

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Remove ${removing?.title ?? ''}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {`It disappears from this ${opportunity}. Its history stays in the audit log.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => removing && remove(removing)}
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
