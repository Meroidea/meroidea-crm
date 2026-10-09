import { z } from 'zod';

const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(72, 'Passwords can be at most 72 characters');

export const inviteMemberSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter their name').max(120),
  email: z.email('Enter a valid email address').max(200),
  roleId: z.uuid('Choose a role'),
  /** When inviting from a staff profile: the employee record this login belongs to. */
  employeeId: z.uuid().optional(),
});

export const memberSchema = z.object({ userId: z.uuid() });
export const memberStatusSchema = z.object({
  userId: z.uuid(),
  status: z.enum(['active', 'deactivated']),
});

export const forgotPasswordSchema = z.object({ email: z.email('Enter a valid email address') });

export const setPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((value) => value.password === value.confirm, {
    path: ['confirm'],
    message: 'The two passwords do not match',
  });

export type InviteMemberInput = z.output<typeof inviteMemberSchema>;
