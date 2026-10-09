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
    body: z.string().trim().min(1, 'Write what happened').max(5000),
    direction: z.enum(['inbound', 'outbound']).optional(),
    outcome: z.enum(CALL_OUTCOMES).optional(),
    contactId: z.uuid().optional(),
    opportunityId: z.uuid().optional(),
  })
  .refine((value) => value.contactId || value.opportunityId, {
    message: 'Attach it to a record',
  });

export type LogActivityInput = z.output<typeof logActivitySchema>;
