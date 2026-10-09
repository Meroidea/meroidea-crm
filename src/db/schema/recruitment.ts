import { sql } from 'drizzle-orm';
import {
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

/** A role a business is recruiting for. */
export const jobOpenings = pgTable(
  'job_openings',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    title: text().notNull(),
    /** casual | part_time | full_time | contract, shown to applicants. */
    employmentType: text().notNull(),
    location: text(),
    description: text().notNull(),
    /** draft → open → closed. Only an open job accepts applications. */
    status: text().notNull().default('draft'),
    /** The unguessable part of the public apply address. */
    publicToken: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('job_openings_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('job_openings_public_token_key').on(table.publicToken),
    index('job_openings_list_idx')
      .on(table.tenantId, table.status)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/** Someone who applied for a job, and where they are in the process. */
export const jobApplicants = pgTable(
  'job_applicants',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobOpeningId: uuid().notNull(),
    fullName: text().notNull(),
    email: text().notNull(),
    phone: text(),
    coverNote: text(),
    /** Server-chosen path of the résumé in the private bucket. */
    resumePath: text(),
    resumeName: text(),
    /** website = applied through the public page; manual = added by the business. */
    source: text().notNull().default('manual'),
    /** applied → screening → interview → offer → hired, or rejected at any point. */
    stage: text().notNull().default('applied'),
    rating: integer(),
    rejectionReason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('job_applicants_tenant_id_id_key').on(table.tenantId, table.id),
    foreignKey({
      name: 'job_applicants_opening_fkey',
      columns: [table.tenantId, table.jobOpeningId],
      foreignColumns: [jobOpenings.tenantId, jobOpenings.id],
    }).onDelete('restrict'),
    index('job_applicants_opening_idx')
      .on(table.tenantId, table.jobOpeningId, table.stage)
      .where(sql`${table.deletedAt} is null`),
    // One live application per email address per job.
    uniqueIndex('job_applicants_once_key')
      .on(table.tenantId, table.jobOpeningId, sql`lower(${table.email})`)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/** Notes the hiring team keeps on an applicant: screening calls, interview feedback. */
export const applicantNotes = pgTable(
  'applicant_notes',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    applicantId: uuid().notNull(),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'applicant_notes_applicant_fkey',
      columns: [table.tenantId, table.applicantId],
      foreignColumns: [jobApplicants.tenantId, jobApplicants.id],
    }).onDelete('cascade'),
    index('applicant_notes_applicant_idx').on(table.tenantId, table.applicantId, table.createdAt),
  ],
);
