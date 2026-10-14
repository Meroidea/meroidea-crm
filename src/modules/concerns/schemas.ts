import { z } from 'zod';

/** What a question is about. Kept short and general so it fits any kind of business. */
export const CONCERN_CATEGORIES = {
  pay: 'Pay and payslips',
  hours: 'Hours and timesheets',
  roster: 'Shifts and roster',
  leave: 'Leave and time off',
  workplace: 'Workplace and equipment',
  other: 'Anything else',
} as const;
export type ConcernCategory = keyof typeof CONCERN_CATEGORIES;

/** Whom it is raised with decides who can read it (ADR-049). Managers cannot see pay. */
export const RAISED_WITH_LABELS = {
  manager: 'Managers',
  admin: 'The admin only',
} as const;
export type RaisedWith = keyof typeof RAISED_WITH_LABELS;

export const CONCERN_STATUS_LABELS = {
  open: 'Open',
  in_progress: 'Being looked at',
  resolved: 'Resolved',
} as const;
export type ConcernStatus = keyof typeof CONCERN_STATUS_LABELS;

const body = z
  .string()
  .trim()
  .min(1, 'Write what you want to say')
  .max(5000, 'Keep it under 5,000 characters');

export const raiseConcernSchema = z.object({
  raisedWith: z.enum(['manager', 'admin'], 'Choose whom to raise it with'),
  category: z.enum(
    Object.keys(CONCERN_CATEGORIES) as [ConcernCategory, ...ConcernCategory[]],
    'Choose what it is about',
  ),
  subject: z
    .string()
    .trim()
    .min(3, 'Give it a short title')
    .max(150, 'Keep the title under 150 characters'),
  details: body,
  /** Set when asked from a payslip; checked to be the person's own. */
  payslipId: z
    .union([z.uuid(), z.literal('')])
    .nullish()
    .transform((value) => value || null),
});
export type RaiseConcernValues = z.input<typeof raiseConcernSchema>;
export type RaiseConcernInput = z.output<typeof raiseConcernSchema>;

export const replyConcernSchema = z.object({ id: z.uuid(), body });
export const setConcernStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(['open', 'in_progress', 'resolved']),
});

export const concernViewSchema = z.object({
  view: z.enum(['mine', 'raised']).optional().catch(undefined),
});
