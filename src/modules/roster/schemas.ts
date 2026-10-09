import { z } from 'zod';

export const ROSTER_SPANS = ['week', 'fortnight'] as const;
export type RosterSpan = (typeof ROSTER_SPANS)[number];

/** Inclusive calendar days in each kind of roster. */
export const ROSTER_SPAN_DAYS: Record<RosterSpan, number> = { week: 7, fortnight: 14 };

const isoDate = z.iso.date('Use a valid date');
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30');
/** Accepts its own output too: the form validates first, then the action validates again. */
const blankToNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const createRosterSchema = z.object({
  startsOn: isoDate,
  span: z.enum(ROSTER_SPANS),
  /** Start from the shifts of the roster before this one instead of an empty grid. */
  copyPrevious: z.boolean().default(false),
});

export const rosterIdSchema = z.object({ id: z.uuid() });

export const saveShiftSchema = z.object({
  /** Present when editing an existing shift. */
  id: z.uuid().optional(),
  rosterId: z.uuid(),
  userId: z.uuid('Choose a person'),
  /** The calendar day the shift starts on, in the workspace timezone. */
  date: isoDate,
  startTime: clockTime,
  /** At or before the start time means the shift runs past midnight into the next day. */
  endTime: clockTime,
  breakMinutes: z.coerce
    .number('Use a number of minutes')
    .int('Use whole minutes')
    .min(0, 'A break cannot be negative')
    .max(480, 'That break is too long')
    .default(0),
  position: blankToNull(24),
  note: blankToNull(300),
});

export const shiftIdSchema = z.object({ id: z.uuid() });

export const rosterPageParamsSchema = z.object({
  date: isoDate.optional().catch(undefined),
});

export type CreateRosterInput = z.output<typeof createRosterSchema>;
export type ShiftFormValues = z.input<typeof saveShiftSchema>;
export type SaveShiftInput = z.output<typeof saveShiftSchema>;
