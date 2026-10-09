import { ClipboardList, ShoppingCart } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatCalendarDate, formatDate, formatMoney } from '@/lib/format';
import { OrderStatusBadge } from '@/modules/purchasing/components/order-status';
import { listOrders } from '@/modules/purchasing/queries';
import { orderNumber } from '@/modules/purchasing/types';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Orders' };

export default async function OrdersPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'purchasing.manage');
  const orders = await listOrders(ctx);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Orders"
        description="Everything you have ordered from suppliers, newest first."
        actions={
          <Button asChild>
            <Link href="/orders/new">
              <ShoppingCart aria-hidden /> Place an order
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent>
          {orders.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No orders yet"
              description="Choose a supplier and a delivery date, enter quantities, and the order is emailed for you."
            />
          ) : (
            <ul className="divide-y">
              {orders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/orders/${order.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="w-20 font-medium tabular-nums">
                      {orderNumber(order.number)}
                    </span>
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate font-medium">{order.supplierName}</span>
                      <span className="block text-sm text-muted-foreground">
                        Placed {formatDate(ctx, order.createdAt)} · delivery{' '}
                        {formatCalendarDate(order.deliveryDate)}
                      </span>
                    </span>
                    <span className="tabular-nums">{formatMoney(order.total, order.currency)}</span>
                    <OrderStatusBadge status={order.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
