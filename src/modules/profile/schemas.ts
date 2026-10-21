import { z } from 'zod';

/** What a person may change about themselves. Their email is their sign-in, so it is not here. */
export const updateMyProfileSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name').max(120, 'Use 120 characters or fewer'),
  phone: z
    .string()
    .trim()
    .max(32, 'Use 32 characters or fewer')
    .regex(/^[+()\d\s-]*$/, 'Use digits, spaces, +, - and brackets only')
    .transform((value) => (value === '' ? null : value)),
});

export type UpdateMyProfileInput = z.input<typeof updateMyProfileSchema>;
