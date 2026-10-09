import 'server-only';

import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { purchaseOrderLines, purchaseOrders, supplierItems, suppliers } from '@/db/schema';
import { instantToZoned } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { channelFor, type ChannelResult, type OrderDocument } from './channels';
import { getOrder } from './queries';
import { canDeliverOn } from './schedule';
import type {
  CreateSupplierInput,
  ImportPriceListInput,
  PlaceOrderInput,
  UpdateSupplierInput,
} from './schemas';

async function assertNameFree(tx: Tx, ctx: TenantContext, name: string, exceptId?: string) {
  const [clash] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.tenantId, ctx.tenantId),
        isNull(suppliers.deletedAt),
        sql`lower(${suppliers.name}) = lower(${name})`,
        exceptId ? ne(suppliers.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (clash) {
    throw new AppError('CONFLICT', 'You already have a supplier with that name.', {
      name: ['Choose a different name'],
    });
  }
}

async function loadSupplier(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .select()
    .from(suppliers)
    .where(
      and(eq(suppliers.tenantId, ctx.tenantId), eq(suppliers.id, id), isNull(suppliers.deletedAt)),
    )
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'That supplier was not found.');
  return row;
}

export async function createSupplier(
  ctx: TenantContext,
  input: CreateSupplierInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'purchasing.manage');
  return withRls(ctx, async (tx) => {
    await assertNameFree(tx, ctx, input.name);
    const [created] = await tx
      .insert(suppliers)
      .values({ ...input, tenantId: ctx.tenantId, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning({ id: suppliers.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the supplier.');
    await audit(tx, ctx, { action: 'create', entityType: 'supplier', entityId: created.id });
    return created;
  });
}

export async function updateSupplier(
  ctx: TenantContext,
  input: UpdateSupplierInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'purchasing.manage');
  return withRls(ctx, async (tx) => {
    await loadSupplier(tx, ctx, input.id);
    await assertNameFree(tx, ctx, input.name, input.id);
    const { id, ...fields } = input;
    await tx
      .update(suppliers)
      .set({ ...fields, updatedBy: ctx.userId })
      .where(and(eq(suppliers.tenantId, ctx.tenantId), eq(suppliers.id, id)));
    await audit(tx, ctx, { action: 'update', entityType: 'supplier', entityId: id });
    return { id };
  });
}

export async function setSupplierActive(
  ctx: TenantContext,
  input: { id: string; isActive: boolean },
): Promise<{ id: string }> {
  requirePermission(ctx, 'purchasing.manage');
  return withRls(ctx, async (tx) => {
    await loadSupplier(tx, ctx, input.id);
    await tx
      .update(suppliers)
      .set({ isActive: input.isActive, updatedBy: ctx.userId })
      .where(and(eq(suppliers.tenantId, ctx.tenantId), eq(suppliers.id, input.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'supplier',
      entityId: input.id,
      changes: { isActive: [!input.isActive, input.isActive] },
    });
    return { id: input.id };
  });
}

const keyOf = (item: { code: string | null; name: string }) =>
  item.code ? `code:${item.code.toLowerCase()}` : `name:${item.name.toLowerCase()}`;

/**
 * Loads a supplier's price list from an uploaded sheet. An item already on the list (matched by
 * the supplier's code, or by name when there is no code) has its details and price updated;
 * anything new is added. With `replace`, items missing from the file come off the list. Past
 * orders are unaffected: they keep the names and prices they were placed with.
 */
export async function importPriceList(
  ctx: TenantContext,
  input: ImportPriceListInput,
): Promise<{ added: number; updated: number; removed: number }> {
  requirePermission(ctx, 'purchasing.manage');
  return withRls(ctx, async (tx) => {
    await loadSupplier(tx, ctx, input.supplierId);
    const existing = await tx
      .select()
      .from(supplierItems)
      .where(
        and(
          eq(supplierItems.tenantId, ctx.tenantId),
          eq(supplierItems.supplierId, input.supplierId),
        ),
      );
    const byKey = new Map(existing.map((row) => [keyOf(row), row]));

    // A code or name repeated in the file: the last row wins, as it would in the sheet.
    const incoming = new Map(input.items.map((item) => [keyOf(item), item]));
    const seen = new Set<string>();
    let added = 0;
    let updated = 0;
    const fresh = [];
    for (const [key, item] of incoming) {
      const current = byKey.get(key);
      if (!current) {
        fresh.push({ ...item, tenantId: ctx.tenantId, supplierId: input.supplierId });
        added += 1;
        continue;
      }
      seen.add(current.id);
      await tx
        .update(supplierItems)
        .set({ ...item, isActive: true })
        .where(and(eq(supplierItems.tenantId, ctx.tenantId), eq(supplierItems.id, current.id)));
      updated += 1;
    }
    if (fresh.length > 0) await tx.insert(supplierItems).values(fresh);

    const stale = input.replace
      ? existing.filter((row) => row.isActive && !seen.has(row.id)).map((row) => row.id)
      : [];
    if (stale.length > 0) {
      await tx
        .update(supplierItems)
        .set({ isActive: false })
        .where(and(eq(supplierItems.tenantId, ctx.tenantId), inArray(supplierItems.id, stale)));
    }

    await audit(tx, ctx, {
      action: 'import',
      entityType: 'supplier',
      entityId: input.supplierId,
      context: { added, updated, removed: stale.length },
    });
    return { added, updated, removed: stale.length };
  });
}

type SendOutcome = { sent: boolean; reason: string | null };

/** Hands a saved order to its channel and records what happened. */
async function dispatch(ctx: TenantContext, orderId: string): Promise<SendOutcome> {
  const order = await getOrder(ctx, orderId);
  if (!order) throw new AppError('NOT_FOUND', 'That order was not found.');
  const supplier = await withRls(ctx, (tx) => loadSupplier(tx, ctx, order.supplierId));

  const document: OrderDocument = {
    number: order.number,
    buyerName: ctx.tenant.name,
    buyerEmail: ctx.email,
    supplierName: supplier.name,
    accountNumber: supplier.accountNumber,
    orderEmail: supplier.orderEmail,
    deliveryDate: order.deliveryDate,
    notes: order.notes,
    currency: order.currency,
    total: order.total,
    lines: order.lines,
  };
  let result: ChannelResult;
  try {
    result = await channelFor(order.channel).send(document);
  } catch {
    result = { sent: false, reason: 'The order could not be sent. Try sending it again.' };
  }

  await withRls(ctx, async (tx) => {
    await tx
      .update(purchaseOrders)
      .set(
        result.sent
          ? {
              status: 'sent',
              sentAt: new Date(),
              sentTo: result.sentTo,
              externalReference: result.externalReference ?? null,
              updatedBy: ctx.userId,
            }
          : { status: 'not_sent', updatedBy: ctx.userId },
      )
      .where(and(eq(purchaseOrders.tenantId, ctx.tenantId), eq(purchaseOrders.id, orderId)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'purchase_order',
      entityId: orderId,
      context: { sent: result.sent, channel: order.channel },
    });
  });
  return { sent: result.sent, reason: result.sent ? null : result.reason };
}

/**
 * Saves an order and sends it. The order is committed first, so one that could not be sent is
 * never lost: it stays as "not sent" with the reason, ready to send again.
 */
export async function placeOrder(
  ctx: TenantContext,
  input: PlaceOrderInput,
): Promise<{ id: string; number: number } & SendOutcome> {
  requirePermission(ctx, 'purchasing.manage');

  const order = await withRls(ctx, async (tx) => {
    const supplier = await loadSupplier(tx, ctx, input.supplierId);
    if (!supplier.isActive) throw new AppError('CONFLICT', 'This supplier is archived.');
    const missing = channelFor(supplier.orderChannel).missing(supplier);
    if (missing) throw new AppError('VALIDATION', missing, { supplierId: [missing] });

    const now = instantToZoned(ctx.tenant.timezone, new Date());
    if (!canDeliverOn(supplier, input.deliveryDate, now)) {
      throw new AppError('VALIDATION', 'This supplier cannot deliver on that date.', {
        deliveryDate: ['Choose one of the delivery dates offered'],
      });
    }

    const ids = [...new Set(input.lines.map((line) => line.supplierItemId))];
    if (ids.length !== input.lines.length) {
      throw new AppError('VALIDATION', 'An item appears twice in this order.');
    }
    const items = await tx
      .select()
      .from(supplierItems)
      .where(
        and(
          eq(supplierItems.tenantId, ctx.tenantId),
          eq(supplierItems.supplierId, supplier.id),
          eq(supplierItems.isActive, true),
          inArray(supplierItems.id, ids),
        ),
      );
    if (items.length !== ids.length) {
      throw new AppError(
        'VALIDATION',
        'Some items are no longer on this supplier’s list. Reload and try again.',
      );
    }
    const byId = new Map(items.map((item) => [item.id, item]));

    // One order number at a time per workspace, so two people ordering at once never collide.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`purchase_order:${ctx.tenantId}`}))`,
    );
    const [next] = await tx
      .select({ number: sql<number>`coalesce(max(${purchaseOrders.number}), 0) + 1` })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.tenantId, ctx.tenantId));

    const [created] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: ctx.tenantId,
        supplierId: supplier.id,
        number: next?.number ?? 1,
        deliveryDate: input.deliveryDate,
        notes: input.notes,
        currency: ctx.tenant.currency,
        channel: supplier.orderChannel,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: purchaseOrders.id, number: purchaseOrders.number });
    if (!created) throw new AppError('INTERNAL', 'Could not save the order.');

    await tx.insert(purchaseOrderLines).values(
      input.lines.map((line, position) => {
        const item = byId.get(line.supplierItemId);
        if (!item) throw new AppError('INTERNAL', 'Could not save the order.');
        return {
          tenantId: ctx.tenantId,
          orderId: created.id,
          supplierItemId: item.id,
          name: item.name,
          code: item.code,
          unit: item.unit,
          unitPrice: item.unitPrice,
          quantity: line.quantity,
          // Multiplied by the database on exact decimals, then rounded to cents.
          lineTotal: sql`round(${item.unitPrice}::numeric * ${line.quantity}::numeric, 2)`,
          position,
        };
      }),
    );
    await tx
      .update(purchaseOrders)
      .set({
        total: sql`(select coalesce(sum(line_total), 0) from purchase_order_lines
                    where tenant_id = ${ctx.tenantId} and order_id = ${created.id})`,
      })
      .where(and(eq(purchaseOrders.tenantId, ctx.tenantId), eq(purchaseOrders.id, created.id)));

    await audit(tx, ctx, {
      action: 'create',
      entityType: 'purchase_order',
      entityId: created.id,
      context: { supplierId: supplier.id, lines: input.lines.length },
    });
    return created;
  });

  return { ...order, ...(await dispatch(ctx, order.id)) };
}

export async function resendOrder(ctx: TenantContext, id: string): Promise<SendOutcome> {
  requirePermission(ctx, 'purchasing.manage');
  const order = await getOrder(ctx, id);
  if (!order) throw new AppError('NOT_FOUND', 'That order was not found.');
  if (order.status === 'cancelled') throw new AppError('CONFLICT', 'This order was cancelled.');
  return dispatch(ctx, id);
}

/** Marks an order cancelled here. It does not tell the supplier; that is still the admin's call. */
export async function cancelOrder(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'purchasing.manage');
  return withRls(ctx, async (tx) => {
    const [updated] = await tx
      .update(purchaseOrders)
      .set({ status: 'cancelled', updatedBy: ctx.userId })
      .where(
        and(
          eq(purchaseOrders.tenantId, ctx.tenantId),
          eq(purchaseOrders.id, id),
          ne(purchaseOrders.status, 'cancelled'),
        ),
      )
      .returning({ id: purchaseOrders.id });
    if (!updated)
      throw new AppError('NOT_FOUND', 'That order was not found, or is already cancelled.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'purchase_order',
      entityId: id,
      changes: { status: [null, 'cancelled'] },
    });
    return updated;
  });
}
