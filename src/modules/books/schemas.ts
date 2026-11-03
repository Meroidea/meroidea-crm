import { z } from 'zod';

import { ACCOUNT_TYPES } from './packs';

const isoDate = z.iso.date('Use a valid date');
const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);
const optionalId = z
  .union([z.literal(''), z.null(), z.uuid()])
  .optional()
  .transform((value) => value || null);
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use an amount like 120.00')
  .refine((value) => Number(value) > 0, 'Enter more than zero');
const optionalAmount = z
  .string()
  .trim()
  .regex(/^(\d{1,12}(\.\d{1,2})?)?$/, 'Use an amount like 120.00')
  .optional()
  .transform((value) => value || '');

export const setupBooksSchema = z.object({
  country: z.enum(['AU']),
  startDate: isoDate,
  financialYearStartMonth: z.coerce.number().int().min(1).max(12),
});

export const moneySchema = z.object({
  kind: z.enum(['money_in', 'money_out']),
  date: isoDate,
  bankAccountId: z.uuid('Choose a bank account'),
  contactName: optionalText(150),
  reference: optionalText(100),
  description: required(300, 'Say what this was for'),
  amountsAre: z.enum(['inclusive', 'exclusive', 'no_tax']),
  items: z
    .array(
      z.object({
        accountId: z.uuid('Choose an account'),
        description: optionalText(300),
        amount,
        taxCodeId: optionalId,
      }),
    )
    .min(1, 'Add at least one line')
    .max(50),
});

export const transferSchema = z.object({
  date: isoDate,
  fromAccountId: z.uuid('Choose where the money came from'),
  toAccountId: z.uuid('Choose where the money went'),
  amount,
  description: required(300, 'Say what this transfer was for'),
  reference: optionalText(100),
});

export const journalSchema = z.object({
  kind: z.enum(['journal', 'opening_balance']),
  date: isoDate,
  description: required(300, 'Give the journal a narration'),
  reference: optionalText(100),
  isAdjustment: z.boolean().optional().default(false),
  lines: z
    .array(
      z.object({
        accountId: z.uuid('Choose an account'),
        description: optionalText(300),
        debit: optionalAmount,
        credit: optionalAmount,
      }),
    )
    .min(1, 'Add the lines')
    .max(100),
});

export const voidEntrySchema = z.object({
  id: z.uuid(),
  reason: optionalText(200),
});

const subtypes = ACCOUNT_TYPES.flatMap((entry) => entry.subtypes) as [string, ...string[]];

export const saveAccountSchema = z
  .object({
    id: z.uuid().optional(),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9.-]{1,12}$/, 'Up to 12 letters, digits, dots or dashes'),
    name: required(100, 'Name the account').refine((value) => value.length >= 2, 'Too short'),
    type: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
    subtype: z.enum(subtypes),
    isBank: z.boolean().optional().default(false),
    defaultTaxCodeId: optionalId,
    description: optionalText(500),
  })
  .refine(
    (value) =>
      ACCOUNT_TYPES.find((entry) => entry.type === value.type)?.subtypes.includes(
        value.subtype as never,
      ),
    { path: ['subtype'], message: 'That section does not belong to this type' },
  )
  .refine((value) => !value.isBank || value.type === 'asset' || value.type === 'liability', {
    path: ['isBank'],
    message: 'Only an asset or liability can be a bank account',
  });

export const archiveAccountSchema = z.object({ id: z.uuid(), archived: z.boolean() });

export const saveTaxCodeSchema = z.object({
  id: z.uuid().optional(),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,12}$/, 'Up to 12 letters, digits or dashes'),
  name: required(80, 'Name the tax code').refine((value) => value.length >= 2, 'Too short'),
  rate: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,2})?$|^100(\.0{1,2})?$/, 'Use a percentage like 10'),
  kind: z.enum(['taxable', 'gst_free', 'input_taxed', 'export', 'capital', 'out_of_scope']),
  appliesTo: z.enum(['sales', 'purchases', 'both']),
});

export const archiveTaxCodeSchema = z.object({ id: z.uuid(), archived: z.boolean() });

export const booksSettingsSchema = z.object({
  financialYearStartMonth: z.coerce.number().int().min(1).max(12),
  lockDate: z
    .union([z.literal(''), z.null(), isoDate])
    .optional()
    .transform((value) => value || null),
  receiptsAccountId: z.uuid('Choose a bank account'),
  invoiceIncomeAccountId: z.uuid('Choose an income account'),
});

export const payPayslipSchema = z.object({
  payslipId: z.uuid(),
  bankAccountId: z.uuid('Choose a bank account'),
  date: isoDate,
});

export const BOOKS_REPORTS = [
  'trial-balance',
  'profit-and-loss',
  'balance-sheet',
  'account',
] as const;
export const exportReportSchema = z.object({
  report: z.enum(BOOKS_REPORTS),
  from: isoDate.optional(),
  to: isoDate,
  accountId: z.uuid().optional(),
});

/** Report and list filters arrive in the address bar; anything unusable falls back to defaults. */
export const reportParamsSchema = z.object({
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  compare: z.enum(['none', 'previous']).optional().catch(undefined),
  view: z.enum(['plain', 'accountant']).optional().catch(undefined),
});

export const ENTRY_KINDS = [
  'money_in',
  'money_out',
  'transfer',
  'journal',
  'opening_balance',
  'invoice',
  'invoice_payment',
  'credit_note',
  'payslip',
  'payslip_payment',
  'reversal',
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const entryParamsSchema = z.object({
  kind: z.enum(ENTRY_KINDS).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  cursor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}_\d{1,9}$/)
    .optional()
    .catch(undefined),
});

export type SetupBooksInput = z.output<typeof setupBooksSchema>;
export type MoneyInput = z.output<typeof moneySchema>;
export type MoneyFormValues = z.input<typeof moneySchema>;
export type TransferInput = z.output<typeof transferSchema>;
export type TransferFormValues = z.input<typeof transferSchema>;
export type JournalInput = z.output<typeof journalSchema>;
export type JournalFormValues = z.input<typeof journalSchema>;
export type SaveAccountInput = z.output<typeof saveAccountSchema>;
export type AccountFormValues = z.input<typeof saveAccountSchema>;
export type SaveTaxCodeInput = z.output<typeof saveTaxCodeSchema>;
export type BooksSettingsInput = z.output<typeof booksSettingsSchema>;
export type BooksSettingsFormValues = z.input<typeof booksSettingsSchema>;
export type PayPayslipInput = z.output<typeof payPayslipSchema>;
export type ExportReportInput = z.output<typeof exportReportSchema>;
