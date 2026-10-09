import { z } from 'zod';

const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);
const money = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Use an amount like 4.50');
const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,3})?$/, 'Use a quantity like 3 or 1.5');

const supplierFields = {
  name: required(120, 'Name the supplier'),
  contactName: optionalText(120),
  orderEmail: z
    .union([z.literal(''), z.null(), z.email('Enter a valid email address').max(200)])
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null)),
  phone: optionalText(40),
  accountNumber: optionalText(60),
  notes: optionalText(500),
  deliveryDays: z
    .array(z.coerce.number().int().min(0).max(6))
    .max(7)
    .default([])
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  leadDays: z.coerce.number('Use a number of days').int().min(0).max(60).default(1),
  cutoffTime: z
    .union([
      z.literal(''),
      z.null(),
      z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 14:00'),
    ])
    .optional()
    .transform((value) => value || null),
};

export const createSupplierSchema = z.object(supplierFields);
export const updateSupplierSchema = z.object({ id: z.uuid(), ...supplierFields });
export const supplierIdSchema = z.object({ id: z.uuid() });
export const setSupplierActiveSchema = z.object({ id: z.uuid(), isActive: z.boolean() });

export const importPriceListSchema = z.object({
  supplierId: z.uuid(),
  /** Take items that are not in this file off the supplier's list. */
  replace: z.boolean().default(false),
  items: z
    .array(
      z.object({
        name: required(200, 'Every item needs a name'),
        code: optionalText(60),
        unit: optionalText(60),
        unitPrice: money,
      }),
    )
    .min(1, 'The file has no items in it')
    .max(3000, 'That is more than 3,000 items; split the file'),
});

export const placeOrderSchema = z.object({
  supplierId: z.uuid(),
  deliveryDate: z.iso.date('Choose a delivery date'),
  notes: optionalText(500),
  lines: z
    .array(z.object({ supplierItemId: z.uuid(), quantity }))
    .min(1, 'Enter a quantity for at least one item')
    .max(500),
});

export const orderIdSchema = z.object({ id: z.uuid() });

export type SupplierFormValues = z.input<typeof createSupplierSchema>;
export type CreateSupplierInput = z.output<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.output<typeof updateSupplierSchema>;
export type ImportPriceListInput = z.output<typeof importPriceListSchema>;
export type PlaceOrderInput = z.output<typeof placeOrderSchema>;
