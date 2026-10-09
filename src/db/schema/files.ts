import { sql } from 'drizzle-orm';
import {
  bigint,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

/**
 * A file a business keeps in its document library. The bytes live in the private `documents`
 * storage bucket; this row points at the current version.
 */
export const libraryDocuments = pgTable(
  'library_documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Shown to people, without the extension. */
    name: text().notNull(),
    /** Lower-case, without the dot: docx, xlsx, pptx, pdf. */
    extension: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    /** A free-text folder name; null means the top level. */
    folder: text(),
    /** Server-chosen path in the bucket for the current version. */
    storagePath: text().notNull(),
    /** Counts up each time an edit is saved; also keys the editing session. */
    version: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('library_documents_tenant_id_id_key').on(table.tenantId, table.id),
    index('library_documents_list_idx')
      .on(table.tenantId, table.folder, table.name)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/** Every saved version of a document, so an earlier one can be downloaded again. */
export const libraryDocumentVersions = pgTable(
  'library_document_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    documentId: uuid().notNull(),
    version: integer().notNull(),
    storagePath: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Who uploaded or saved this version, when known. */
    createdBy: uuid(),
  },
  (table) => [
    unique('library_document_versions_key').on(table.tenantId, table.documentId, table.version),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [libraryDocuments.tenantId, libraryDocuments.id],
      name: 'library_document_versions_tenant_document_fk',
    }),
  ],
);
