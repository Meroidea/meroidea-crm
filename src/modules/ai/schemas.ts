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
      /** Set on the Roster page: the person has the roster for the week containing this day open. */
      rosterDate: z.iso.date().optional(),
      viewingRoster: z.boolean().optional(),
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
  /** Shifts already rostered that the plan replaces: removed before the new ones are added. */
  replaceShiftIds: z.array(z.uuid()).max(500).default([]),
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

const optionalFile = z
  .instanceof(File)
  .refine((file) => file.size > 0, 'The file is empty')
  .refine((file) => file.size <= MAX_ATTACHMENT_BYTES, 'Attach a file of 4 MB or less')
  .optional();

/** The roster agent's start form (ADR-079). */
export const rosterAgentBuildSchema = z
  .object({
    startsOn: isoDate,
    span: z.enum(['week', 'fortnight']),
    /** "MeroAI figures it out" from recent weeks, or "Use something saved": copy a roster. */
    start: z.enum(['figure_out', 'saved']),
    copyRosterId: z.uuid().optional(),
    /** Who goes on first when several people could take a shift. */
    priority: z.enum(['even_hours', 'lowest_cost', 'most_productive']).default('even_hours'),
    contractedFirst: z.boolean().default(true),
    /** Size the shifts from the trading hours' staff numbers instead of recent weeks. */
    useStaffCounts: z.boolean().default(false),
    replaceExisting: z.boolean().default(false),
    instructions: z
      .string()
      .trim()
      .max(1000, 'Keep it under 1,000 characters')
      .optional()
      .transform((value) => value || undefined),
    file: optionalFile,
  })
  .refine((value) => value.start !== 'saved' || value.copyRosterId, {
    message: 'Choose a roster to copy',
    path: ['copyRosterId'],
  });

export type RosterAgentBuildInput = z.output<typeof rosterAgentBuildSchema>;

export const rosterIdInputSchema = z.object({ rosterId: z.uuid() });

/** Vacant shifts given to people, as the agent proposed and the manager approved. */
export const vacantFillSchema = z.object({
  rosterId: z.uuid(),
  assignments: z
    .array(z.object({ shiftId: z.uuid(), userId: z.uuid() }))
    .min(1, 'There is nobody to give a shift to')
    .max(500),
});

export type VacantFillInput = z.output<typeof vacantFillSchema>;

/** A message to the roster agent about the roster that is open. */
export const rosterChatSchema = z.object({
  rosterId: z.uuid(),
  prompt: z.string().trim().min(1, 'Ask MeroAI something').max(MAX_PROMPT_LENGTH),
  history: z
    .array(z.object({ role: z.enum(['user', 'model']), text: z.string().max(MAX_PROMPT_LENGTH) }))
    .max(MAX_HISTORY)
    .default([]),
});

export type RosterChatInput = z.output<typeof rosterChatSchema>;

/** A thumbs up or down on something the roster agent did; recorded as a count, never words. */
export const rosterFeedbackSchema = z.object({
  rating: z.enum(['up', 'down']),
  about: z.enum(['plan', 'check', 'reply']),
});

/** "Authorise with MeroAI" on the timesheets pay period: the period containing this day. */
export const timesheetPrepareSchema = z.object({ date: isoDate });

/** The rows the manager reviewed and authorises; each is checked again by the timesheet service. */
export const timesheetAuthoriseSchema = z.object({
  rows: z
    .array(
      z.object({
        key: z.string().max(80),
        userId: z.uuid(),
        shiftId: z.uuid().nullable(),
        entryId: z.uuid().nullable(),
        date: isoDate,
        start: clockTime,
        end: clockTime,
        breakMinutes: z.number().int().min(0).max(720),
      }),
    )
    .min(1, 'There is nothing to authorise')
    .max(500),
  /** How many rows the manager changed from MeroAI's proposal, for the audit log. */
  edited: z.number().int().min(0).max(500).default(0),
});

export type TimesheetAuthoriseInput = z.output<typeof timesheetAuthoriseSchema>;

/** "Run payroll with MeroAI" on the pay period view, as the manager confirmed it (ADR-084). */
export const runPayrollSchema = z.object({
  /** Any day of the pay period. */
  date: isoDate,
  paymentDate: z.iso.date('Choose the payment date'),
  superRate: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, 'Use a percentage like 12'),
  employerDetails: z
    .string()
    .trim()
    .max(400)
    .nullish()
    .transform((value) => value || null),
});

export type RunPayrollInput = z.output<typeof runPayrollSchema>;

/** Ask MeroAI on the invoices page (ADR-077): an invoice described in a sentence or two. */
export const meroAIInvoiceDraftSchema = z.object({
  text: z
    .string()
    .trim()
    .min(5, 'Say who the invoice is for and what to charge')
    .max(1000, 'Keep it under 1,000 characters'),
});

export type MeroAIInvoiceDraftInput = z.output<typeof meroAIInvoiceDraftSchema>;
