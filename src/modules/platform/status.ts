/** How each business status reads in the platform console, and the badge it gets. */
export const BUSINESS_STATUS: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  active: { label: 'Active', variant: 'outline' },
  // Businesses that signed themselves up before onboarding moved to the console (ADR-029).
  trialing: { label: 'Active (trial)', variant: 'outline' },
  awaiting_agreement: { label: 'Awaiting agreement', variant: 'secondary' },
  past_due: { label: 'Payment due', variant: 'destructive' },
  suspended: { label: 'Suspended', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
};

export const businessStatus = (status: string) =>
  BUSINESS_STATUS[status] ?? { label: status, variant: 'outline' as const };
