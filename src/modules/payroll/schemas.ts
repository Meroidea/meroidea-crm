import { z } from 'zod';

export const authoriseRosterSchema = z.object({
  rosterId: z.uuid(),
  paymentDate: z.iso.date('Choose the payment date'),
  /** Superannuation as a percentage of gross pay. */
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
  /** Pay the rostered hours, or the approved timesheet entries for the same period. */
  hoursFrom: z.enum(['roster', 'timesheets']).default('roster'),
});

export const setTaxWithheldSchema = z.object({
  id: z.uuid(),
  taxWithheld: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Use an amount like 152.00'),
});

export const rosterIdSchema = z.object({ rosterId: z.uuid() });
export const payslipIdSchema = z.object({ id: z.uuid() });

export type AuthoriseRosterInput = z.output<typeof authoriseRosterSchema>;
