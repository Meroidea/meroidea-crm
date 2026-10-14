import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .transform((value) => value || null);

const optionalAmount = z
  .union([
    z.literal(''),
    z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use a number like 1500 or 1500.50'),
  ])
  .optional()
  .transform((value) => value || null);

const optionalDate = z
  .union([z.literal(''), z.iso.date('Use a valid date')])
  .optional()
  .transform((value) => value || null);

export const setLeadStatusSchema = z.object({
  contactId: z.uuid(),
  statusId: z.uuid('Choose a status'),
  reasonId: z
    .union([z.literal(''), z.uuid()])
    .optional()
    .transform((value) => value || null),
  note: optionalText(1000),
});

export const assignLeadsSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('person'),
    contactIds: z.array(z.uuid()).min(1).max(200),
    ownerUserId: z.uuid('Choose someone').nullable(),
  }),
  z.object({ mode: z.literal('auto'), contactIds: z.array(z.uuid()).min(1).max(200) }),
]);

export const handoverSchema = z.object({
  contactId: z.uuid(),
  /** Null: let the handover routing rules choose. */
  toUserId: z
    .union([z.literal(''), z.uuid()])
    .optional()
    .transform((value) => value || null),
  /** The call or meeting agreed with the lead, as an instant (the form converts local time). */
  meetingAt: z
    .union([z.literal(''), z.iso.datetime({ offset: true })])
    .optional()
    .transform((value) => (value ? new Date(value) : null)),
  summary: z.string().trim().min(10, 'Write a short handover summary').max(2000),
});

const organizationChoice = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('existing'), id: z.uuid('Choose one') }),
  z.object({
    mode: z.literal('new'),
    name: z.string().trim().min(1, 'Enter its name').max(160),
    website: optionalText(200),
    confirmNew: z.boolean().default(false),
  }),
]);

export const convertLeadSchema = z.object({
  contactId: z.uuid(),
  opportunityName: z.string().trim().min(1, 'Give it a name').max(160),
  pipelineId: z
    .union([z.literal(''), z.uuid()])
    .optional()
    .transform((value) => value || null),
  organization: organizationChoice.default({ mode: 'none' }),
  contactRole: optionalText(60),
  amount: optionalAmount,
  expectedCloseDate: optionalDate,
  product: optionalText(160),
  nextStep: optionalText(300),
});

export const acceptHandoverSchema = convertLeadSchema;

export const directConvertSchema = convertLeadSchema.extend({
  ownerUserId: z
    .union([z.literal(''), z.uuid()])
    .optional()
    .transform((value) => value || null),
});

export const rejectHandoverSchema = z.object({
  contactId: z.uuid(),
  reasonId: z.uuid('Choose a reason'),
  note: optionalText(1000),
});

export const linkContactsSchema = z.object({
  contactId: z.uuid(),
  relatedContactId: z.uuid('Choose a person'),
  relationship: z.string().trim().min(1, 'Choose how they are related').max(60),
});

export const unlinkContactsSchema = z.object({ contactId: z.uuid(), linkId: z.uuid() });

export const contactIdOnlySchema = z.object({ contactId: z.uuid() });

export type SetLeadStatusInput = z.output<typeof setLeadStatusSchema>;
export type AssignLeadsInput = z.output<typeof assignLeadsSchema>;
export type HandoverInput = z.output<typeof handoverSchema>;
export type ConvertLeadInput = z.output<typeof convertLeadSchema>;
export type AcceptHandoverInput = z.output<typeof acceptHandoverSchema>;
export type RejectHandoverInput = z.output<typeof rejectHandoverSchema>;

export const leadQueueFiltersSchema = z.object({
  view: z
    .enum(['mine', 'queue', 'pending', 'returned', 'all', 'overdue'])
    .optional()
    .catch(undefined),
  status: z.uuid().optional().catch(undefined),
  source: z.uuid().optional().catch(undefined),
  type: z.enum(['b2b', 'b2c']).optional().catch(undefined),
  owner: z.uuid().optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
});

export type LeadQueueFilters = z.output<typeof leadQueueFiltersSchema>;

const formText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .transform((value) => value || null);

/** UTM tags a website passes along, so a lead keeps the campaign that brought it in. */
export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

/**
 * A submission to a business's website form (docs/leads.md §3.1). The same schema checks the
 * hosted page and a plain HTML form posted from the business's own site.
 */
export const webFormSubmissionSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(80),
  lastName: formText(80),
  email: z.email('Enter a valid email address').max(200),
  phone: formText(40),
  companyName: formText(160),
  jobTitle: formText(120),
  message: formText(4000),
  consent: z
    .union([z.boolean(), z.literal('on'), z.literal('true'), z.literal('')])
    .optional()
    .transform((value) => value === true || value === 'on' || value === 'true'),
  utm_source: formText(200),
  utm_medium: formText(200),
  utm_campaign: formText(200),
  utm_term: formText(200),
  utm_content: formText(200),
});

export type WebFormSubmission = z.output<typeof webFormSubmissionSchema>;
