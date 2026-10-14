import { z } from 'zod';

/**
 * How to reach the business, as printed on what it issues, payslips first. Its admin keeps these
 * up to date in Settings. Who the business is (its name, legal name and business number) is not
 * here: the platform owner records that when onboarding it, and only the platform console
 * changes it (ADR-047). Kept with the workspace's settings and copied onto each payslip when it
 * is made, so a later change never rewrites a payslip already given to someone.
 */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const businessDetailsSchema = z.object({
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
export type EmployerSnapshot = BusinessDetails & {
  name: string;
  legalName: string | null;
  businessNumber: string | null;
};

export function employerSnapshot(tenant: {
  name: string;
  legalName: string | null;
  businessNumber: string | null;
  settings: Record<string, unknown>;
}): EmployerSnapshot {
  return {
    ...readBusinessDetails(tenant.settings),
    legalName: tenant.legalName,
    businessNumber: tenant.businessNumber,
    name: tenant.legalName ?? tenant.name,
  };
}
