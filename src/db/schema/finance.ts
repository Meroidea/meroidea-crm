import {
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

import { employees } from './hiring';
import { rosters } from './roster';
import { tenants } from './tenancy';

export const invoiceStatus = pgEnum('invoice_status', ['draft', 'sent', 'paid', 'void']);
export const payslipStatus = pgEnum('payslip_status', ['draft', 'released']);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Counts up per workspace; shown as INV-0001. */
    number: integer().notNull(),
    status: invoiceStatus().notNull().default('draft'),
    customerName: text().notNull(),
    customerEmail: text(),
    customerAddress: text(),
    /** The seller's name, business number and address as printed on this invoice. */
    fromDetails: text(),
    issueDate: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    notes: text(),
    /** Percent of tax added to the subtotal, such as 10.00 for GST. */
    taxRate: numeric({ precision: 5, scale: 2 }).notNull().default('0'),
    subtotal: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    taxTotal: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    currency: char({ length: 3 }).notNull(),
    sentAt: timestamp({ withTimezone: true }),
    sentTo: text(),
    paidAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (table) => [
    unique('invoices_tenant_id_id_key').on(table.tenantId, table.id),
    unique('invoices_tenant_number_key').on(table.tenantId, table.number),
    index('invoices_status_idx').on(table.tenantId, table.status, table.dueDate),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    invoiceId: uuid().notNull(),
    description: text().notNull(),
    quantity: numeric({ precision: 14, scale: 3 }).notNull(),
    unitPrice: numeric({ precision: 14, scale: 2 }).notNull(),
    lineTotal: numeric({ precision: 14, scale: 2 }).notNull(),
    position: integer().notNull().default(0),
  },
  (table) => [
    index('invoice_lines_invoice_idx').on(table.tenantId, table.invoiceId, table.position),
    foreignKey({
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
      name: 'invoice_lines_tenant_invoice_fk',
    }),
  ],
);

/** One person's pay for one authorised roster period. */
export const payslips = pgTable(
  'payslips',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    rosterId: uuid().notNull(),
    employeeId: uuid().notNull(),
    /** The employee's login, so they can read their own released payslip. */
    userId: uuid().notNull(),
    status: payslipStatus().notNull().default('draft'),
    periodStart: date({ mode: 'string' }).notNull(),
    periodEnd: date({ mode: 'string' }).notNull(),
    paymentDate: date({ mode: 'string' }).notNull(),
    /** Printed as written: employer name, business number and address. */
    employerDetails: text(),
    employeeName: text().notNull(),
    positionTitle: text(),
    /** Worked time after breaks, in minutes, summed from the roster's shifts. */
    minutes: integer().notNull(),
    hourlyRate: numeric({ precision: 14, scale: 2 }).notNull(),
    gross: numeric({ precision: 14, scale: 2 }).notNull(),
    /** Entered by whoever runs payroll; the system does not calculate tax. */
    taxWithheld: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    net: numeric({ precision: 14, scale: 2 }).notNull(),
    superRate: numeric({ precision: 5, scale: 2 }).notNull(),
    superAmount: numeric({ precision: 14, scale: 2 }).notNull(),
    superFundName: text(),
    currency: char({ length: 3 }).notNull(),
    /** The shifts paid: [{ date, start, end, minutes }]. */
    shifts: jsonb().notNull().default([]),
    releasedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (table) => [
    unique('payslips_roster_employee_key').on(table.tenantId, table.rosterId, table.employeeId),
    index('payslips_person_idx').on(table.tenantId, table.userId, table.periodStart),
    foreignKey({
      columns: [table.tenantId, table.rosterId],
      foreignColumns: [rosters.tenantId, rosters.id],
      name: 'payslips_tenant_roster_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
      name: 'payslips_tenant_employee_fk',
    }),
  ],
);
