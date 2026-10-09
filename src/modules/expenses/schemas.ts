import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

/** Kept as a string end to end so cents are never rounded in JavaScript. */
const money = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Use an amount like 42.50')
  .refine((value) => Number(value) > 0, 'Enter an amount above zero');

export const EXPENSE_CATEGORIES = ['Travel', 'Meals', 'Supplies', 'Fuel', 'Equipment', 'Other'];

export const submitExpenseSchema = z.object({
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  category: z.string().trim().min(2, 'Choose a category').max(60),
  merchant: optionalText(120),
  description: optionalText(500),
  amount: money,
  /** Set by the upload step; checked again on the server before it is trusted. */
  receiptPath: optionalText(300),
  receiptName: optionalText(200),
});

export const startReceiptSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

export const decideExpenseSchema = z.object({
  id: z.uuid(),
  decision: z.enum(['approved', 'declined']),
  note: optionalText(500),
});
export const expenseIdSchema = z.object({ id: z.uuid() });

export const expenseParamsSchema = z.object({
  view: z.enum(['mine', 'team']).optional().catch(undefined),
});

export type SubmitExpenseInput = z.output<typeof submitExpenseSchema>;
export type SubmitExpenseValues = z.input<typeof submitExpenseSchema>;
export type DecideExpenseInput = z.output<typeof decideExpenseSchema>;

export const EXPENSE_STATUS_LABELS = {
  submitted: 'Waiting',
  approved: 'Approved, to be paid',
  declined: 'Declined',
  reimbursed: 'Paid back',
} as const;
export type ExpenseStatus = keyof typeof EXPENSE_STATUS_LABELS;
