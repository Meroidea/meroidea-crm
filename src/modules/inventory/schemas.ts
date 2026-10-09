import { z } from 'zod';

const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, 'Use a quantity like 12 or 2.5');
const money = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Use an amount like 4.50');
const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);
/** Optional values that survive being validated twice: by the form, then by the action. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);
const optionalWith = <T extends z.ZodType>(schema: T) =>
  z
    .union([z.literal(''), z.null(), schema])
    .optional()
    .transform((value) => (value === '' || value == null ? null : (value as z.output<T>)));

const itemFields = {
  name: required(120, 'Name the item'),
  sku: optionalText(40),
  /** A category by name; one is created the first time a new name is used. */
  category: optionalText(60),
  unit: required(20, 'Say what one unit is').default('each'),
  reorderLevel: optionalWith(quantity),
  unitCost: optionalWith(money),
  supplierName: optionalText(120),
  notes: optionalText(500),
};

export const createItemSchema = z.object({
  ...itemFields,
  /** What is on the shelf today; recorded as the item's first stocktake. */
  openingQuantity: optionalWith(quantity),
});
export const updateItemSchema = z.object({ id: z.uuid(), ...itemFields });
export const itemIdSchema = z.object({ id: z.uuid() });
export const setItemActiveSchema = z.object({ id: z.uuid(), isActive: z.boolean() });

export const MOVEMENT_KINDS = ['received', 'used', 'wasted', 'add', 'remove', 'stocktake'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_KIND_LABELS: Record<MovementKind, { title: string; hint: string }> = {
  received: { title: 'Received', hint: 'A delivery or purchase arrived' },
  used: { title: 'Used', hint: 'Taken for normal use or sold' },
  wasted: { title: 'Wasted', hint: 'Spoiled, damaged, lost or expired' },
  add: { title: 'Correct up', hint: 'Found more than the system shows' },
  remove: { title: 'Correct down', hint: 'Found fewer than the system shows' },
  stocktake: { title: 'Stocktake', hint: 'Enter the counted quantity; the difference is recorded' },
};

export const recordMovementSchema = z
  .object({
    itemId: z.uuid(),
    kind: z.enum(MOVEMENT_KINDS),
    /** The amount moved, or for a stocktake the amount counted. Always positive. */
    quantity,
    /** Cost per unit of what was received; becomes the item's current unit cost. */
    unitCost: optionalWith(money),
    note: optionalText(300),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== 'stocktake' && /^0+(\.0+)?$/.test(value.quantity)) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter more than zero' });
    }
    // A correction or a write-off without a reason is exactly what a ledger exists to prevent.
    if (
      (value.kind === 'add' || value.kind === 'remove' || value.kind === 'wasted') &&
      !value.note
    ) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Say why, for the record' });
    }
  });

export const INVENTORY_VIEWS = ['all', 'low', 'out', 'archived'] as const;
export const inventoryFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  category: z.uuid().optional().catch(undefined),
  view: z.enum(INVENTORY_VIEWS).optional().catch(undefined),
});

export type ItemFormValues = z.input<typeof createItemSchema>;
export type CreateItemInput = z.output<typeof createItemSchema>;
export type UpdateItemInput = z.output<typeof updateItemSchema>;
export type MovementFormValues = z.input<typeof recordMovementSchema>;
export type RecordMovementInput = z.output<typeof recordMovementSchema>;
export type InventoryFilters = z.output<typeof inventoryFiltersSchema>;
