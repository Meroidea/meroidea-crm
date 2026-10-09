import { ClipboardList, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SupplierFormButton } from '@/modules/purchasing/components/supplier-tools';
import { listSuppliers } from '@/modules/purchasing/queries';
import { describeDeliveryDays } from '@/modules/purchasing/schedule';
import { requirePermission, requireTenantContext } from '@/server/context';
import { isEmailConfigured } from '@/server/email';

export const metadata: Metadata = { title: 'Suppliers' };

export default async function SuppliersPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'purchasing.manage');
  const suppliers = await listSuppliers(ctx);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Suppliers"
        description="Who you buy from, their price lists, and when they deliver."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/orders">
                <ClipboardList aria-hidden /> Orders
              </Link>
            </Button>
            <SupplierFormButton />
          </>
        }
      />
      {!isEmailConfigured() && (
        <p className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text">
          Email sending is not set up, so orders are saved but not emailed to suppliers yet.
        </p>
      )}

      {suppliers.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Truck}
              title="No suppliers yet"
              description="Add a supplier, upload their price list, and you can order from them in a few clicks."
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {suppliers.map((supplier) => {
            const ready =
              supplier.isActive && supplier.itemCount > 0 && Boolean(supplier.orderEmail);
            return (
              <li key={supplier.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/suppliers/${supplier.id}`} className="group min-w-0">
                    <span className="block truncate font-medium underline-offset-4 group-hover:underline">
                      {supplier.name}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {supplier.orderEmail ?? 'No order email yet'}
                    </span>
                  </Link>
                  {!supplier.isActive ? (
                    <Badge variant="outline">Archived</Badge>
                  ) : ready ? (
                    <Badge variant="secondary">Ready to order</Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-warning-border bg-warning text-warning-text"
                    >
                      Setup needed
                    </Badge>
                  )}
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Items</dt>
                    <dd className="font-medium tabular-nums">{supplier.itemCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Delivers</dt>
                    <dd className="font-medium">{describeDeliveryDays(supplier.deliveryDays)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Order ahead</dt>
                    <dd className="font-medium">
                      {supplier.leadDays === 0
                        ? 'Same day'
                        : `${supplier.leadDays} day${supplier.leadDays === 1 ? '' : 's'}`}
                    </dd>
                  </div>
                </dl>
                {ready && (
                  <Button asChild size="sm" className="self-start">
                    <Link href={`/orders/new?supplier=${supplier.id}`}>Place an order</Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
