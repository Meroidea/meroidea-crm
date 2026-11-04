'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/format';
import { formatCents, parseCents } from '@/modules/books/money';

import {
  issueCreditNoteAction,
  recordPaymentAction,
  voidCreditNoteAction,
  voidPaymentAction,
} from '../actions';
import type { OutstandingInvoice } from '../queries';
import { invoiceNumber } from '../types';

export type BankOption = { id: string; label: string };

function BankSelect({
  banks,
  value,
  onChange,
}: {
  banks: BankOption[] | null;
  value: string;
  onChange: (value: string) => void;
}) {
  if (!banks || banks.length === 0) return null;
  return (
    <label className="flex flex-col gap-1 text-sm">
      Paid into
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Usual account for receipts</option>
        {banks.map((bank) => (
          <option key={bank.id} value={bank.id}>
            {bank.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

/** Records money received against this invoice: all of what is owed by default, or part of it. */
export function RecordPaymentForm({
  invoiceId,
  balance,
  customerName,
  today,
  banks,
}: {
  invoiceId: string;
  balance: string;
  customerName: string;
  today: string;
  banks: BankOption[] | null;
}) {
  const { run, error, isPending } = useActionRunner();
  const [amount, setAmount] = useState(balance);
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState('');
  const [accountId, setAccountId] = useState('');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(() =>
          recordPaymentAction({
            date,
            payerName: customerName,
            reference,
            accountId,
            allocations: [{ invoiceId, amount }],
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
          Received on
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Reference
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <BankSelect banks={banks} value={accountId} onChange={setAccountId} />
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

export function CreditNoteForm({ invoiceId, today }: { invoiceId: string; today: string }) {
  const { run, error, isPending } = useActionRunner();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => issueCreditNoteAction({ invoiceId, date, amount, reason }),
          () => {
            setAmount('');
            setReason('');
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Credit, including GST
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Date
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Reason
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <ErrorNote error={error} />
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
          {isPending ? 'Issuing…' : 'Issue credit note'}
        </Button>
      </div>
    </form>
  );
}

export function VoidMoneyButton({ id, kind }: { id: string; kind: 'payment' | 'credit' }) {
  const { run, error, isPending } = useActionRunner();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Void
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
          run(() => (kind === 'payment' ? voidPaymentAction({ id }) : voidCreditNoteAction({ id })))
        }
      >
        {kind === 'payment' ? 'Void payment' : 'Void credit note'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      <ErrorNote error={error} />
    </span>
  );
}

/** One payment across several invoices: type how much goes to each; the total is the payment. */
export function MultiPaymentForm({
  invoices,
  today,
  currency,
  banks,
}: {
  invoices: OutstandingInvoice[];
  today: string;
  currency: string;
  banks: BankOption[] | null;
}) {
  const router = useRouter();
  const { run, error, isPending } = useActionRunner();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [payerName, setPayer] = useState('');
  const [reference, setReference] = useState('');
  const [accountId, setAccountId] = useState('');
  const chosen = Object.entries(amounts).filter(([, amount]) => amount.trim() !== '');
  const total = chosen.reduce((sum, [, amount]) => sum + (parseCents(amount) ?? 0n), 0n);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            recordPaymentAction({
              date,
              payerName,
              reference,
              accountId,
              allocations: chosen.map(([invoiceId, amount]) => ({ invoiceId, amount })),
            }),
          () => router.push('/invoices'),
        );
      }}
    >
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Received on
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          From
          <Input value={payerName} onChange={(e) => setPayer(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Reference
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <BankSelect banks={banks} value={accountId} onChange={setAccountId} />
      </div>
      <ul className="divide-y rounded-xl border bg-card px-4">
        {invoices.map((invoice) => (
          <li key={invoice.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="w-24 font-medium tabular-nums">{invoiceNumber(invoice.number)}</span>
            <span className="min-w-0 flex-1 basis-40 truncate" data-sensitive>
              {invoice.customerName}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              owes {formatMoney(invoice.balance, currency)}
            </span>
            <Input
              aria-label={`Amount for ${invoiceNumber(invoice.number)}`}
              inputMode="decimal"
              className="w-28"
              value={amounts[invoice.id] ?? ''}
              onChange={(e) => setAmounts({ ...amounts, [invoice.id]: e.target.value })}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAmounts({ ...amounts, [invoice.id]: invoice.balance })}
            >
              All
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-right font-semibold tabular-nums">
        Payment total {formatMoney(formatCents(total), currency)}
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
