import { z } from 'zod';

import { TEAM_COLORS } from './rules';

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
/** A select's "nobody" or "none" option arrives as an empty string. */
const optionalId = z
  .union([z.uuid(), z.literal('')])
  .nullish()
  .transform((value) => value || null);

export const createRosterSchema = z.object({
  startsOn: isoDate,
  span: z.enum(ROSTER_SPANS),
  /** Start from the shifts of the roster before this one instead of an empty grid. */
  copyPrevious: z.boolean().default(false),
});

export const rosterIdSchema = z.object({ id: z.uuid() });

const shiftBreakSchema = z.object({
  minutes: z.coerce
    .number('Use a number of minutes')
    .int('Use whole minutes')
    .min(1, 'A break is at least a minute')
    .max(240, 'That break is too long'),
  paid: z.boolean(),
});

export const saveShiftSchema = z.object({
  /** Present when editing an existing shift. */
  id: z.uuid().optional(),
  rosterId: z.uuid(),
  /** Empty for a vacant shift. */
  userId: optionalId,
  teamId: optionalId,
  /** The calendar day the shift starts on, in the workspace timezone. */
  date: isoDate,
  startTime: clockTime,
  /** At or before the start time means the shift runs past midnight into the next day. */
  endTime: clockTime,
  breaks: z.array(shiftBreakSchema).max(6, 'That is too many breaks').default([]),
  /** True while the breaks are the ones the workspace's break rules give this shift. */
  autoBreaks: z.boolean().default(false),
  note: blankToNull(300),
});

export const shiftIdSchema = z.object({ id: z.uuid() });

export const copyShiftSchema = z.object({
  id: z.uuid(),
  /** Other days of the same roster to repeat the shift on. */
  dates: z.array(isoDate).min(1, 'Choose at least one day').max(13),
});

export const publishRosterSchema = z.object({
  id: z.uuid(),
  /** `changes` tells only people whose shifts changed; `all` tells everyone on the roster. */
  scope: z.enum(['changes', 'all']).default('changes'),
  /** Email each person their shifts. Publishing itself does not depend on it. */
  notify: z.boolean().default(false),
  message: blankToNull(500),
  /** People to leave out of the email. Their shifts are still published. */
  skipUserIds: z.array(z.uuid()).max(500).default([]),
});

export const saveTeamSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give the team a name').max(40),
  color: z.enum(TEAM_COLORS),
  memberIds: z.array(z.uuid()).max(500).default([]),
});

export const teamIdSchema = z.object({ id: z.uuid() });

const loading = z.coerce
  .number('Use a number such as 1.5')
  .min(1, 'A loading is at least 1, the ordinary rate')
  .max(5, 'That loading is too high');

export const saveRulesSchema = z.object({
  saturday: loading,
  sunday: loading,
  publicHoliday: loading,
  breakRules: z
    .array(
      z.object({
        fromMinutes: z.coerce
          .number('Use a number of minutes')
          .int()
          .min(30, 'Use a shift of at least 30 minutes')
          .max(1440),
        minutes: z.coerce.number('Use a number of minutes').int().min(1).max(240),
        paid: z.boolean(),
      }),
    )
    .max(8, 'That is too many break rules')
    .default([]),
});

export const addHolidaySchema = z.object({
  day: isoDate,
  name: z.string().trim().min(1, 'Name the holiday').max(60),
});

export const holidayIdSchema = z.object({ id: z.uuid() });

export const rosterPageParamsSchema = z.object({
  date: isoDate.optional().catch(undefined),
  view: z.enum(['day', 'person']).optional().catch(undefined),
});

export type CreateRosterInput = z.output<typeof createRosterSchema>;
export type ShiftFormValues = z.input<typeof saveShiftSchema>;
export type SaveShiftInput = z.output<typeof saveShiftSchema>;
export type CopyShiftInput = z.output<typeof copyShiftSchema>;
export type PublishRosterInput = z.output<typeof publishRosterSchema>;
export type SaveTeamInput = z.output<typeof saveTeamSchema>;
export type SaveRulesInput = z.output<typeof saveRulesSchema>;
export type AddHolidayInput = z.output<typeof addHolidaySchema>;
