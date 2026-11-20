import { z } from 'zod';

/** An email from the business to some or all of its own staff logins (ADR-064). */
export const staffEmailSchema = z.object({
  userIds: z
    .array(z.uuid())
    .min(1, 'Choose at least one person')
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Each person once'),
  subject: z.string().trim().min(1, 'Add a subject').max(150),
  body: z.string().trim().min(1, 'Write the message').max(5_000),
});

export type StaffEmailInput = z.output<typeof staffEmailSchema>;
