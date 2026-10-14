import { sql } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

/**
 * The service agreement between Meroidea and the businesses it serves (ADR-047). Platform-wide,
 * not tenant data. A version is never edited once published: new wording is a new version, so
 * every acceptance points at exactly the words that were accepted. Written only through the
 * privileged connection; a business's admin can read the version their business accepted.
 */
export const serviceAgreements = pgTable('service_agreements', {
  id: uuid().primaryKey().defaultRandom(),
  version: integer().notNull().unique(),
  title: text().notNull(),
  body: text().notNull(),
  /** The platform owner who published it (an auth user id; platform owners are not tenant data). */
  publishedBy: uuid().notNull(),
  publishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * One request to a business's admin to accept the service agreement, and the record of their
 * acceptance. At most one is open per business: sending a new link replaces the open one's
 * secret. An accepted row is kept as the evidence of what was agreed, by whom and when.
 */
export const tenantAgreements = pgTable(
  'tenant_agreements',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    agreementId: uuid()
      .notNull()
      .references(() => serviceAgreements.id, { onDelete: 'restrict' }),
    /** The admin login the link signs in once accepted. */
    recipientUserId: uuid().notNull(),
    recipientName: text().notNull(),
    recipientEmail: text().notNull(),
    /** SHA-256 of the one-time link's secret; cleared once accepted so the link cannot be reused. */
    tokenHash: text().unique(),
    tokenExpiresAt: timestamp({ withTimezone: true }),
    sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp({ withTimezone: true }),
    acceptedName: text(),
    acceptedIp: text(),
    acceptedUserAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tenant_agreements_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('tenant_agreements_one_open_key')
      .on(table.tenantId)
      .where(sql`${table.acceptedAt} is null`),
  ],
);
