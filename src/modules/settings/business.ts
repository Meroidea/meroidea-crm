import { z } from 'zod';

/**
 * The business's own details as they are printed on what it issues, payslips first: the name it
 * trades or is registered under, its business number, and how to reach it. Kept with the
 * workspace's settings and copied onto each payslip when it is made, so a later change never
 * rewrites a payslip already given to someone.
 */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const businessDetailsSchema = z.object({
  /** The registered or trading name, when it differs from the workspace's name. */
  legalName: text(120),
  /** ABN in Australia; whatever business number applies elsewhere. Spaces are allowed. */
  businessNumber: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9A-Za-z -]*$/, 'Use letters, numbers and spaces only')
    .nullish()
    .transform((value) => value || null),
  address: text(240),
  phone: text(40),
  email: z
    .union([z.literal(''), z.email('Use an email address')])
    .nullish()
    .transform((value) => value || null),
  website: text(120),
  /** The person or team staff should ask about their pay. */
  payrollContact: text(80),
});

export type BusinessDetails = z.output<typeof businessDetailsSchema>;
export type BusinessDetailsValues = { [Key in keyof BusinessDetails]: string };

const EMPTY: BusinessDetails = {
  legalName: null,
  businessNumber: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  payrollContact: null,
};

/** The saved details, tolerant of settings written before a field existed. */
export function readBusinessDetails(settings: Record<string, unknown>): BusinessDetails {
  const parsed = businessDetailsSchema.safeParse(settings.business ?? {});
  return parsed.success ? parsed.data : EMPTY;
}

/** What a payslip keeps about the employer: the details as they stood when it was made. */
export type EmployerSnapshot = BusinessDetails & { name: string };

export function employerSnapshot(tenant: {
  name: string;
  settings: Record<string, unknown>;
}): EmployerSnapshot {
  const details = readBusinessDetails(tenant.settings);
  return { ...details, name: details.legalName ?? tenant.name };
}
