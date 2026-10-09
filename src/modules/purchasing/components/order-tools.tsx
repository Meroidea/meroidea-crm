'use client';

import { Ban, RotateCw, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import {
  cancelOrderAction,
  placeOrderAction,
  resendOrderAction,
} from '@/modules/purchasing/actions';
import type { OrderStatus, SupplierItemRow } from '@/modules/purchasing/types';

const QUANTITY = /^\d{1,7}(\.\d{1,3})?$/;

/**
 * A line's cost in cents, on whole numbers: price in cents × quantity in thousandths, rounded
 * half up back to cents. The saved order is priced by the database; this only previews it.
 */
function lineCents(unitPrice: string, quantity: string): bigint {
  const scaled = (value: string, places: number) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(places, '0').slice(0, places));
  };
  return (scaled(unitPrice, 2) * scaled(quantity, 3) + 500n) / 1000n;
}

const centsToMoney = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

export function OrderBuilder({
  suppliers,
  supplierId,
  items,
  dates,
  currency,
  blocked,
}: {
  suppliers: { id: string; name: string }[];
  supplierId: string | null;
  items: SupplierItemRow[];
  /** Dates this supplier can still deliver on, soonest first. */
  dates: { date: string; orderBy: string }[];
  currency: string;
  /** Why this supplier cannot be ordered from yet, if anything is missing. */
  blocked: string | null;
}) {
  const router = useRouter();
  const [deliveryDate, setDeliveryDate] = useState(dates[0]?.date ?? '');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const lines = useMemo(
    () =>
      items.flatMap((item) => {
        const quantity = (quantities[item.id] ?? '').trim();
        return QUANTITY.test(quantity) && Number(quantity) > 0 ? [{ item, quantity }] : [];
      }),
    [items, quantities],
  );
  const invalid = items.filter((item) => {
    const quantity = (quantities[item.id] ?? '').trim();
    return quantity !== '' && !QUANTITY.test(quantity);
  });
  const total = lines.reduce(
    (sum, line) => sum + lineCents(line.item.unitPrice, line.quantity),
    0n,
  );
  const shown = search
    ? items.filter((item) =>
        `${item.name} ${item.code ?? ''}`.toLowerCase().includes(search.toLowerCase()),
      )
    : items;
  const chosen = dates.find((option) => option.date === deliveryDate);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      if (!supplierId) return;
      const result = await placeOrderAction({
        supplierId,
        deliveryDate,
        notes,
        lines: lines.map((line) => ({ supplierItemId: line.item.id, quantity: line.quantity })),
      });
      if (!result.ok) return setError(result.error.message);
      router.push(`/orders/${result.data.id}`);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="order-supplier">Supplier</Label>
          <NativeSelect
            id="order-supplier"
            value={supplierId ?? ''}
            onChange={(event) =>
              router.push(
                event.target.value ? `/orders/new?supplier=${event.target.value}` : '/orders/new',
              )
            }
          >
            <option value="">Choose a supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {supplierId && !blocked && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-delivery">Delivery date</Label>
            <NativeSelect
              id="order-delivery"
              value={deliveryDate}
              onChange={(event) => setDeliveryDate(event.target.value)}
            >
              {dates.map((option) => (
                <option key={option.date} value={option.date}>
                  {new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' }).format(
                    new Date(`${option.date}T00:00:00Z`),
                  )}{' '}
                  {formatCalendarDate(option.date)}
                </option>
              ))}
            </NativeSelect>
            {chosen && (
              <p className="text-xs text-muted-foreground">
                Order by {formatCalendarDate(chosen.orderBy)} for this delivery.
              </p>
            )}
          </div>
        )}
      </div>

      {supplierId && blocked && (
        <p className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text">
          {blocked}
        </p>
      )}

      {supplierId && !blocked && (
        <>
          <section className="overflow-hidden rounded-xl border bg-card">
            <header className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-2.5">
              <h2 className="text-sm font-medium">Items</h2>
              <span className="text-sm text-muted-foreground tabular-nums">{items.length}</span>
              <Input
                type="search"
                aria-label="Find an item"
                placeholder="Find an item"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="ml-auto h-8 w-48"
              />
            </header>
            <ul className="divide-y">
              {shown.map((item) => {
                const quantity = (quantities[item.id] ?? '').trim();
                const bad = quantity !== '' && !QUANTITY.test(quantity);
                const priced = !bad && Number(quantity) > 0;
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[item.code, item.unit].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    <span className="w-20 text-right text-sm text-muted-foreground tabular-nums">
                      {formatMoney(item.unitPrice, currency)}
                    </span>
                    <Input
                      inputMode="decimal"
                      aria-label={`Quantity of ${item.name}`}
                      aria-invalid={bad}
                      placeholder="0"
                      value={quantities[item.id] ?? ''}
                      onChange={(event) =>
                        setQuantities((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                      className="h-8 w-20 text-right tabular-nums"
                    />
                    <span className="w-24 text-right text-sm font-medium tabular-nums">
                      {priced
                        ? formatMoney(centsToMoney(lineCents(item.unitPrice, quantity)), currency)
                        : ''}
                    </span>
                  </li>
                );
              })}
              {shown.length === 0 && (
                <li className="px-4 py-6 text-sm text-muted-foreground">No items match.</li>
              )}
            </ul>
          </section>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-notes">Note to the supplier (optional)</Label>
            <Textarea
              id="order-notes"
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <div className="sticky bottom-3 flex flex-wrap items-center gap-4 rounded-xl border bg-card px-5 py-3 shadow-lg">
            <p className="text-sm">
              <span className="font-medium">{lines.length}</span>{' '}
              {lines.length === 1 ? 'item' : 'items'} · estimated{' '}
              <span className="text-lg font-semibold tabular-nums">
                {formatMoney(centsToMoney(total), currency)}
              </span>
            </p>
            {(error || invalid.length > 0) && (
              <p role="alert" className="text-sm text-destructive-text">
                {error ?? 'Check the highlighted quantities: use numbers like 3 or 1.5.'}
              </p>
            )}
            <Button
              size="lg"
              className="ml-auto"
              disabled={isPending || lines.length === 0 || invalid.length > 0 || !deliveryDate}
              onClick={submit}
            >
              <Send aria-hidden /> Send order
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function OrderActions({ id, status }: { id: string; status: OrderStatus }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  if (status === 'cancelled') return null;

  const resend = () =>
    startTransition(async () => {
      setNote(null);
      const result = await resendOrderAction({ id });
      if (!result.ok) return setNote(result.error.message);
      setNote(result.data.sent ? 'Sent.' : result.data.reason);
      router.refresh();
    });
  const cancel = () => {
    if (
      !window.confirm(
        'Cancel this order here? This does not tell the supplier — contact them yourself.',
      )
    )
      return;
    startTransition(async () => {
      const result = await cancelOrderAction({ id });
      if (!result.ok) return setNote(result.error.message);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={status === 'sent' ? 'outline' : 'default'}
          disabled={isPending}
          onClick={resend}
        >
          <RotateCw aria-hidden /> {status === 'sent' ? 'Send again' : 'Send now'}
        </Button>
        <Button
          variant="outline"
          className="text-destructive-text"
          disabled={isPending}
          onClick={cancel}
        >
          <Ban aria-hidden /> Cancel order
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
