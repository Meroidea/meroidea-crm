import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .transform((value) => value || null);

export const organizationFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(160),
  /** Free text in MVP; the tenant's own list (settings.organization_types) arrives with M12. */
  type: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null)),
  email: z
    .union([z.literal(''), z.email('Enter a valid email address').max(200)])
    .optional()
    .transform((value) => value || null),
  phone: optionalText(40),
  website: z
    .union([z.literal(''), z.url({ protocol: /^https?$/, error: 'Enter a full web address' })])
    .optional()
    .transform((value) => value || null),
  addressLine: optionalText(200),
  city: optionalText(80),
  region: optionalText(80),
  country: z
    .union([z.literal(''), z.string().trim().length(2, 'Use a 2-letter country code')])
    .optional()
    .transform((value) => (value ? value.toUpperCase() : null)),
});

export const createOrganizationSchema = organizationFieldsSchema;
export const updateOrganizationSchema = organizationFieldsSchema.extend({ id: z.uuid() });
export const organizationIdSchema = z.object({ id: z.uuid() });

export type OrganizationFormValues = z.input<typeof organizationFieldsSchema>;
export type OrganizationInput = z.output<typeof organizationFieldsSchema>;
export type UpdateOrganizationInput = z.output<typeof updateOrganizationSchema>;

export const organizationListFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  type: z.string().trim().max(40).optional().catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
});

export type OrganizationListFilters = z.output<typeof organizationListFiltersSchema>;
