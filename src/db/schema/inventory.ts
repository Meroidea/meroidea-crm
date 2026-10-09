import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

export const inventoryMovementType = pgEnum('inventory_movement_type', [
  'received',
  'used',
  'wasted',
  'adjusted',
  'stocktake',
]);

/** A tenant's own grouping for stock items. */
export const inventoryCategories = pgTable(
  'inventory_categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [unique('inventory_categories_tenant_id_id_key').on(table.tenantId, table.id)],
);

/** Something the workspace keeps in stock, with a running quantity on hand. */
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    /** The workspace's own code for the item; optional, unique among live items when set. */
    sku: text(),
    categoryId: uuid(),
    /** What one unit is, in the tenant's words: each, kg, box, litre. */
    unit: text().notNull().default('each'),
    /** Only ever changed together with a row in inventory_movements, in one transaction. */
    quantityOnHand: numeric({ precision: 14, scale: 3 }).notNull().default('0'),
    /** At or below this, the item counts as low. Null means it is not watched. */
    reorderLevel: numeric({ precision: 14, scale: 3 }),
    unitCost: numeric({ precision: 14, scale: 2 }),
    currency: char({ length: 3 }).notNull(),
    supplierName: text(),
    notes: text(),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('inventory_items_tenant_id_id_key').on(table.tenantId, table.id),
    index('inventory_items_list_idx')
      .on(table.tenantId, table.name)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [inventoryCategories.tenantId, inventoryCategories.id],
      name: 'inventory_items_tenant_category_fk',
    }),
  ],
);

/** The ledger: every change to an item's quantity, never edited or removed. */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    itemId: uuid().notNull(),
    type: inventoryMovementType().notNull(),
    /** Signed: positive adds stock, negative removes it. */
    quantityDelta: numeric({ precision: 14, scale: 3 }).notNull(),
    quantityAfter: numeric({ precision: 14, scale: 3 }).notNull(),
    /** Cost per unit for stock received, when known. */
    unitCost: numeric({ precision: 14, scale: 2 }),
    note: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [
    index('inventory_movements_item_idx').on(table.tenantId, table.itemId, table.occurredAt.desc()),
    foreignKey({
      columns: [table.tenantId, table.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
      name: 'inventory_movements_tenant_item_fk',
    }),
  ],
);
