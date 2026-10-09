import { z } from 'zod';

import { daysBetweenDates } from '@/lib/dates';

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

/** Up to two decimals, so half days work; kept as a string so nothing is rounded in JavaScript. */
const dayCount = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a number of days, such as 1 or 0.5'))
  .refine((value) => Number(value) > 0, 'Enter at least half a day');

export const requestLeaveSchema = z
  .object({
    leaveTypeId: z.uuid('Choose a type of leave'),
    startsOn: calendarDate,
    endsOn: calendarDate,
    days: dayCount,
    note: optionalText(500),
    /** Managers may enter leave for someone else; everyone else requests their own. */
    userId: z
      .union([z.uuid(), z.literal('')])
      .optional()
      .transform((value) => value || undefined),
  })
  .refine((value) => value.endsOn >= value.startsOn, {
    path: ['endsOn'],
    message: 'The last day cannot be before the first day',
  })
  .refine(
    (value) =>
      value.endsOn < value.startsOn ||
      Number(value.days) <= daysBetweenDates(value.startsOn, value.endsOn) + 1,
    { path: ['days'], message: 'That is more days than the dates cover' },
  );

export const decideLeaveSchema = z.object({
  id: z.uuid(),
  decision: z.enum(['approved', 'declined']),
  note: optionalText(500),
});

export const leaveIdSchema = z.object({ id: z.uuid() });

export const leaveTypeSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, 'Enter a name').max(60),
  isPaid: z.boolean(),
  isActive: z.boolean().default(true),
});

export const timeOffParamsSchema = z.object({
  view: z.enum(['mine', 'team', 'types']).optional().catch(undefined),
});

export type RequestLeaveInput = z.output<typeof requestLeaveSchema>;
export type RequestLeaveValues = z.input<typeof requestLeaveSchema>;
export type DecideLeaveInput = z.output<typeof decideLeaveSchema>;
export type LeaveTypeInput = z.output<typeof leaveTypeSchema>;

export const LEAVE_STATUS_LABELS = {
  pending: 'Waiting',
  approved: 'Approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
} as const;
export type LeaveStatus = keyof typeof LEAVE_STATUS_LABELS;
