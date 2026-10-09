import { z } from 'zod';

export const CONTACT_STATUSES = ['active', 'inactive', 'do_not_contact'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  do_not_contact: 'Do not contact',
};

/** Form inputs arrive as strings; an empty field means "no value", stored as null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .transform((value) => value || null);

const optionalId = z
  .union([z.literal(''), z.uuid()])
  .optional()
  .transform((value) => value || null);

export const contactFieldsSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name').max(80),
  lastName: optionalText(80),
  email: z
    .union([z.literal(''), z.email('Enter a valid email address').max(200)])
    .optional()
    .transform((value) => value || null),
  phone: optionalText(40),
  altPhone: optionalText(40),
  dateOfBirth: z
    .union([z.literal(''), z.iso.date('Use a valid date')])
    .optional()
    .transform((value) => value || null),
  gender: optionalText(40),
  addressLine: optionalText(200),
  city: optionalText(80),
  region: optionalText(80),
  country: z
    .union([z.literal(''), z.string().trim().length(2, 'Use a 2-letter country code')])
    .optional()
    .transform((value) => (value ? value.toUpperCase() : null)),
  status: z.enum(CONTACT_STATUSES).default('active'),
  ownerUserId: optionalId,
  sourceId: optionalId,
  marketingConsent: z.boolean().default(false),
});

export const createContactSchema = contactFieldsSchema.extend({
  /** Duplicates warn rather than block (families share phones); this is the "create anyway". */
  confirmDuplicate: z.boolean().default(false),
});

export const updateContactSchema = contactFieldsSchema.extend({ id: z.uuid() });

export const contactIdSchema = z.object({ id: z.uuid() });

export const duplicateCheckSchema = z.object({
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  dateOfBirth: z
    .union([z.literal(''), z.iso.date()])
    .optional()
    .transform((value) => value || null),
  excludeId: z.uuid().optional(),
});

export const linkOrganizationSchema = z.object({
  contactId: z.uuid(),
  organizationId: z.uuid('Choose an organization'),
  relationship: z.string().trim().min(1, 'Describe the relationship').max(60),
});

export const unlinkOrganizationSchema = z.object({ contactId: z.uuid(), linkId: z.uuid() });

export type ContactFormValues = z.input<typeof createContactSchema>;
export type CreateContactInput = z.output<typeof createContactSchema>;
export type UpdateContactInput = z.output<typeof updateContactSchema>;
export type DuplicateCheckInput = z.output<typeof duplicateCheckSchema>;

export const contactListFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(CONTACT_STATUSES).optional().catch(undefined),
  source: z.uuid().optional().catch(undefined),
  owner: z
    .union([z.literal('me'), z.literal('unassigned'), z.uuid()])
    .optional()
    .catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
});

export type ContactListFilters = z.output<typeof contactListFiltersSchema>;
