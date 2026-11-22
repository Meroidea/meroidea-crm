import { z } from 'zod';

/**
 * An account's inbox settings (`social_accounts.settings`, ADR-068). The database accepts only
 * these keys (`app.social_set_account_settings`); anything unreadable falls back to the defaults.
 */
export const accountSettingsSchema = z.object({
  /** Make a new lead for someone who writes and matches no contact. Off until an admin opts in. */
  createLeadForUnknown: z.boolean().default(false),
  /** The lead source new leads from this account get. */
  leadSourceId: z.uuid().nullable().default(null),
  /** Open a helpdesk ticket for each conversation that has none (ADR-069). Off until chosen. */
  autoTicket: z.boolean().default(false),
  /** The priority such tickets start at. */
  autoTicketPriority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

export type AccountSettings = z.output<typeof accountSettingsSchema>;

export function readAccountSettings(value: unknown): AccountSettings {
  const parsed = accountSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : accountSettingsSchema.parse({});
}
