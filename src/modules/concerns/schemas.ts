import { z } from 'zod';

/** What a concern is about. Kept short and general so it fits any kind of business. */
export const CONCERN_CATEGORIES = {
  roster: 'Shifts and roster',
  pay: 'Pay and payslips',
  workplace: 'Workplace and equipment',
  safety: 'Health and safety',
  conduct: 'How someone is treated',
  other: 'Something else',
} as const;
export type ConcernCategory = keyof typeof CONCERN_CATEGORIES;

/** Whom it is raised with decides who can read it (ADR-049). */
export const RAISED_WITH_LABELS = {
  manager: 'A manager',
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
