import { z } from 'zod';

export const INTERACTION_TYPES = ['note', 'call', 'email', 'meeting', 'message'] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const INTERACTION_LABELS: Record<InteractionType, string> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  message: 'Message',
};

export const CALL_OUTCOMES = ['connected', 'no_answer', 'left_voicemail', 'busy'] as const;

export const logActivitySchema = z
  .object({
    type: z.enum(INTERACTION_TYPES),
    body: z.string().trim().max(5000).default(''),
    direction: z.enum(['inbound', 'outbound']).optional(),
    /** A call outcome from the business's own list (docs/leads.md §4.4). */
    outcome: z.string().trim().min(1).max(60).optional(),
    contactId: z.uuid().optional(),
    opportunityId: z.uuid().optional(),
  })
  .refine((value) => value.contactId || value.opportunityId, {
    message: 'Attach it to a record',
  })
  // A call can be logged in two clicks: its outcome is enough; everything else needs words.
  .refine((value) => value.body.length > 0 || (value.type === 'call' && value.outcome), {
    message: 'Write what happened',
    path: ['body'],
  });

export type LogActivityInput = z.output<typeof logActivitySchema>;
