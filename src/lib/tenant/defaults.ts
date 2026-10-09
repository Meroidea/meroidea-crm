/**
 * Industry-neutral starting configuration for every new workspace. Industry templates add to
 * or rename these; they never live in core code (.claude/CLAUDE.md rule 3).
 * Keep in step with the backfill in drizzle/0005_crm_rls_search_duplicates.sql.
 */
export const DEFAULT_LEAD_SOURCES = [
  { name: 'Manual entry', type: 'manual' },
  { name: 'Website', type: 'web_form' },
  { name: 'Referral', type: 'referral' },
  { name: 'Walk-in', type: 'walk_in' },
  { name: 'Partner', type: 'partner' },
  { name: 'Social media', type: 'social' },
  { name: 'Import', type: 'import' },
] as const;

/** Keep in step with the backfill in drizzle/0008_sales_work_rls_defaults.sql. */
export const DEFAULT_PIPELINE = {
  name: 'Sales',
  stages: [
    { name: 'New', category: 'open', probability: 10, color: 'chart-2', staleAfterDays: 3 },
    { name: 'Contacted', category: 'open', probability: 20, color: 'chart-3', staleAfterDays: 7 },
    { name: 'Qualified', category: 'open', probability: 40, color: 'info', staleAfterDays: 7 },
    { name: 'Proposal', category: 'open', probability: 60, color: 'chart-4', staleAfterDays: 10 },
    {
      name: 'Negotiation',
      category: 'open',
      probability: 80,
      color: 'chart-1',
      staleAfterDays: 10,
    },
    { name: 'Won', category: 'won', probability: 100, color: 'positive', staleAfterDays: null },
    { name: 'Lost', category: 'lost', probability: 0, color: 'destructive', staleAfterDays: null },
  ],
} as const;

export const DEFAULT_LOST_REASONS = [
  'Price',
  'Chose a competitor',
  'No response',
  'Not a fit',
  'Timing',
  'Other',
] as const;
