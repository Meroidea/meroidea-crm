import { z } from 'zod';

export const PARTNER_STATUSES = ['prospect', 'active', 'inactive'] as const;
export const COMMISSION_TYPES = ['none', 'percentage', 'fixed'] as const;

export const PARTNER_STATUS_LABELS: Record<(typeof PARTNER_STATUSES)[number], string> = {
  prospect: 'Prospect',
  active: 'Active',
  inactive: 'Inactive',
};

export const partnerFieldsSchema = z
  .object({
    /** Either link an existing organization or name a new one. */
    organizationId: z
      .union([z.literal(''), z.uuid()])
      .optional()
      .transform((value) => value || null),
    organizationName: z
      .string()
      .trim()
      .max(160)
      .optional()
      .transform((value) => value || null),
    status: z.enum(PARTNER_STATUSES).default('active'),
    commissionType: z.enum(COMMISSION_TYPES).default('none'),
    commissionValue: z
      .union([
        z.literal(''),
        z
          .string()
          .trim()
          .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use a number like 10 or 250.00'),
      ])
      .optional()
      .transform((value) => value || null),
    notes: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => value || null),
  })
  .refine((value) => value.organizationId || value.organizationName, {
    message: 'Choose an organization or type a new name',
    path: ['organizationName'],
  });

export const updatePartnerSchema = z.object({
  id: z.uuid(),
  status: z.enum(PARTNER_STATUSES),
  commissionType: z.enum(COMMISSION_TYPES),
  commissionValue: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .regex(/^\d{1,12}(\.\d{1,2})?$/),
    ])
    .optional()
    .transform((value) => value || null),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => value || null),
});

export type PartnerFormValues = z.input<typeof partnerFieldsSchema>;
export type CreatePartnerInput = z.output<typeof partnerFieldsSchema>;
export type UpdatePartnerInput = z.output<typeof updatePartnerSchema>;
