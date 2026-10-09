import { z } from 'zod';

const isoDate = z.iso.date('Use a valid date');
const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);
const optionalId = z
  .union([z.literal(''), z.null(), z.uuid()])
  .optional()
  .transform((value) => value || null);

export const STAFF_VIEWS = ['current', 'active', 'pending', 'ended', 'all'] as const;
export type StaffView = (typeof STAFF_VIEWS)[number];

export const staffFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  /** A department id, or "none" for people not in one. */
  department: z
    .union([z.literal('none'), z.uuid()])
    .optional()
    .catch(undefined),
  view: z.enum(STAFF_VIEWS).optional().catch(undefined),
});

export const PROFILE_SECTIONS = ['personal', 'pay', 'contract', 'payroll'] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
export const profileParamsSchema = z.object({
  section: z.enum(PROFILE_SECTIONS).optional().catch(undefined),
});

export const createDepartmentSchema = z.object({ name: required(60, 'Name the department') });
export const renameDepartmentSchema = z.object({
  id: z.uuid(),
  name: required(60, 'Name the department'),
});
export const departmentIdSchema = z.object({ id: z.uuid() });

export const assignDepartmentSchema = z.object({ employeeId: z.uuid(), departmentId: optionalId });

export const updateProfileSchema = z.object({
  id: z.uuid(),
  firstName: required(80, 'Enter their first name'),
  lastName: required(80, 'Enter their last name'),
  preferredName: optionalText(120),
  email: z.email('Enter a valid email address').max(200),
  phone: optionalText(40),
  dateOfBirth: z
    .union([z.literal(''), z.null(), isoDate])
    .optional()
    .transform((value) => value || null)
    .refine((value) => !value || value <= new Date().toISOString().slice(0, 10), {
      message: 'A date of birth cannot be in the future',
    }),
  address: optionalText(300),
  departmentId: optionalId,
  emergencyContactName: optionalText(120),
  emergencyContactRelationship: optionalText(60),
  emergencyContactPhone: optionalText(40),
});

export const linkLoginSchema = z.object({ employeeId: z.uuid(), userId: optionalId });

export const endEmploymentSchema = z.object({
  id: z.uuid(),
  endedOn: isoDate,
  reason: optionalText(300),
});

export type StaffFilters = z.output<typeof staffFiltersSchema>;
export type ProfileFormValues = z.input<typeof updateProfileSchema>;
export type UpdateProfileInput = z.output<typeof updateProfileSchema>;
export type EndEmploymentInput = z.output<typeof endEmploymentSchema>;
