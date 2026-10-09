import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

export const employmentType = pgEnum('employment_type', [
  'full_time',
  'part_time',
  'casual',
  'fixed_term',
  'contractor',
]);
export const employeeStatus = pgEnum('employee_status', ['pending', 'active', 'ended']);
export const contractStatus = pgEnum('contract_status', [
  'draft',
  'sent',
  'accepted',
  'declined',
  'withdrawn',
]);
export const payBasis = pgEnum('pay_basis', ['hourly', 'annual']);
/** Where the minimum the pay was checked against came from. */
export const rateSource = pgEnum('rate_source', ['fair_work', 'manual', 'none']);

/** A named group of employees: a department, division, site or whatever the workspace uses. */
export const departments = pgTable(
  'departments',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    position: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [unique('departments_tenant_id_id_key').on(table.tenantId, table.id)],
);

/** A person the workspace has hired or offered work to. Separate from a login (membership). */
export const employees = pgTable(
  'employees',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Set once the person is given a login; nothing requires one. */
    userId: uuid(),
    firstName: text().notNull(),
    lastName: text().notNull(),
    email: text().notNull(),
    phone: text(),
    /** What they like to be called day to day; legal names stay in first/last. */
    preferredName: text(),
    dateOfBirth: date({ mode: 'string' }),
    address: text(),
    emergencyContactName: text(),
    emergencyContactRelationship: text(),
    emergencyContactPhone: text(),
    departmentId: uuid(),
    /** Last day of employment, set when status becomes 'ended'. */
    endedOn: date({ mode: 'string' }),
    endReason: text(),
    status: employeeStatus().notNull().default('pending'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('employees_tenant_id_id_key').on(table.tenantId, table.id),
    index('employees_tenant_status_idx')
      .on(table.tenantId, table.status)
      .where(sql`${table.deletedAt} is null`),
    index('employees_department_idx').on(table.tenantId, table.departmentId),
    foreignKey({
      columns: [table.tenantId, table.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
      name: 'employees_tenant_department_fk',
    }),
  ],
);

/** The terms offered to an employee. Frozen once sent: a change of terms is a new contract. */
export const employmentContracts = pgTable(
  'employment_contracts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    employeeId: uuid().notNull(),
    employmentType: employmentType().notNull(),
    positionTitle: text().notNull(),
    startDate: date({ mode: 'string' }).notNull(),
    /** Required for fixed-term and contractor engagements. */
    endDate: date({ mode: 'string' }),
    hoursPerWeek: numeric({ precision: 5, scale: 2 }),
    payBasis: payBasis().notNull(),
    payRate: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: char({ length: 3 }).notNull(),
    awardCode: text(),
    awardName: text(),
    classification: text(),
    /** The classification's identifier in the pay database the minimum was read from. */
    classificationRef: text(),
    minimumRate: numeric({ precision: 14, scale: 2 }),
    rateSource: rateSource().notNull().default('none'),
    /** Why a rate under the looked-up minimum is lawful (a junior or trainee rate, say). */
    belowMinimumReason: text(),
    contractorAbn: text(),
    probationMonths: integer(),
    /** The exact wording the person was shown, kept so later template edits can't change it. */
    body: text(),
    /** Statutory statements given with the contract: [{ key, title, url }]. */
    statements: jsonb().notNull().default([]),
    status: contractStatus().notNull().default('draft'),
    /** SHA-256 of the one-time link's secret; the secret itself is never stored. */
    tokenHash: text().unique(),
    tokenExpiresAt: timestamp({ withTimezone: true }),
    sentAt: timestamp({ withTimezone: true }),
    sentBy: uuid(),
    viewedAt: timestamp({ withTimezone: true }),
    acceptedAt: timestamp({ withTimezone: true }),
    acceptedName: text(),
    acceptedIp: text(),
    acceptedUserAgent: text(),
    declinedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('employment_contracts_employee_idx').on(table.tenantId, table.employeeId),
    foreignKey({
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
      name: 'employment_contracts_tenant_employee_fk',
    }),
  ],
);

/**
 * Tax, bank and superannuation details the person enters themselves. The identifying numbers
 * are stored only as ciphertext (src/server/crypto.ts); the key never reaches the database.
 */
export const employeePayrollDetails = pgTable(
  'employee_payroll_details',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    employeeId: uuid().notNull(),
    taxFileNumberCiphertext: text(),
    taxResident: boolean(),
    claimsTaxFreeThreshold: boolean(),
    hasStudyLoan: boolean(),
    bankAccountName: text(),
    bankBsbCiphertext: text(),
    bankAccountCiphertext: text(),
    /** Last three digits, so a list can show which account without decrypting anything. */
    bankAccountLast3: text(),
    superFundName: text(),
    superFundUsi: text(),
    superMemberCiphertext: text(),
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('employee_payroll_details_employee_key').on(table.tenantId, table.employeeId),
    foreignKey({
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
      name: 'employee_payroll_details_tenant_employee_fk',
    }),
  ],
);
