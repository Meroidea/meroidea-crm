import 'server-only';

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { purchaseOrderLines, purchaseOrders, supplierItems, suppliers } from '@/db/schema';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { OrderDetail, OrderRow, SupplierDetail, SupplierItemRow, SupplierRow } from './types';

const supplierColumns = {
  id: suppliers.id,
  name: suppliers.name,
  contactName: suppliers.contactName,
  orderEmail: suppliers.orderEmail,
  phone: suppliers.phone,
  deliveryDays: suppliers.deliveryDays,
  leadDays: suppliers.leadDays,
  cutoffTime: suppliers.cutoffTime,
  isActive: suppliers.isActive,
  // Table-qualified by hand: in a single-table select the query builder drops the qualifier from
  // interpolated columns, which would make them resolve to the inner table instead.
  itemCount: sql<number>`(select count(*)::int from supplier_items si
    where si.tenant_id = suppliers.tenant_id and si.supplier_id = suppliers.id and si.is_active)`,
};

const liveSuppliers = (ctx: TenantContext) =>
  and(eq(suppliers.tenantId, ctx.tenantId), isNull(suppliers.deletedAt));

export async function listSuppliers(ctx: TenantContext): Promise<SupplierRow[]> {
  requirePermission(ctx, 'purchasing.manage');
  return withRls(ctx, (tx) =>
    tx
      .select(supplierColumns)
      .from(suppliers)
      .where(liveSuppliers(ctx))
      .orderBy(desc(suppliers.isActive), asc(suppliers.name)),
  );
}

export async function getSupplier(ctx: TenantContext, id: string): Promise<SupplierDetail | null> {
  requirePermission(ctx, 'purchasing.manage');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        ...supplierColumns,
        accountNumber: suppliers.accountNumber,
        notes: suppliers.notes,
        orderChannel: suppliers.orderChannel,
      })
      .from(suppliers)
      .where(and(liveSuppliers(ctx), eq(suppliers.id, id)))
      .limit(1),
  );
  return row ?? null;
}

/** A supplier's current price list, in name order. */
export async function listSupplierItems(
  ctx: TenantContext,
  supplierId: string,
): Promise<SupplierItemRow[]> {
  requirePermission(ctx, 'purchasing.manage');
  return withRls(ctx, (tx) =>
    tx
      .select({
        id: supplierItems.id,
        name: supplierItems.name,
        code: supplierItems.code,
        unit: supplierItems.unit,
        unitPrice: supplierItems.unitPrice,
      })
      .from(supplierItems)
      .where(
        and(
          eq(supplierItems.tenantId, ctx.tenantId),
          eq(supplierItems.supplierId, supplierId),
          eq(supplierItems.isActive, true),
        ),
      )
      .orderBy(asc(supplierItems.name)),
  );
}

const orderColumns = {
  id: purchaseOrders.id,
  number: purchaseOrders.number,
  supplierId: purchaseOrders.supplierId,
  supplierName: suppliers.name,
  deliveryDate: purchaseOrders.deliveryDate,
  status: purchaseOrders.status,
  total: purchaseOrders.total,
  currency: purchaseOrders.currency,
  createdAt: purchaseOrders.createdAt,
};

const supplierJoin = and(
  eq(suppliers.tenantId, purchaseOrders.tenantId),
  eq(suppliers.id, purchaseOrders.supplierId),
);

export async function listOrders(
  ctx: TenantContext,
  options: { supplierId?: string; limit?: number } = {},
): Promise<OrderRow[]> {
  requirePermission(ctx, 'purchasing.manage');
  return withRls(ctx, (tx) =>
    tx
      .select(orderColumns)
      .from(purchaseOrders)
      .innerJoin(suppliers, supplierJoin)
      .where(
        and(
          eq(purchaseOrders.tenantId, ctx.tenantId),
          options.supplierId ? eq(purchaseOrders.supplierId, options.supplierId) : undefined,
        ),
      )
      .orderBy(desc(purchaseOrders.number))
      .limit(options.limit ?? 100),
  );
}

export async function getOrder(ctx: TenantContext, id: string): Promise<OrderDetail | null> {
  requirePermission(ctx, 'purchasing.manage');
  return withRls(ctx, async (tx) => {
    const [order] = await tx
      .select({
        ...orderColumns,
        notes: purchaseOrders.notes,
        channel: purchaseOrders.channel,
        sentTo: purchaseOrders.sentTo,
        sentAt: purchaseOrders.sentAt,
        externalReference: purchaseOrders.externalReference,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, supplierJoin)
      .where(and(eq(purchaseOrders.tenantId, ctx.tenantId), eq(purchaseOrders.id, id)))
      .limit(1);
    if (!order) return null;
    const lines = await tx
      .select({
        id: purchaseOrderLines.id,
        name: purchaseOrderLines.name,
        code: purchaseOrderLines.code,
        unit: purchaseOrderLines.unit,
        unitPrice: purchaseOrderLines.unitPrice,
        quantity: purchaseOrderLines.quantity,
        lineTotal: purchaseOrderLines.lineTotal,
      })
      .from(purchaseOrderLines)
      .where(and(eq(purchaseOrderLines.tenantId, ctx.tenantId), eq(purchaseOrderLines.orderId, id)))
      .orderBy(asc(purchaseOrderLines.position));
    return { ...order, lines };
  });
}
