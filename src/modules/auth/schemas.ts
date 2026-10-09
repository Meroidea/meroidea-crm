import { z } from 'zod';

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, 'Tell us your name').max(80),
  companyName: z.string().trim().min(2, 'Tell us your company name').max(80),
  email: z.email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(72, 'Passwords can be at most 72 characters'),
});

export const signInSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
