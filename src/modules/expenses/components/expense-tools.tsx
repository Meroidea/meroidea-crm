'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createBrowserClient } from '@supabase/ssr';
import { Check, Paperclip, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
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
import { publicEnv } from '@/lib/env.public';
import {
  decideExpenseAction,
  getReceiptUrlAction,
  markReimbursedAction,
  startReceiptUploadAction,
  submitExpenseAction,
  withdrawExpenseAction,
} from '@/modules/expenses/actions';
import {
  MAX_RECEIPT_BYTES,
  RECEIPT_ACCEPT,
  RECEIPT_FORMATS,
  receiptExtension,
} from '@/modules/expenses/receipts';
import {
  EXPENSE_CATEGORIES,
  submitExpenseSchema,
  type SubmitExpenseInput,
  type SubmitExpenseValues,
} from '@/modules/expenses/schemas';

export function NewExpenseButton({ today, currency }: { today: string; currency: string }) {
  const router = useRouter();
  const [receipt, setReceipt] = useState<File | null>(null);
  // Changing the key gives a fresh, empty file input after a claim is sent.
  const [fileKey, setFileKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SubmitExpenseValues, unknown, SubmitExpenseInput>({
    resolver: zodResolver(submitExpenseSchema),
    defaultValues: { spentOn: today, category: '', merchant: '', description: '', amount: '' },
  });

  /** Sends the receipt straight to private storage and returns where the server put it. */
  const uploadReceipt = async (upload: File) => {
    const extension = receiptExtension(upload.name);
    if (!extension) return { error: 'A receipt must be a photo (JPG, PNG, WebP) or a PDF.' };
    if (upload.size > MAX_RECEIPT_BYTES) return { error: 'Receipts can be up to 10 MB.' };
    const ticket = await startReceiptUploadAction({
      fileName: upload.name,
      sizeBytes: upload.size,
    });
    if (!ticket.ok) return { error: ticket.error.message };
    const sent = await createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey)
      .storage.from('documents')
      .uploadToSignedUrl(ticket.data.path, ticket.data.token, upload, {
        contentType: RECEIPT_FORMATS[extension].mimeType,
      });
    if (sent.error) return { error: 'The receipt did not upload. Try again.' };
    return { path: ticket.data.path };
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    let attached: { receiptPath?: string; receiptName?: string } = {};
    if (receipt) {
      const uploaded = await uploadReceipt(receipt);
      if (uploaded.error || !uploaded.path) {
        return setFormError(uploaded.error ?? 'The receipt did not upload.');
      }
      attached = { receiptPath: uploaded.path, receiptName: receipt.name };
    }
    const result = await submitExpenseAction({ ...values, ...attached });
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof SubmitExpenseValues, { message: messages[0] });
      }
      return setFormError(result.error.message);
    }
    reset();
    setReceipt(null);
    setFileKey((key) => key + 1);
    setOpen(false);
    router.refresh();
  });

  const input = (name: keyof SubmitExpenseValues) => ({
    ...fieldA11y(name, errors[name]?.message),
    ...register(name),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> New expense
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>New expense</SheetTitle>
            <SheetDescription>
              Something you paid for yourself. It goes to a manager to approve.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col gap-4 px-4 pb-4">
            <div className="grid grid-cols-2 gap-3">
              <Field name="spentOn" label="Date" error={errors.spentOn?.message}>
                <Input type="date" max={today} {...input('spentOn')} />
              </Field>
              <Field name="amount" label={`Amount (${currency})`} error={errors.amount?.message}>
                <Input inputMode="decimal" placeholder="0.00" {...input('amount')} />
              </Field>
            </div>
            <Field name="category" label="Category" error={errors.category?.message}>
              <Input list="expense-categories" placeholder="Travel" {...input('category')} />
              <datalist id="expense-categories">
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </Field>
            <Field name="merchant" label="Paid to (optional)" error={errors.merchant?.message}>
              <Input {...input('merchant')} />
            </Field>
            <Field name="description" label="What was it for?" error={errors.description?.message}>
              <Textarea rows={3} {...input('description')} />
            </Field>
            <Field name="receipt" label="Receipt" hint="A photo or PDF, up to 10 MB.">
              <Input
                id="receipt"
                key={fileKey}
                type="file"
                accept={RECEIPT_ACCEPT}
                onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
              />
            </Field>
            {formError && (
              <p role="alert" className="text-sm text-destructive-text">
                {formError}
              </p>
            )}
            <SheetFooter className="mt-auto px-0">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send for approval'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

type Result = { ok: true } | { ok: false; error: { message: string } };

export function ExpenseActions({
  id,
  hasReceipt,
  canDecide,
  canPay,
  canWithdraw,
}: {
  id: string;
  hasReceipt: boolean;
  canDecide: boolean;
  canPay: boolean;
  canWithdraw: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.error.message);
      router.refresh();
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1.5">
        {hasReceipt && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await getReceiptUrlAction({ id });
                if (!result.ok) return setError(result.error.message);
                window.open(result.data.url, '_blank', 'noopener');
              })
            }
          >
            <Paperclip aria-hidden /> Receipt
          </Button>
        )}
        {canDecide && (
          <>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => run(() => decideExpenseAction({ id, decision: 'approved' }))}
            >
              <Check aria-hidden /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => run(() => decideExpenseAction({ id, decision: 'declined' }))}
            >
              <X aria-hidden /> Decline
            </Button>
          </>
        )}
        {canPay && (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(() => markReimbursedAction({ id }))}
          >
            Mark as paid back
          </Button>
        )}
        {canWithdraw && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => run(() => withdrawExpenseAction({ id }))}
          >
            Withdraw
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
