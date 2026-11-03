import { z } from 'zod';

const isoDate = z.iso.date('Use a valid date');
const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const saveInvoiceSchema = z
  .object({
    /** Present when editing a draft. */
    id: z.uuid().optional(),
    customerName: required(160, 'Who is this invoice for?'),
    customerEmail: z
      .union([z.literal(''), z.null(), z.email('Enter a valid email address').max(200)])
      .optional()
      .transform((value) => (value ? value.toLowerCase() : null)),
    customerAddress: optionalText(300),
    fromDetails: optionalText(400),
    issueDate: isoDate,
    dueDate: isoDate,
    taxRate: z
      .string()
      .trim()
      .regex(/^\d{1,2}(\.\d{1,2})?$|^100(\.0{1,2})?$/, 'Use a percentage like 10'),
    notes: optionalText(600),
    lines: z
      .array(
        z.object({
          description: required(300, 'Describe this line'),
          quantity: z
            .string()
            .trim()
            .regex(/^\d{1,7}(\.\d{1,3})?$/, 'Use a quantity like 2 or 1.5')
            .refine((value) => Number(value) > 0, 'Enter more than zero'),
          unitPrice: z
            .string()
            .trim()
            .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Use an amount like 120.00'),
        }),
      )
      .min(1, 'Add at least one line')
      .max(100),
  })
  .refine((value) => value.dueDate >= value.issueDate, {
    path: ['dueDate'],
    message: 'The due date is before the invoice date',
  });

export const invoiceIdSchema = z.object({ id: z.uuid() });

export const INVOICE_FILTERS = ['all', 'outstanding', 'overdue', 'draft', 'closed'] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

export const invoiceParamsSchema = z.object({
  status: z.enum(INVOICE_FILTERS).optional().catch(undefined),
  cursor: z.coerce.number().int().positive().optional().catch(undefined),
});

export type InvoiceFormValues = z.input<typeof saveInvoiceSchema>;
export type SaveInvoiceInput = z.output<typeof saveInvoiceSchema>;

const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use an amount like 120.00')
  .refine((value) => Number(value) > 0, 'Enter more than zero');

/** One payment, split across one or more invoices (ADR-061). */
export const recordPaymentSchema = z.object({
  date: isoDate,
  payerName: optionalText(160),
  reference: optionalText(100),
  /** A bank account in the books; empty means the books' default for receipts. */
  accountId: z
    .union([z.literal(''), z.null(), z.uuid()])
    .optional()
    .transform((value) => value || null),
  allocations: z
    .array(z.object({ invoiceId: z.uuid(), amount: money }))
    .min(1, 'Choose at least one invoice')
    .max(100),
});

export const creditNoteSchema = z.object({
  invoiceId: z.uuid(),
  date: isoDate,
  /** Including tax, as the customer sees it. */
  amount: money,
  reason: required(300, 'Say why you are giving this credit'),
});

export type RecordPaymentInput = z.output<typeof recordPaymentSchema>;
export type RecordPaymentValues = z.input<typeof recordPaymentSchema>;
export type CreditNoteInput = z.output<typeof creditNoteSchema>;
