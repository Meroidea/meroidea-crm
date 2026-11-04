import {
  boolean,
  char,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

/**
 * Bookkeeping (ADR-060): a double-entry ledger underneath invoices and payroll. Every write to
 * `ledger_entries` / `ledger_lines` goes through the `app.ledger_*` functions, which check the
 * permission, the lock date and that debits equal credits; signed-in users hold only `select`
 * on those two tables. Entries are never edited: a mistake is undone by a reversing entry.
 */

/** GST/VAT codes. Seeded from a country pack, then the business's own to change. */
export const ledgerTaxCodes = pgTable(
  'ledger_tax_codes',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    code: text().notNull(),
    name: text().notNull(),
    /** Percent, such as 10.00 for GST. */
    rate: numeric({ precision: 5, scale: 2 }).notNull(),
    /** taxable · gst_free · input_taxed · export · capital · out_of_scope */
    kind: text().notNull(),
    /** sales · purchases · both */
    appliesTo: text().notNull(),
    /** A country pack's own name for it, so posting code can find it. Never changes. */
    systemKey: text(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (table) => [
    unique('ledger_tax_codes_tenant_id_id_key').on(table.tenantId, table.id),
    unique('ledger_tax_codes_code_key').on(table.tenantId, table.code),
    unique('ledger_tax_codes_system_key').on(table.tenantId, table.systemKey),
  ],
);

/** The chart of accounts. Accounts are archived, never deleted. */
export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    code: text().notNull(),
    name: text().notNull(),
    /** asset · liability · equity · income · expense */
    type: text().notNull(),
    /** The report section: current_asset, fixed_asset, revenue, cost_of_sales, … */
    subtype: text().notNull(),
    /** Money held or owed through a bank: bank, cash and credit card accounts. */
    isBank: boolean().notNull().default(false),
    /** Accounts posting relies on (receivables, GST, wages payable, …). Cannot be archived. */
    systemKey: text(),
    defaultTaxCodeId: uuid(),
    description: text(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (table) => [
    unique('ledger_accounts_tenant_id_id_key').on(table.tenantId, table.id),
    unique('ledger_accounts_code_key').on(table.tenantId, table.code),
    unique('ledger_accounts_system_key').on(table.tenantId, table.systemKey),
    foreignKey({
      columns: [table.tenantId, table.defaultTaxCodeId],
      foreignColumns: [ledgerTaxCodes.tenantId, ledgerTaxCodes.id],
      name: 'ledger_accounts_tax_code_fk',
    }),
  ],
);

/** One row per business once its books are set up; its presence means "books are on". */
export const ledgerSettings = pgTable(
  'ledger_settings',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** The country pack the chart and tax codes came from, such as AU. */
    countryPack: char({ length: 2 }).notNull(),
    /** 7 for an Australian July–June year. */
    financialYearStartMonth: smallint().notNull(),
    /** The first day these books cover; earlier activity arrives as opening balances. */
    startDate: date({ mode: 'string' }).notNull(),
    /** Nothing dated on or before this day changes, except by someone with `books.manage`. */
    lockDate: date({ mode: 'string' }),
    /** Where customer payments on invoices land. */
    receiptsAccountId: uuid().notNull(),
    /** Which income account invoice lines post to. */
    invoiceIncomeAccountId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId], name: 'ledger_settings_pkey' }),
    foreignKey({
      columns: [table.tenantId, table.receiptsAccountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
      name: 'ledger_settings_receipts_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.invoiceIncomeAccountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
      name: 'ledger_settings_income_fk',
    }),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** The business's own running number, from 1. */
    number: integer().notNull(),
    date: date({ mode: 'string' }).notNull(),
    /**
     * money_in · money_out · transfer · journal · opening_balance (entered in the books);
     * invoice · invoice_payment · payslip · payslip_payment (posted from other modules);
     * reversal (undoes another entry).
     */
    kind: text().notNull(),
    description: text().notNull(),
    reference: text(),
    /** Who the money came from or went to, as typed. */
    contactName: text(),
    /** An accountant's adjusting journal, flagged as such. */
    isAdjustment: boolean().notNull().default(false),
    /** The document this was posted from: invoice or payslip. */
    sourceType: text(),
    sourceId: uuid(),
    /** issued · paid · voided for invoices; released · paid for payslips. */
    sourceEvent: text(),
    /** Hidden from anyone without `books.view_payroll`. */
    payroll: boolean().notNull().default(false),
    currency: char({ length: 3 }).notNull(),
    reversesEntryId: uuid(),
    reversedByEntryId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [
    unique('ledger_entries_tenant_id_id_key').on(table.tenantId, table.id),
    unique('ledger_entries_number_key').on(table.tenantId, table.number),
    index('ledger_entries_date_idx').on(table.tenantId, table.date, table.number),
    index('ledger_entries_source_idx').on(table.tenantId, table.sourceType, table.sourceId),
    foreignKey({
      columns: [table.tenantId, table.reversesEntryId],
      foreignColumns: [table.tenantId, table.id],
      name: 'ledger_entries_reverses_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reversedByEntryId],
      foreignColumns: [table.tenantId, table.id],
      name: 'ledger_entries_reversed_by_fk',
    }),
  ],
);

export const ledgerLines = pgTable(
  'ledger_lines',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    entryId: uuid().notNull(),
    accountId: uuid().notNull(),
    /** A copy of the entry's date, so reports filter lines without joining. */
    date: date({ mode: 'string' }).notNull(),
    debit: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    credit: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    description: text(),
    taxCodeId: uuid(),
    /** The GST on this line, held in the GST account by a separate line of the same entry. */
    taxAmount: numeric({ precision: 14, scale: 2 }),
    payroll: boolean().notNull().default(false),
    position: integer().notNull().default(0),
  },
  (table) => [
    unique('ledger_lines_tenant_id_id_key').on(table.tenantId, table.id),
    index('ledger_lines_entry_idx').on(table.tenantId, table.entryId),
    index('ledger_lines_account_idx').on(table.tenantId, table.accountId, table.date),
    foreignKey({
      columns: [table.tenantId, table.entryId],
      foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id],
      name: 'ledger_lines_entry_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.accountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
      name: 'ledger_lines_account_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.taxCodeId],
      foreignColumns: [ledgerTaxCodes.tenantId, ledgerTaxCodes.id],
      name: 'ledger_lines_tax_code_fk',
    }),
  ],
);

/**
 * Supplier bills (ADR-062): what the business owes for goods and services. Entered in the books,
 * posted as expenses and GST against accounts payable, and voided rather than deleted.
 */
export const ledgerBills = pgTable(
  'ledger_bills',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Counts up per business; shown as BILL-0001. */
    number: integer().notNull(),
    supplierName: text().notNull(),
    /** The supplier's own invoice number. */
    supplierReference: text(),
    date: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    /** inclusive · exclusive · no_tax: how the amounts were typed. */
    amountsAre: text().notNull(),
    subtotal: numeric({ precision: 14, scale: 2 }).notNull(),
    taxTotal: numeric({ precision: 14, scale: 2 }).notNull(),
    total: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: char({ length: 3 }).notNull(),
    notes: text(),
    voidedAt: timestamp({ withTimezone: true }),
    voidedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [
    unique('ledger_bills_tenant_id_id_key').on(table.tenantId, table.id),
    unique('ledger_bills_number_key').on(table.tenantId, table.number),
    index('ledger_bills_due_idx').on(table.tenantId, table.dueDate),
    index('ledger_bills_supplier_idx').on(table.tenantId, table.supplierName),
  ],
);

export const ledgerBillLines = pgTable(
  'ledger_bill_lines',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    billId: uuid().notNull(),
    accountId: uuid().notNull(),
    description: text(),
    /** Before tax. */
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    taxCodeId: uuid(),
    taxAmount: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    position: integer().notNull().default(0),
  },
  (table) => [
    unique('ledger_bill_lines_tenant_id_id_key').on(table.tenantId, table.id),
    index('ledger_bill_lines_bill_idx').on(table.tenantId, table.billId),
    foreignKey({
      columns: [table.tenantId, table.billId],
      foreignColumns: [ledgerBills.tenantId, ledgerBills.id],
      name: 'ledger_bill_lines_bill_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.accountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
      name: 'ledger_bill_lines_account_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.taxCodeId],
      foreignColumns: [ledgerTaxCodes.tenantId, ledgerTaxCodes.id],
      name: 'ledger_bill_lines_tax_code_fk',
    }),
  ],
);

/** Money paid to suppliers: one payment can settle several bills; voided, never deleted. */
export const ledgerBillPayments = pgTable(
  'ledger_bill_payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    date: date({ mode: 'string' }).notNull(),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: char({ length: 3 }).notNull(),
    /** The bank, cash or card account it was paid from. */
    accountId: uuid().notNull(),
    payeeName: text(),
    reference: text(),
    voidedAt: timestamp({ withTimezone: true }),
    voidedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [
    unique('ledger_bill_payments_tenant_id_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.accountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
      name: 'ledger_bill_payments_account_fk',
    }),
  ],
);

export const ledgerBillPaymentAllocations = pgTable(
  'ledger_bill_payment_allocations',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    paymentId: uuid().notNull(),
    billId: uuid().notNull(),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
  },
  (table) => [
    unique('ledger_bill_payment_allocations_tenant_id_id_key').on(table.tenantId, table.id),
    unique('ledger_bill_payment_allocations_pair_key').on(
      table.tenantId,
      table.paymentId,
      table.billId,
    ),
    index('ledger_bill_payment_allocations_bill_idx').on(table.tenantId, table.billId),
    foreignKey({
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [ledgerBillPayments.tenantId, ledgerBillPayments.id],
      name: 'ledger_bill_payment_allocations_payment_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.billId],
      foreignColumns: [ledgerBills.tenantId, ledgerBills.id],
      name: 'ledger_bill_payment_allocations_bill_fk',
    }),
  ],
);

/** A supplier's credit note against one bill: the expense and GST back, less owed. */
export const ledgerBillCredits = pgTable(
  'ledger_bill_credits',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    billId: uuid().notNull(),
    date: date({ mode: 'string' }).notNull(),
    reason: text().notNull(),
    /** The supplier's credit note number. */
    supplierReference: text(),
    accountId: uuid().notNull(),
    taxCodeId: uuid(),
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
    unique('ledger_bill_credits_tenant_id_id_key').on(table.tenantId, table.id),
    index('ledger_bill_credits_bill_idx').on(table.tenantId, table.billId),
    foreignKey({
      columns: [table.tenantId, table.billId],
      foreignColumns: [ledgerBills.tenantId, ledgerBills.id],
      name: 'ledger_bill_credits_bill_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.accountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
      name: 'ledger_bill_credits_account_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.taxCodeId],
      foreignColumns: [ledgerTaxCodes.tenantId, ledgerTaxCodes.id],
      name: 'ledger_bill_credits_tax_code_fk',
    }),
  ],
);
