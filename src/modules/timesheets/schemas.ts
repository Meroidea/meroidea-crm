import { z } from 'zod';

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00');
const optionalText = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((value) => value || null);
const breakMinutes = z.coerce
  .number('Enter minutes')
  .int('Use whole minutes')
  .min(0, 'Cannot be negative')
  .max(720, 'That break is too long');

/** Where the person's device says it is, sent when the business requires a location to clock. */
const position = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    /** The device's own estimate of how far off the reading may be, in metres. */
    accuracy: z.number().min(0).max(100_000),
  })
  .optional();

export const clockInSchema = z.object({ note: optionalText, position });
export const clockOutSchema = z.object({ breakMinutes: breakMinutes.default(0), position });
export type ClockPosition = z.output<typeof position>;

/** A stretch of work typed in afterwards. An end time at or before the start means it ran past midnight. */
export const manualEntrySchema = z.object({
  id: z.uuid().optional(),
  userId: z
    .union([z.uuid(), z.literal('')])
    .optional()
    .transform((value) => value || undefined),
  date: calendarDate,
  start: clockTime,
  end: clockTime,
  breakMinutes: breakMinutes.default(0),
  note: optionalText,
});

export const decideEntriesSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
  decision: z.enum(['approved', 'rejected', 'pending']),
});
export const entryIdSchema = z.object({ id: z.uuid() });

export const timesheetParamsSchema = z.object({
  view: z.enum(['mine', 'team']).optional().catch(undefined),
  week: calendarDate.optional().catch(undefined),
});

export type ManualEntryInput = z.output<typeof manualEntrySchema>;
export type ManualEntryValues = z.input<typeof manualEntrySchema>;
export type DecideEntriesInput = z.output<typeof decideEntriesSchema>;

export const ENTRY_STATUS_LABELS = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
} as const;
export type EntryStatus = keyof typeof ENTRY_STATUS_LABELS;
