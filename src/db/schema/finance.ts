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

import type { PayslipLine } from '@/modules/payroll/lines';
import type { EmployerSnapshot } from '@/modules/settings/business';

import { ledgerAccounts } from './books';
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
    /** The person's Employee ID, kept on the payslip; null on payslips made before it existed. */
    employeeNumber: integer(),
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
    /** The employee's own count of payslips: 1 for their first. Null on older payslips. */
    number: integer(),
    /** The business as it described itself when the payslip was made. Null on older payslips. */
    employer: jsonb().$type<EmployerSnapshot>(),
    employmentType: text(),
    classification: text(),
    /** What the pay is made up of: hours at each rate, and allowances. Empty on older payslips. */
    lines: jsonb().$type<PayslipLine[]>().notNull().default([]),
    /** The shifts paid: [{ date, start, end, minutes }]. */
    shifts: jsonb().notNull().default([]),
    releasedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (table) => [
    unique('payslips_tenant_id_id_key').on(table.tenantId, table.id),
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

/**
 * Money received from a customer (ADR-061). One payment can settle several invoices and one
 * invoice can be paid by several payments; the split is in `invoice_payment_allocations`.
 * Payments are voided, never deleted, so the books can reverse them.
 */
export const invoicePayments = pgTable(
  'invoice_payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    date: date({ mode: 'string' }).notNull(),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: char({ length: 3 }).notNull(),
    payerName: text(),
    reference: text(),
    /** The bank account it went into, when the books are on; otherwise their default. */
    accountId: uuid(),
    voidedAt: timestamp({ withTimezone: true }),
    voidedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [
    unique('invoice_payments_tenant_id_id_key').on(table.tenantId, table.id),
    index('invoice_payments_date_idx').on(table.tenantId, table.date),
    foreignKey({
      columns: [table.tenantId, table.accountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
      name: 'invoice_payments_account_fk',
    }),
  ],
);

export const invoicePaymentAllocations = pgTable(
  'invoice_payment_allocations',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    paymentId: uuid().notNull(),
    invoiceId: uuid().notNull(),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
  },
  (table) => [
    unique('invoice_payment_allocations_tenant_id_id_key').on(table.tenantId, table.id),
    unique('invoice_payment_allocations_pair_key').on(
      table.tenantId,
      table.paymentId,
      table.invoiceId,
    ),
    index('invoice_payment_allocations_invoice_idx').on(table.tenantId, table.invoiceId),
    foreignKey({
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [invoicePayments.tenantId, invoicePayments.id],
      name: 'invoice_payment_allocations_payment_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
      name: 'invoice_payment_allocations_invoice_fk',
    }),
  ],
);

/** A credit against one invoice: reduces what is owed, with its GST, at the invoice's rate. */
export const invoiceCreditNotes = pgTable(
  'invoice_credit_notes',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Counts up per workspace; shown as CN-0001. */
    number: integer().notNull(),
    invoiceId: uuid().notNull(),
    date: date({ mode: 'string' }).notNull(),
    reason: text().notNull(),
    subtotal: numeric({ precision: 14, scale: 2 }).notNull(),
    taxTotal: numeric({ precision: 14, scale: 2 }).notNull(),
    total: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: char({ length: 3 }).notNull(),
    voidedAt: timestamp({ withTimezone: true }),
    voidedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [
    unique('invoice_credit_notes_tenant_id_id_key').on(table.tenantId, table.id),
    unique('invoice_credit_notes_number_key').on(table.tenantId, table.number),
    index('invoice_credit_notes_invoice_idx').on(table.tenantId, table.invoiceId),
    foreignKey({
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
      name: 'invoice_credit_notes_invoice_fk',
    }),
  ],
);
