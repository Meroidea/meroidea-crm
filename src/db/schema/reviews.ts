import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

/** A place customers are asked for a review: a counter sign, a receipt, an email footer. */
export const reviewLinks = pgTable(
  'review_links',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** For the business only: where this link or QR code is used. */
    name: text().notNull(),
    /** The question customers see. */
    prompt: text().notNull(),
    /** The unguessable part of the public address. */
    publicToken: text().notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('review_links_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('review_links_public_token_key').on(table.publicToken),
  ],
);

/** What a customer said, and what the business did about it. */
export const customerReviews = pgTable(
  'customer_reviews',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    reviewLinkId: uuid().notNull(),
    rating: integer().notNull(),
    comment: text(),
    customerName: text(),
    customerEmail: text(),
    /** The customer agreed to be contacted about their review. */
    contactAllowed: boolean().notNull().default(false),
    /** The CRM contact with the same email, when there is one. */
    contactId: uuid(),
    /** new → read → resolved */
    status: text().notNull().default('new'),
    internalNote: text(),
    handledBy: uuid(),
    handledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'customer_reviews_link_fkey',
      columns: [table.tenantId, table.reviewLinkId],
      foreignColumns: [reviewLinks.tenantId, reviewLinks.id],
    }).onDelete('restrict'),
    index('customer_reviews_list_idx')
      .on(table.tenantId, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
    index('customer_reviews_status_idx')
      .on(table.tenantId, table.status)
      .where(sql`${table.deletedAt} is null`),
  ],
);
