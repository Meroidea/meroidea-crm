import 'server-only';

import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';

import { inventoryCategories, inventoryItems, inventoryMovements, users } from '@/db/schema';
import { likePattern } from '@/lib/cursor';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { InventoryFilters } from './schemas';
import type {
  CategoryOption,
  InventoryItemDetail,
  InventoryItemRow,
  InventoryMovementRow,
  InventorySummary,
} from './types';

/** Out when nothing is left; low when at or under a reorder level that has been set. */
const level = sql<'ok' | 'low' | 'out'>`case
  when ${inventoryItems.quantityOnHand} = 0 then 'out'
  when ${inventoryItems.reorderLevel} is not null
    and ${inventoryItems.quantityOnHand} <= ${inventoryItems.reorderLevel} then 'low'
  else 'ok' end`;

const columns = {
  id: inventoryItems.id,
  name: inventoryItems.name,
  sku: inventoryItems.sku,
  categoryId: inventoryItems.categoryId,
  categoryName: inventoryCategories.name,
  unit: inventoryItems.unit,
  quantityOnHand: inventoryItems.quantityOnHand,
  reorderLevel: inventoryItems.reorderLevel,
  unitCost: inventoryItems.unitCost,
  // Multiplied in the database so the result is exact, then rounded to cents.
  stockValue: sql<
    string | null
  >`round(${inventoryItems.quantityOnHand} * ${inventoryItems.unitCost}, 2)::text`,
  currency: inventoryItems.currency,
  level,
  isActive: inventoryItems.isActive,
};

const live = (ctx: TenantContext) =>
  and(eq(inventoryItems.tenantId, ctx.tenantId), isNull(inventoryItems.deletedAt));

const categoryJoin = and(
  eq(inventoryCategories.tenantId, inventoryItems.tenantId),
  eq(inventoryCategories.id, inventoryItems.categoryId),
);

export async function listItems(
  ctx: TenantContext,
  filters: InventoryFilters,
): Promise<InventoryItemRow[]> {
  requirePermission(ctx, 'inventory.view');
  const view = filters.view ?? 'all';
  const where: (SQL | undefined)[] = [live(ctx), eq(inventoryItems.isActive, view !== 'archived')];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    where.push(or(ilike(inventoryItems.name, pattern), ilike(inventoryItems.sku, pattern)));
  }
  if (filters.category) where.push(eq(inventoryItems.categoryId, filters.category));
  if (view === 'low') where.push(sql`${level} = 'low'`);
  if (view === 'out') where.push(sql`${level} = 'out'`);

  return withRls(ctx, (tx) =>
    tx
      .select(columns)
      .from(inventoryItems)
      .leftJoin(inventoryCategories, categoryJoin)
      .where(and(...where))
      .orderBy(asc(inventoryCategories.name), asc(inventoryItems.name)),
  );
}

export async function getInventorySummary(ctx: TenantContext): Promise<InventorySummary> {
  requirePermission(ctx, 'inventory.view');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        items: sql<number>`count(*) filter (where ${inventoryItems.isActive})::int`,
        low: sql<number>`count(*) filter (where ${inventoryItems.isActive} and ${level} = 'low')::int`,
        out: sql<number>`count(*) filter (where ${inventoryItems.isActive} and ${level} = 'out')::int`,
        archived: sql<number>`count(*) filter (where not ${inventoryItems.isActive})::int`,
        stockValue: sql<string>`coalesce(round(sum(${inventoryItems.quantityOnHand} * ${inventoryItems.unitCost})
          filter (where ${inventoryItems.isActive}), 2), 0)::text`,
      })
      .from(inventoryItems)
      .where(live(ctx)),
  );
  return row ?? { items: 0, low: 0, out: 0, archived: 0, stockValue: '0' };
}

export async function listCategories(ctx: TenantContext): Promise<CategoryOption[]> {
  requirePermission(ctx, 'inventory.view');
  return withRls(ctx, (tx) =>
    tx
      .select({ id: inventoryCategories.id, name: inventoryCategories.name })
      .from(inventoryCategories)
      .where(eq(inventoryCategories.tenantId, ctx.tenantId))
      .orderBy(asc(inventoryCategories.name)),
  );
}

export async function getItem(ctx: TenantContext, id: string): Promise<InventoryItemDetail | null> {
  requirePermission(ctx, 'inventory.view');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        ...columns,
        supplierName: inventoryItems.supplierName,
        notes: inventoryItems.notes,
      })
      .from(inventoryItems)
      .leftJoin(inventoryCategories, categoryJoin)
      .where(and(live(ctx), eq(inventoryItems.id, id)))
      .limit(1),
  );
  return row ?? null;
}

/** The newest movements for one item, with who recorded each. */
export async function listMovements(
  ctx: TenantContext,
  itemId: string,
  limit = 100,
): Promise<InventoryMovementRow[]> {
  requirePermission(ctx, 'inventory.view');
  return withRls(ctx, (tx) =>
    tx
      .select({
        id: inventoryMovements.id,
        type: inventoryMovements.type,
        quantityDelta: inventoryMovements.quantityDelta,
        quantityAfter: inventoryMovements.quantityAfter,
        unitCost: inventoryMovements.unitCost,
        note: inventoryMovements.note,
        occurredAt: inventoryMovements.occurredAt,
        byName: users.fullName,
      })
      .from(inventoryMovements)
      .leftJoin(users, eq(users.id, inventoryMovements.createdBy))
      .where(
        and(eq(inventoryMovements.tenantId, ctx.tenantId), eq(inventoryMovements.itemId, itemId)),
      )
      .orderBy(desc(inventoryMovements.occurredAt), desc(inventoryMovements.createdAt))
      .limit(limit),
  );
}
