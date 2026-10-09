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

export type InvoiceFormValues = z.input<typeof saveInvoiceSchema>;
export type SaveInvoiceInput = z.output<typeof saveInvoiceSchema>;
