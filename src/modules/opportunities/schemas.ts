import { z } from 'zod';

const optionalId = z
  .union([z.literal(''), z.uuid()])
  .optional()
  .transform((value) => value || null);

/** Money stays a decimal string end to end (coding-standards.md); only its shape is checked. */
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

export const opportunityFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(160),
  contactId: z.uuid('Choose who this is for'),
  organizationId: optionalId,
  amount: optionalAmount,
  expectedCloseDate: z
    .union([z.literal(''), z.iso.date('Use a valid date')])
    .optional()
    .transform((value) => value || null),
  ownerUserId: optionalId,
  sourceId: optionalId,
  partnerId: optionalId,
});

export const createOpportunitySchema = opportunityFieldsSchema.extend({ stageId: optionalId });
export const updateOpportunitySchema = opportunityFieldsSchema.extend({ id: z.uuid() });

export const moveStageSchema = z.object({
  id: z.uuid(),
  stageId: z.uuid(),
  lostReasonId: optionalId,
  lostReasonNote: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || null),
});

export const opportunityIdSchema = z.object({ id: z.uuid() });

export type OpportunityFormValues = z.input<typeof createOpportunitySchema>;
export type CreateOpportunityInput = z.output<typeof createOpportunitySchema>;
export type UpdateOpportunityInput = z.output<typeof updateOpportunitySchema>;
export type MoveStageInput = z.output<typeof moveStageSchema>;

export const opportunityListFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  stage: z.uuid().optional().catch(undefined),
  status: z.enum(['open', 'won', 'lost']).optional().catch(undefined),
  owner: z
    .union([z.literal('me'), z.literal('unassigned'), z.uuid()])
    .optional()
    .catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
});

export type OpportunityListFilters = z.output<typeof opportunityListFiltersSchema>;
