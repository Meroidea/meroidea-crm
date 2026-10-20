/**
 * The statuses in which a business is open: its people can work in it, its public forms take
 * submissions and it gets alerts. Anything else — suspended, cancelled, waiting for its admin to
 * accept the service agreement, or a status added later — is closed. Listing the open ones
 * rather than the closed ones means a new status starts closed until someone decides otherwise.
 */
export const OPEN_TENANT_STATUSES = ['trialing', 'active', 'past_due'] as const;

export function isTenantOpen(status: string): boolean {
  return (OPEN_TENANT_STATUSES as readonly string[]).includes(status);
}
