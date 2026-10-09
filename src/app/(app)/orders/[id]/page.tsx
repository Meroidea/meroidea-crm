import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatCalendarDate, formatDateTime, formatMoney } from '@/lib/format';
import { OrderStatusBadge } from '@/modules/purchasing/components/order-status';
import { OrderActions } from '@/modules/purchasing/components/order-tools';
import { getOrder } from '@/modules/purchasing/queries';
import { orderIdSchema } from '@/modules/purchasing/schemas';
import { orderNumber } from '@/modules/purchasing/types';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Order' };

const trim = (value: string) =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;

export default async function OrderPage({ params }: PageProps<'/orders/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'purchasing.manage');
  const parsed = orderIdSchema.safeParse(await params);
  const order = parsed.success ? await getOrder(ctx, parsed.data.id) : null;
  if (!order) notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div>
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/orders" className="underline-offset-4 hover:underline">
            Orders
          </Link>{' '}
          / {orderNumber(order.number)}
        </nav>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{orderNumber(order.number)}</h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="mt-1 text-muted-foreground">
          <Link href={`/suppliers/${order.supplierId}`} className="underline underline-offset-4">
            {order.supplierName}
          </Link>{' '}
          · delivery {formatCalendarDate(order.deliveryDate)}
        </p>
      </div>

      <div
        className={
          order.status === 'not_sent'
            ? 'rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text'
            : 'rounded-lg border bg-card px-4 py-3 text-sm'
        }
      >
        {order.status === 'sent' && (
          <p>
            Emailed to <span className="font-medium">{order.sentTo}</span> on{' '}
            {formatDateTime(ctx, order.sentAt)}.
            {order.externalReference && ` Supplier reference: ${order.externalReference}.`}
          </p>
        )}
        {order.status === 'not_sent' && (
          <p>
            <span className="font-medium">This order has not reached the supplier.</span> It is
            saved here; send it once email is working, or pass the details on yourself.
          </p>
        )}
        {order.status === 'cancelled' && (
          <p>Cancelled here. The supplier is not told automatically.</p>
        )}
        <div className="mt-3">
          <OrderActions id={order.id} status={order.status} />
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="px-4 py-2 font-medium">
                  Qty
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Item
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Price
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {order.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-2.5 font-medium tabular-nums">{trim(line.quantity)}</td>
                  <td className="px-4 py-2.5">
                    {line.name}
                    <span className="block text-xs text-muted-foreground">
                      {[line.code, line.unit].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatMoney(line.unitPrice, order.currency)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatMoney(line.lineTotal, order.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40">
                <td colSpan={3} className="px-4 py-2.5 text-right font-medium">
                  Estimated total
                </td>
                <td className="px-4 py-2.5 text-right text-base font-semibold tabular-nums">
                  {formatMoney(order.total, order.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {order.notes && (
          <p className="border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">Note to supplier:</span> {order.notes}
          </p>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        Prices are the supplier’s list prices on the day the order was placed. Tax, freight and any
        substitutions are on the supplier’s invoice, not here.
      </p>
    </div>
  );
}
