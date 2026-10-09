import { ShoppingCart } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { OrderStatusBadge } from '@/modules/purchasing/components/order-status';
import {
  ArchiveSupplierButton,
  PriceListImport,
  SupplierFormButton,
} from '@/modules/purchasing/components/supplier-tools';
import { getSupplier, listOrders, listSupplierItems } from '@/modules/purchasing/queries';
import { describeDeliveryDays } from '@/modules/purchasing/schedule';
import { supplierIdSchema } from '@/modules/purchasing/schemas';
import { orderNumber } from '@/modules/purchasing/types';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Supplier' };

export default async function SupplierPage({ params }: PageProps<'/suppliers/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'purchasing.manage');
  const parsed = supplierIdSchema.safeParse(await params);
  const supplier = parsed.success ? await getSupplier(ctx, parsed.data.id) : null;
  if (!supplier) notFound();
  const [items, orders] = await Promise.all([
    listSupplierItems(ctx, supplier.id),
    listOrders(ctx, { supplierId: supplier.id, limit: 10 }),
  ]);

  const steps = [
    { done: Boolean(supplier.orderEmail), label: 'Order email added' },
    { done: items.length > 0, label: 'Price list uploaded' },
  ];
  const ready = supplier.isActive && steps.every((step) => step.done);
  const facts: [string, string][] = [
    ['Order email', supplier.orderEmail ?? '—'],
    ['Contact', supplier.contactName ?? '—'],
    ['Phone', supplier.phone ?? '—'],
    ['Your account number', supplier.accountNumber ?? '—'],
    ['Delivers', describeDeliveryDays(supplier.deliveryDays)],
    [
      'Order ahead',
      `${supplier.leadDays === 0 ? 'Same day' : `${supplier.leadDays} day${supplier.leadDays === 1 ? '' : 's'}`}${supplier.cutoffTime ? `, by ${supplier.cutoffTime}` : ''}`,
    ],
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div>
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/suppliers" className="underline-offset-4 hover:underline">
            Suppliers
          </Link>{' '}
          / {supplier.name}
        </nav>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{supplier.name}</h1>
            {!supplier.isActive && <Badge variant="outline">Archived</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <ArchiveSupplierButton id={supplier.id} isActive={supplier.isActive} />
            <SupplierFormButton supplier={supplier} />
            {ready && (
              <Button asChild>
                <Link href={`/orders/new?supplier=${supplier.id}`}>
                  <ShoppingCart aria-hidden /> Place an order
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {supplier.isActive && !ready && (
        <div className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text">
          <p className="font-medium">Finish setting up before you can order</p>
          <ul className="mt-1.5 space-y-0.5">
            {steps.map((step) => (
              <li key={step.label}>
                {step.done ? '✓' : '○'} {step.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="rounded-xl border bg-card p-5">
        <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {supplier.notes && <p className="mt-4 text-sm text-muted-foreground">{supplier.notes}</p>}
      </section>

      <section aria-label="Price list" className="overflow-hidden rounded-xl border bg-card">
        <header className="flex items-center gap-2.5 border-b bg-muted/40 px-4 py-2.5">
          <h2 className="text-sm font-medium">Price list</h2>
          <span className="text-sm text-muted-foreground tabular-nums">{items.length}</span>
        </header>
        <div className="p-4">
          <PriceListImport
            supplierId={supplier.id}
            currency={ctx.tenant.currency}
            hasItems={items.length > 0}
          />
        </div>
        {items.length > 0 && (
          <div className="max-h-[28rem] overflow-auto border-t">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Code
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Item
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Unit
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Price
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                      {item.code ?? ''}
                    </td>
                    <td className="px-4 py-2">{item.name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{item.unit ?? ''}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatMoney(item.unitPrice, ctx.tenant.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {orders.length > 0 && (
        <section aria-label="Recent orders" className="overflow-hidden rounded-xl border bg-card">
          <header className="border-b bg-muted/40 px-4 py-2.5">
            <h2 className="text-sm font-medium">Recent orders</h2>
          </header>
          <ul className="divide-y">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/orders/${order.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50"
                >
                  <span className="font-medium tabular-nums">{orderNumber(order.number)}</span>
                  <span className="flex-1 text-muted-foreground">
                    for delivery {formatCalendarDate(order.deliveryDate)}
                  </span>
                  <span className="tabular-nums">{formatMoney(order.total, order.currency)}</span>
                  <OrderStatusBadge status={order.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
