import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  inet,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { libraryDocuments } from './files';
import { tenantMemberships, tenants } from './tenancy';

/**
 * A request for people to sign a PDF from the document library (ADR-089). It pins the exact
 * stored version and, once sent, that version's SHA-256, so the file the signers saw is the file
 * that is stamped, whatever happens to the library document afterwards.
 */
export const signRequests = pgTable(
  'sign_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    documentId: uuid().notNull(),
    documentVersion: integer().notNull(),
    /** The pinned version's object in the `documents` bucket. Never changes. */
    originalStoragePath: text().notNull(),
    title: text().notNull(),
    /** Shown to signers with the invitation. */
    message: text(),
    /** draft → sent → completed | declined | voided. Expiry is read from expires_at. */
    status: text().notNull().default('draft'),
    /** parallel: everyone at once. sequential: one after another, in position order. */
    signingOrder: text().notNull().default('parallel'),
    /** Signers prove they hold the invited address with an emailed code before seeing the file. */
    verifyEmail: boolean().notNull().default(true),
    /** Days a sent request stays open; expires_at is set from it when the request is sent. */
    expiryDays: integer(),
    expiresAt: timestamp({ withTimezone: true }),
    pageCount: integer(),
    /** Hex SHA-256 of the original, recorded when sent and checked again before stamping. */
    originalSha256: text(),
    signedStoragePath: text(),
    /** Hex SHA-256 of the finished file, so anyone holding it can check it on /verify. */
    signedSha256: text(),
    sentAt: timestamp({ withTimezone: true }),
    sentBy: uuid(),
    completedAt: timestamp({ withTimezone: true }),
    declinedAt: timestamp({ withTimezone: true }),
    voidedAt: timestamp({ withTimezone: true }),
    voidReason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('sign_requests_tenant_id_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [libraryDocuments.tenantId, libraryDocuments.id],
      name: 'sign_requests_tenant_document_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'sign_requests_tenant_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.sentBy],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'sign_requests_tenant_sent_by_fk',
    }),
    index('sign_requests_list_idx')
      .on(table.tenantId, table.createdAt.desc())
      .where(sql`${table.deletedAt} is null`),
    index('sign_requests_document_idx')
      .on(table.tenantId, table.documentId)
      .where(sql`${table.deletedAt} is null`),
    index('sign_requests_signed_sha256_idx')
      .on(table.signedSha256)
      .where(sql`${table.signedSha256} is not null`),
    check(
      'sign_requests_status_check',
      sql`${table.status} in ('draft', 'sent', 'completed', 'declined', 'voided')`,
    ),
    check(
      'sign_requests_signing_order_check',
      sql`${table.signingOrder} in ('parallel', 'sequential')`,
    ),
    check('sign_requests_expiry_days_check', sql`${table.expiryDays} between 1 and 365`),
    check('sign_requests_sha256_check', sql`${table.originalSha256} ~ '^[0-9a-f]{64}$'`),
    check('sign_requests_signed_sha256_check', sql`${table.signedSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * One person asked to sign. They have no account: their link's secret is the credential, stored
 * only as a hash, plus an emailed code when the request asks for one. The credential columns are
 * never granted to signed-in people (ADR-089).
 */
export const signRequestSigners = pgTable(
  'sign_request_signers',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    requestId: uuid().notNull(),
    /** 1-based; the signing order when the request is sequential. */
    position: integer().notNull(),
    name: text().notNull(),
    email: text().notNull(),
    /** pending → signed | declined. */
    status: text().notNull().default('pending'),
    tokenHash: text().unique(),
    tokenExpiresAt: timestamp({ withTimezone: true }),
    /** Keyed hash of the current emailed code; cleared once used or after too many tries. */
    otpHash: text(),
    otpExpiresAt: timestamp({ withTimezone: true }),
    otpAttempts: integer().notNull().default(0),
    /** Hash of the browser session that entered the right code. */
    sessionHash: text(),
    verifiedAt: timestamp({ withTimezone: true }),
    /** When the link was last sent or handed over. */
    invitedAt: timestamp({ withTimezone: true }),
    viewedAt: timestamp({ withTimezone: true }),
    signedAt: timestamp({ withTimezone: true }),
    signedIp: inet(),
    signedUserAgent: text(),
    declinedAt: timestamp({ withTimezone: true }),
    declineReason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('sign_request_signers_tenant_id_id_key').on(table.tenantId, table.id),
    unique('sign_request_signers_position_key').on(table.requestId, table.position),
    unique('sign_request_signers_email_key').on(table.requestId, table.email),
    foreignKey({
      columns: [table.tenantId, table.requestId],
      foreignColumns: [signRequests.tenantId, signRequests.id],
      name: 'sign_request_signers_tenant_request_fk',
    }).onDelete('cascade'),
    index('sign_request_signers_request_idx').on(table.tenantId, table.requestId),
    check(
      'sign_request_signers_status_check',
      sql`${table.status} in ('pending', 'signed', 'declined')`,
    ),
    check('sign_request_signers_position_check', sql`${table.position} between 1 and 20`),
  ],
);

/**
 * A box on a page that one signer fills. Positions are fractions (0–1) of the page as it is
 * displayed, top-left origin, so they hold at any zoom; the server turns them into PDF space.
 */
export const signRequestFields = pgTable(
  'sign_request_fields',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    requestId: uuid().notNull(),
    signerId: uuid().notNull(),
    kind: text().notNull(),
    page: integer().notNull(),
    x: doublePrecision().notNull(),
    y: doublePrecision().notNull(),
    width: doublePrecision().notNull(),
    height: doublePrecision().notNull(),
    required: boolean().notNull().default(true),
    label: text(),
    /** Text for name, date, text and checkbox; the stored image's path for signature and initials. */
    value: text(),
    filledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('sign_request_fields_tenant_id_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.requestId],
      foreignColumns: [signRequests.tenantId, signRequests.id],
      name: 'sign_request_fields_tenant_request_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.signerId],
      foreignColumns: [signRequestSigners.tenantId, signRequestSigners.id],
      name: 'sign_request_fields_tenant_signer_fk',
    }).onDelete('cascade'),
    index('sign_request_fields_request_idx').on(table.tenantId, table.requestId),
    check(
      'sign_request_fields_kind_check',
      sql`${table.kind} in ('signature', 'initials', 'name', 'date', 'text', 'checkbox')`,
    ),
    check('sign_request_fields_page_check', sql`${table.page} >= 1`),
    check(
      'sign_request_fields_box_check',
      sql`${table.x} >= 0 and ${table.y} >= 0 and ${table.width} > 0 and ${table.height} > 0
        and ${table.x} + ${table.width} <= 1.0001 and ${table.y} + ${table.height} <= 1.0001`,
    ),
  ],
);

/**
 * What happened to a request, in order: the trail printed on the completion certificate. Rows are
 * only ever added.
 */
export const signRequestEvents = pgTable(
  'sign_request_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    requestId: uuid().notNull(),
    signerId: uuid(),
    /** A staff member, for events they caused; null for signers' own. */
    actorUserId: uuid(),
    event: text().notNull(),
    ip: inet(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.requestId],
      foreignColumns: [signRequests.tenantId, signRequests.id],
      name: 'sign_request_events_tenant_request_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.signerId],
      foreignColumns: [signRequestSigners.tenantId, signRequestSigners.id],
      name: 'sign_request_events_tenant_signer_fk',
    }).onDelete('cascade'),
    index('sign_request_events_request_idx').on(table.tenantId, table.requestId, table.createdAt),
    check(
      'sign_request_events_event_check',
      sql`${table.event} in ('created', 'sent', 'invited', 'code_sent', 'verified', 'viewed',
        'signed', 'declined', 'voided', 'completed')`,
    ),
  ],
);
