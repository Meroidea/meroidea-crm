import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { PageHeader } from '@/components/data/page-header';
import { instantToZoned } from '@/lib/dates';
import { channelFor } from '@/modules/purchasing/channels';
import { OrderBuilder } from '@/modules/purchasing/components/order-tools';
import { getSupplier, listSupplierItems, listSuppliers } from '@/modules/purchasing/queries';
import { nextDeliveryDates } from '@/modules/purchasing/schedule';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Place an order' };

const paramsSchema = z.object({ supplier: z.uuid().optional().catch(undefined) });

export default async function NewOrderPage({ searchParams }: PageProps<'/orders/new'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'purchasing.manage');
  const { supplier: supplierId } = paramsSchema.parse(await searchParams);
  const [suppliers, supplier] = await Promise.all([
    listSuppliers(ctx),
    supplierId ? getSupplier(ctx, supplierId) : null,
  ]);
  const active = suppliers.filter((row) => row.isActive);
  const items = supplier ? await listSupplierItems(ctx, supplier.id) : [];
  const dates = supplier
    ? nextDeliveryDates(supplier, instantToZoned(ctx.tenant.timezone, new Date()))
    : [];

  const blocked = !supplier
    ? null
    : !supplier.isActive
      ? 'This supplier is archived. Restore it to order from it.'
      : (channelFor(supplier.orderChannel).missing(supplier) ??
        (items.length === 0
          ? 'This supplier has no price list yet. Upload one on the supplier’s page.'
          : null) ??
        (dates.length === 0
          ? 'No delivery dates are available for this supplier’s schedule.'
          : null));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title="Place an order"
        description="Pick the supplier and delivery date, enter what you need, and send."
      />
      {active.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          You have no suppliers to order from yet.{' '}
          <Link href="/suppliers" className="text-primary underline underline-offset-4">
            Add a supplier
          </Link>{' '}
          first.
        </p>
      ) : (
        <OrderBuilder
          // Fresh state for each supplier: quantities for one list mean nothing on another.
          key={supplier?.id ?? 'none'}
          suppliers={active.map((row) => ({ id: row.id, name: row.name }))}
          supplierId={supplier?.id ?? null}
          items={items}
          dates={dates}
          currency={ctx.tenant.currency}
          blocked={blocked}
        />
      )}
    </div>
  );
}
