import { z } from 'zod';

import { MAX_ATTACHMENT_BYTES } from './attachments';
import { ROSTER_STRATEGIES } from './types';

export const MAX_PROMPT_LENGTH = 4000;
export const MAX_HISTORY = 10;

/** One request to the assistant. The history comes from the browser: it is the person's own. */
export const assistantRequestSchema = z.object({
  prompt: z.string().trim().min(1, 'Ask the assistant something').max(MAX_PROMPT_LENGTH),
  /** What the person has open, so "this contact" means something. Ids only. */
  context: z
    .object({
      contactId: z.uuid().optional(),
      opportunityId: z.uuid().optional(),
    })
    .default({}),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'model']),
        text: z.string().max(MAX_PROMPT_LENGTH),
      }),
    )
    .max(MAX_HISTORY)
    .default([]),
  file: z
    .instanceof(File)
    .refine((file) => file.size > 0, 'The file is empty')
    .refine((file) => file.size <= MAX_ATTACHMENT_BYTES, 'Attach a file of 4 MB or less')
    .optional(),
});

export type AssistantRequest = z.output<typeof assistantRequestSchema>;

const isoDate = z.iso.date('Use a valid date');
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30');

/** Shifts from an approved roster preview. Each is checked again by the roster service. */
export const approveRosterSchema = z.object({
  shifts: z
    .array(
      z.object({
        date: isoDate,
        startTime: clockTime,
        endTime: clockTime,
        userId: z.uuid().nullable(),
        teamId: z.uuid().nullable(),
        breaks: z
          .array(z.object({ minutes: z.number().int().min(1).max(240), paid: z.boolean() }))
          .max(6),
        note: z.string().trim().max(300).nullable(),
      }),
    )
    .min(1, 'There are no shifts to save')
    .max(300),
});

export type ApproveRosterInput = z.output<typeof approveRosterSchema>;

/** A drafted note, approved (and perhaps edited) by the person, saved on the contact's timeline. */
export const approveNoteSchema = z.object({
  contactId: z.uuid(),
  body: z.string().trim().min(1, 'Write the note').max(5000),
});

export type ApproveNoteInput = z.output<typeof approveNoteSchema>;

/** Ask MeroAI on the roster page (ADR-076): a way of working, and optionally a few words more. */
export const meroAIRosterSchema = z.object({
  startsOn: isoDate,
  span: z.enum(['week', 'fortnight']),
  strategy: z.enum(ROSTER_STRATEGIES),
  instructions: z
    .string()
    .trim()
    .max(500, 'Keep it under 500 characters')
    .optional()
    .transform((value) => value || undefined),
});

export type MeroAIRosterInput = z.output<typeof meroAIRosterSchema>;
