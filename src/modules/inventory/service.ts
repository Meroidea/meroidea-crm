import 'server-only';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import { inventoryCategories, inventoryItems, inventoryMovements } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { formatQuantity } from './format';
import type {
  CreateItemInput,
  MovementKind,
  RecordMovementInput,
  UpdateItemInput,
} from './schemas';

/** The category with this name, created the first time the name is used. */
async function categoryIdFor(tx: Tx, ctx: TenantContext, name: string | null) {
  if (!name) return null;
  const [existing] = await tx
    .select({ id: inventoryCategories.id })
    .from(inventoryCategories)
    .where(
      and(
        eq(inventoryCategories.tenantId, ctx.tenantId),
        sql`lower(${inventoryCategories.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(inventoryCategories)
    .values({ tenantId: ctx.tenantId, name, createdBy: ctx.userId })
    .returning({ id: inventoryCategories.id });
  return created?.id ?? null;
}

async function assertSkuFree(tx: Tx, ctx: TenantContext, sku: string | null, exceptId?: string) {
  if (!sku) return;
  const [clash] = await tx
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.tenantId, ctx.tenantId),
        isNull(inventoryItems.deletedAt),
        sql`lower(${inventoryItems.sku}) = lower(${sku})`,
        exceptId ? ne(inventoryItems.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (clash) {
    throw new AppError('CONFLICT', 'Another item already uses that code.', {
      sku: ['Choose a code no other item uses'],
    });
  }
}

const MOVEMENT_TYPES: Record<
  MovementKind,
  'received' | 'used' | 'wasted' | 'adjusted' | 'stocktake'
> = {
  received: 'received',
  used: 'used',
  wasted: 'wasted',
  add: 'adjusted',
  remove: 'adjusted',
  stocktake: 'stocktake',
};

/**
 * Changes an item's quantity and writes the ledger row for it, together. All arithmetic happens
 * in the database on exact decimals. Removing more than is on hand is refused rather than
 * leaving a negative balance: the right fix for a wrong count is a stocktake.
 */
async function move(
  tx: Tx,
  ctx: TenantContext,
  input: Omit<RecordMovementInput, 'unitCost' | 'note'> & {
    unitCost?: string | null;
    note?: string | null;
  },
): Promise<{ id: string; quantityAfter: string }> {
  const [item] = await tx
    .select({ quantityOnHand: inventoryItems.quantityOnHand, unit: inventoryItems.unit })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.tenantId, ctx.tenantId),
        eq(inventoryItems.id, input.itemId),
        isNull(inventoryItems.deletedAt),
      ),
    )
    .limit(1)
    .for('update');
  if (!item) throw new AppError('NOT_FOUND', 'That item was not found.');

  const amount = sql`${input.quantity}::numeric`;
  const before = sql`${item.quantityOnHand}::numeric`;
  const delta =
    input.kind === 'stocktake'
      ? sql`${amount} - ${before}`
      : input.kind === 'received' || input.kind === 'add'
        ? amount
        : sql`-${amount}`;
  const receivedCost = input.kind === 'received' ? (input.unitCost ?? null) : null;

  const [updated] = await tx
    .update(inventoryItems)
    .set({
      quantityOnHand: sql`${inventoryItems.quantityOnHand} + (${delta})`,
      // The latest purchase price becomes the item's cost; earlier prices stay in the ledger.
      ...(receivedCost ? { unitCost: receivedCost } : {}),
      updatedBy: ctx.userId,
    })
    .where(
      and(
        eq(inventoryItems.tenantId, ctx.tenantId),
        eq(inventoryItems.id, input.itemId),
        sql`${inventoryItems.quantityOnHand} + (${delta}) >= 0`,
      ),
    )
    .returning({ quantityAfter: inventoryItems.quantityOnHand });
  if (!updated) {
    throw new AppError('CONFLICT', 'There is not that much in stock.', {
      quantity: [
        `Only ${formatQuantity(item.quantityOnHand)} ${item.unit} on hand. Do a stocktake if the count is wrong.`,
      ],
    });
  }

  const [movement] = await tx
    .insert(inventoryMovements)
    .values({
      tenantId: ctx.tenantId,
      itemId: input.itemId,
      type: MOVEMENT_TYPES[input.kind],
      quantityDelta: sql`${delta}`,
      quantityAfter: updated.quantityAfter,
      unitCost: receivedCost,
      note: input.note ?? null,
      createdBy: ctx.userId,
    })
    .returning({ id: inventoryMovements.id });
  if (!movement) throw new AppError('INTERNAL', 'Could not record the stock change.');
  return { id: movement.id, quantityAfter: updated.quantityAfter };
}

export async function createItem(
  ctx: TenantContext,
  input: CreateItemInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'inventory.manage');
  return withRls(ctx, async (tx) => {
    await assertSkuFree(tx, ctx, input.sku);
    const [created] = await tx
      .insert(inventoryItems)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        sku: input.sku,
        categoryId: await categoryIdFor(tx, ctx, input.category),
        unit: input.unit,
        reorderLevel: input.reorderLevel,
        unitCost: input.unitCost,
        currency: ctx.tenant.currency,
        supplierName: input.supplierName,
        notes: input.notes,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: inventoryItems.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the item.');

    if (input.openingQuantity && !/^0+(\.0+)?$/.test(input.openingQuantity)) {
      await move(tx, ctx, {
        itemId: created.id,
        kind: 'stocktake',
        quantity: input.openingQuantity,
        note: 'Opening count',
      });
    }
    await audit(tx, ctx, { action: 'create', entityType: 'inventory_item', entityId: created.id });
    return created;
  });
}

export async function updateItem(
  ctx: TenantContext,
  input: UpdateItemInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'inventory.manage');
  return withRls(ctx, async (tx) => {
    await assertSkuFree(tx, ctx, input.sku, input.id);
    const [updated] = await tx
      .update(inventoryItems)
      .set({
        name: input.name,
        sku: input.sku,
        categoryId: await categoryIdFor(tx, ctx, input.category),
        unit: input.unit,
        reorderLevel: input.reorderLevel,
        unitCost: input.unitCost,
        supplierName: input.supplierName,
        notes: input.notes,
        updatedBy: ctx.userId,
      })
      .where(
        and(
          eq(inventoryItems.tenantId, ctx.tenantId),
          eq(inventoryItems.id, input.id),
          isNull(inventoryItems.deletedAt),
        ),
      )
      .returning({ id: inventoryItems.id });
    if (!updated) throw new AppError('NOT_FOUND', 'That item was not found.');
    await audit(tx, ctx, { action: 'update', entityType: 'inventory_item', entityId: updated.id });
    return updated;
  });
}

/** Archiving hides an item from the working list without losing its history. */
export async function setItemActive(
  ctx: TenantContext,
  input: { id: string; isActive: boolean },
): Promise<{ id: string }> {
  requirePermission(ctx, 'inventory.manage');
  return withRls(ctx, async (tx) => {
    const [updated] = await tx
      .update(inventoryItems)
      .set({ isActive: input.isActive, updatedBy: ctx.userId })
      .where(
        and(
          eq(inventoryItems.tenantId, ctx.tenantId),
          eq(inventoryItems.id, input.id),
          isNull(inventoryItems.deletedAt),
        ),
      )
      .returning({ id: inventoryItems.id });
    if (!updated) throw new AppError('NOT_FOUND', 'That item was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'inventory_item',
      entityId: updated.id,
      changes: { isActive: [!input.isActive, input.isActive] },
    });
    return updated;
  });
}

export async function recordMovement(
  ctx: TenantContext,
  input: RecordMovementInput,
): Promise<{ id: string; quantityAfter: string }> {
  requirePermission(ctx, 'inventory.manage');
  return withRls(ctx, async (tx) => {
    const result = await move(tx, ctx, input);
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'inventory_item',
      entityId: input.itemId,
      context: { movementId: result.id, kind: input.kind },
    });
    return result;
  });
}
