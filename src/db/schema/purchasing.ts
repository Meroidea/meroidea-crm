import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

export const purchaseOrderStatus = pgEnum('purchase_order_status', [
  'sent',
  'not_sent',
  'cancelled',
]);

/** A business the workspace buys from, with how and when it takes orders. */
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    contactName: text(),
    /** Where orders are sent. */
    orderEmail: text(),
    phone: text(),
    accountNumber: text(),
    notes: text(),
    /** Weekdays they deliver, 0 = Sunday … 6 = Saturday. Empty means any day. */
    deliveryDays: integer()
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    /** Whole days an order must be placed ahead of its delivery. */
    leadDays: integer().notNull().default(1),
    /** Latest time on the ordering day, "HH:MM" in the workspace timezone. Null means any time. */
    cutoffTime: text(),
    /** How orders reach them; names a channel in src/modules/purchasing/channels.ts. */
    orderChannel: text().notNull().default('email'),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [unique('suppliers_tenant_id_id_key').on(table.tenantId, table.id)],
);

/** One line of a supplier's price list. */
export const supplierItems = pgTable(
  'supplier_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    supplierId: uuid().notNull(),
    name: text().notNull(),
    /** The supplier's own product code, when their list has one. */
    code: text(),
    /** What one unit of the price buys: "carton of 12", "5 kg bag". */
    unit: text(),
    unitPrice: numeric({ precision: 14, scale: 2 }).notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('supplier_items_tenant_id_id_key').on(table.tenantId, table.id),
    index('supplier_items_supplier_idx').on(table.tenantId, table.supplierId, table.name),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'supplier_items_tenant_supplier_fk',
    }),
  ],
);

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    supplierId: uuid().notNull(),
    /** Counts up per workspace; shown as PO-0001. */
    number: integer().notNull(),
    deliveryDate: date({ mode: 'string' }).notNull(),
    status: purchaseOrderStatus().notNull().default('not_sent'),
    notes: text(),
    total: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    currency: char({ length: 3 }).notNull(),
    channel: text().notNull(),
    /** Where it was sent, as it stood at the time. */
    sentTo: text(),
    sentAt: timestamp({ withTimezone: true }),
    /** The supplier's own reference, when their system returns one. */
    externalReference: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (table) => [
    unique('purchase_orders_tenant_id_id_key').on(table.tenantId, table.id),
    unique('purchase_orders_tenant_number_key').on(table.tenantId, table.number),
    index('purchase_orders_supplier_idx').on(
      table.tenantId,
      table.supplierId,
      table.createdAt.desc(),
    ),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'purchase_orders_tenant_supplier_fk',
    }),
  ],
);

/** What was ordered, with the name and price as they were on the day. */
export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    orderId: uuid().notNull(),
    supplierItemId: uuid(),
    name: text().notNull(),
    code: text(),
    unit: text(),
    unitPrice: numeric({ precision: 14, scale: 2 }).notNull(),
    quantity: numeric({ precision: 14, scale: 3 }).notNull(),
    lineTotal: numeric({ precision: 14, scale: 2 }).notNull(),
    position: integer().notNull().default(0),
  },
  (table) => [
    index('purchase_order_lines_order_idx').on(table.tenantId, table.orderId, table.position),
    foreignKey({
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
      name: 'purchase_order_lines_tenant_order_fk',
    }),
  ],
);
