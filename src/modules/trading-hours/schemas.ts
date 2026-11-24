import { z } from 'zod';

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30');

const tradingDaySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    open: z.boolean(),
    opensAt: z.union([clockTime, z.literal('')]),
    closesAt: z.union([clockTime, z.literal('')]),
    staffNeeded: z.coerce
      .number('Use a number of people')
      .int('Use a whole number')
      .min(1, 'At least 1 person')
      .max(50, 'At most 50 people'),
  })
  .superRefine((day, issue) => {
    if (!day.open) return;
    if (!day.opensAt)
      issue.addIssue({ code: 'custom', path: ['opensAt'], message: 'When does it open?' });
    if (!day.closesAt)
      issue.addIssue({ code: 'custom', path: ['closesAt'], message: 'When does it close?' });
    if (day.opensAt && day.opensAt === day.closesAt) {
      issue.addIssue({ code: 'custom', path: ['closesAt'], message: 'It closes when it opens' });
    }
  })
  .transform((day) => ({
    weekday: day.weekday,
    opensAt: day.open ? day.opensAt : null,
    closesAt: day.open ? day.closesAt : null,
    staffNeeded: day.staffNeeded,
  }));

/** The whole week at once: exactly one entry per weekday. */
export const tradingWeekSchema = z
  .array(tradingDaySchema)
  .length(7, 'Give all seven days')
  .refine(
    (days) => new Set(days.map((day) => day.weekday)).size === 7,
    'Each day of the week once',
  );

export const saveTradingHoursSchema = z.object({ days: tradingWeekSchema });

export type TradingWeekValues = z.input<typeof tradingWeekSchema>;
export type SaveTradingHoursInput = z.output<typeof saveTradingHoursSchema>;
