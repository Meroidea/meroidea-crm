import { z } from 'zod';

export const workspaceSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  timezone: z
    .string()
    .trim()
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Use a timezone like Australia/Sydney'),
  currency: z
    .string()
    .trim()
    .length(3, 'Use a 3-letter currency code')
    .transform((value) => value.toUpperCase()),
  country: z
    .union([z.literal(''), z.string().trim().length(2, 'Use a 2-letter country code')])
    .optional()
    .transform((value) => (value ? value.toUpperCase() : null)),
});

export const STAGE_COLORS = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'info',
] as const;

export const updateStageSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, 'Enter a name').max(40),
  probability: z.coerce.number().int().min(0).max(100),
  staleAfterDays: z
    .union([z.literal(''), z.coerce.number().int().min(1).max(365)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  color: z.enum(STAGE_COLORS).optional(),
});

export const addStageSchema = z.object({ name: z.string().trim().min(1, 'Enter a name').max(40) });
export const moveStagePositionSchema = z.object({
  id: z.uuid(),
  direction: z.enum(['up', 'down']),
});
export const toggleSchema = z.object({ id: z.uuid(), isActive: z.boolean() });
export const nameSchema = z.object({ name: z.string().trim().min(1, 'Enter a name').max(60) });
export const renameSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(60) });
export const memberRoleSchema = z.object({ userId: z.uuid(), roleId: z.uuid() });
