import { z } from 'zod';

/**
 * How a business runs its leads (docs/leads.md §Configuration). Kept in `tenants.settings.crm`
 * and edited by its admin; anything missing or malformed falls back to these defaults, so an
 * older or partly-saved setting never breaks a page.
 */

/** Contact fields that can count towards completeness or be required for a handover. */
export const LEAD_FIELD_LABELS = {
  email: 'Email',
  phone: 'Phone',
  jobTitle: 'Job title',
  companyName: 'Company',
  companyWebsite: 'Company website',
  companySize: 'Company size',
  industry: 'Industry',
  linkedinUrl: 'LinkedIn',
  country: 'Country',
  city: 'City',
  language: 'Language',
  interest: 'Interested in',
} as const;

export type LeadFieldKey = keyof typeof LEAD_FIELD_LABELS;
export const LEAD_FIELD_KEYS = Object.keys(LEAD_FIELD_LABELS) as LeadFieldKey[];

/** A built-in field, or a custom contact field as `custom:<key>`. */
const fieldRef = z
  .string()
  .regex(/^(custom:[a-z][a-z0-9_]{0,39}|[a-zA-Z]+)$/)
  .refine(
    (value) => value.startsWith('custom:') || (LEAD_FIELD_KEYS as string[]).includes(value),
    'Unknown field',
  );

const list = (fallback: string[]) =>
  z.array(z.string().trim().min(1).max(60)).max(30).catch(fallback);

export const WORKFLOWS = ['b2b', 'b2c', 'both'] as const;
export type Workflow = (typeof WORKFLOWS)[number];

export const WORKFLOW_LABELS: Record<Workflow, string> = {
  b2b: 'Selling to businesses (B2B)',
  b2c: 'Selling to individuals (B2C)',
  both: 'Both, side by side',
};

export const crmSettingsSchema = z.object({
  workflow: z.enum(WORKFLOWS).catch('both'),
  /** B2C leads go through the SDR/BDR qualification and handover step first. */
  b2cQualificationStep: z.boolean().catch(false),
  /** Converting a B2C lead needs someone's approval first. */
  b2cApproval: z.boolean().catch(false),
  sla: z
    .object({
      /** Flag a lead nobody has been given after this many hours. */
      unassignedHours: z.number().int().min(1).max(720).catch(24),
      /** First call or email within this many hours of the lead arriving. */
      firstContactHours: z.number().int().min(1).max(720).catch(24),
      /** Business days the person a lead is handed to has to accept or reject it. */
      acceptanceBusinessDays: z.number().int().min(1).max(30).catch(2),
      /** A lead with no activity for this many days is stale. */
      staleLeadDays: z.number().int().min(1).max(365).catch(7),
    })
    .catch({
      unassignedHours: 24,
      firstContactHours: 24,
      acceptanceBusinessDays: 2,
      staleLeadDays: 7,
    }),
  completenessFields: z
    .array(fieldRef)
    .max(40)
    .catch(['email', 'phone', 'jobTitle', 'companyName', 'industry', 'companySize', 'country']),
  handoverRequiredFields: z.array(fieldRef).max(40).catch(['companyName', 'jobTitle', 'interest']),
  callOutcomes: list([
    'Answered – interested',
    'Answered – not interested',
    'Left voicemail',
    'No answer',
    'Wrong number',
    'Call back later',
  ]),
  contactRoles: list(['Decision maker', 'Influencer', 'User', 'Other']),
  householdRelationships: list(['Parent', 'Child', 'Partner', 'Sibling', 'Guardian', 'Other']),
});

export type CrmSettings = z.output<typeof crmSettingsSchema>;

export function readCrmSettings(settings: Record<string, unknown>): CrmSettings {
  const parsed = crmSettingsSchema.safeParse(settings.crm ?? {});
  return parsed.success ? parsed.data : crmSettingsSchema.parse({});
}

/** Which workflows a new lead may follow under this business's settings. */
export function allowedLeadTypes(settings: CrmSettings): ('b2b' | 'b2c')[] {
  return settings.workflow === 'both' ? ['b2b', 'b2c'] : [settings.workflow];
}

/** Whether leads of this type go through the SDR/BDR handover before conversion. */
export function usesHandover(settings: CrmSettings, leadType: 'b2b' | 'b2c'): boolean {
  return leadType === 'b2b' || settings.b2cQualificationStep;
}

export function fieldRefLabel(ref: string, customLabels: Record<string, string> = {}): string {
  if (ref.startsWith('custom:')) return customLabels[ref.slice(7)] ?? ref.slice(7);
  return LEAD_FIELD_LABELS[ref as LeadFieldKey] ?? ref;
}

/** The value of a built-in or custom field on a contact, as text; empty means missing. */
export function fieldRefValue(
  ref: string,
  contact: Record<string, unknown> & { customFields?: unknown },
): string {
  const raw = ref.startsWith('custom:')
    ? ((contact.customFields ?? {}) as Record<string, unknown>)[ref.slice(7)]
    : contact[ref];
  if (raw === null || raw === undefined || raw === false) return '';
  if (Array.isArray(raw)) return raw.join(', ');
  return String(raw).trim();
}

/** Share of the chosen fields that are filled, 0–100 (the data completeness indicator). */
export function completeness(
  fields: string[],
  contact: Record<string, unknown> & { customFields?: unknown },
): number {
  if (fields.length === 0) return 100;
  const filled = fields.filter((ref) => fieldRefValue(ref, contact) !== '').length;
  return Math.round((filled / fields.length) * 100);
}

/** Adds business days (Mon–Fri) to a moment, in the business's own timezone. */
export function addBusinessDays(from: Date, days: number, timeZone: string): Date {
  const weekday = (date: Date) =>
    new Intl.DateTimeFormat('en-AU', { weekday: 'short', timeZone }).format(date);
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setTime(result.getTime() + 24 * 60 * 60 * 1000);
    const day = weekday(result);
    if (day !== 'Sat' && day !== 'Sun') added += 1;
  }
  return result;
}
