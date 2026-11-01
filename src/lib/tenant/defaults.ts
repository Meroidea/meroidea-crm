/**
 * Industry-neutral starting configuration for every new workspace. Industry templates add to
 * or rename these; they never live in core code (.claude/CLAUDE.md rule 3).
 * Keep in step with the backfill in drizzle/0005_crm_rls_search_duplicates.sql.
 */
export const DEFAULT_LEAD_SOURCES = [
  { name: 'Manual entry', type: 'manual', subSources: [] },
  {
    name: 'Marketing',
    type: 'other',
    subSources: [
      'Marketing event – workshop',
      'Marketing event – expo or seminar',
      'Digital campaign – Meta ads',
      'Digital campaign – Google ads',
      'Email campaign',
    ],
  },
  {
    name: 'Data upload',
    type: 'import',
    subSources: ['LinkedIn', 'Instagram', 'Purchased or partner list', 'Other import'],
  },
  {
    name: 'Website',
    type: 'web_form',
    subSources: ['Contact us form', 'Feedback form', 'Enquiry or landing page form', 'Live chat'],
  },
  {
    name: 'Referral',
    type: 'referral',
    subSources: ['Existing customer', 'Partner or agent', 'Staff referral'],
  },
  { name: 'Walk-in', type: 'walk_in', subSources: ['Walk-in', 'Inbound call'] },
  { name: 'Partner', type: 'partner', subSources: [] },
  { name: 'Social media', type: 'social', subSources: [] },
  { name: 'Import', type: 'import', subSources: [] },
  { name: 'Other', type: 'other', subSources: [] },
] as const;

/**
 * Lead statuses (docs/leads.md). The kind drives behaviour; names are the business's to change.
 * Keep in step with the backfill in drizzle/0056_lead_management_rls.sql.
 */
export const DEFAULT_LEAD_STATUSES = [
  {
    name: 'New',
    kind: 'new',
    leadType: null,
    requiresReason: false,
    isSystem: true,
    color: 'chart-2',
  },
  {
    name: 'Working',
    kind: 'working',
    leadType: 'b2b',
    requiresReason: false,
    isSystem: false,
    color: 'chart-3',
  },
  {
    name: 'Contacted',
    kind: 'working',
    leadType: null,
    requiresReason: false,
    isSystem: false,
    color: 'chart-3',
  },
  {
    name: 'Engaged',
    kind: 'working',
    leadType: null,
    requiresReason: false,
    isSystem: false,
    color: 'info',
  },
  {
    name: 'Meeting agreed',
    kind: 'working',
    leadType: 'b2b',
    requiresReason: false,
    isSystem: false,
    color: 'chart-4',
  },
  {
    name: 'Consultation booked',
    kind: 'working',
    leadType: 'b2c',
    requiresReason: false,
    isSystem: false,
    color: 'chart-4',
  },
  {
    name: 'Pending acceptance',
    kind: 'pending_acceptance',
    leadType: null,
    requiresReason: false,
    isSystem: true,
    color: 'chart-5',
  },
  {
    name: 'Returned',
    kind: 'returned',
    leadType: null,
    requiresReason: false,
    isSystem: true,
    color: 'chart-1',
  },
  {
    name: 'Accepted',
    kind: 'converted',
    leadType: 'b2b',
    requiresReason: false,
    isSystem: true,
    color: 'positive',
  },
  {
    name: 'Qualified',
    kind: 'converted',
    leadType: 'b2c',
    requiresReason: false,
    isSystem: true,
    color: 'positive',
  },
  {
    name: 'Not interested',
    kind: 'closed',
    leadType: null,
    requiresReason: true,
    isSystem: false,
    color: 'primary',
  },
  {
    name: 'Unresponsive',
    kind: 'closed',
    leadType: null,
    requiresReason: false,
    isSystem: false,
    color: 'primary',
  },
  {
    name: 'Disqualified',
    kind: 'closed',
    leadType: null,
    requiresReason: true,
    isSystem: false,
    color: 'destructive',
  },
] as const;

export const DEFAULT_LEAD_REASONS = {
  disqualify: [
    'Bad or incomplete data',
    'Not a fit',
    'No budget',
    'No longer interested',
    'Duplicate',
    'Other',
  ],
  reject: ['Not a decision maker', 'No budget', 'Wrong fit', 'Insufficient information', 'Other'],
} as const;

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

/** A new item pipeline's starting stages, renamed to fit afterwards (ADR-018). */
export const DEFAULT_ITEM_PIPELINE = {
  name: 'Items',
  stages: [
    { name: 'Preparing', category: 'open', probability: 20, color: 'chart-2', staleAfterDays: 7 },
    { name: 'Submitted', category: 'open', probability: 40, color: 'chart-3', staleAfterDays: 14 },
    { name: 'Offered', category: 'open', probability: 70, color: 'info', staleAfterDays: 14 },
    {
      name: 'Accepted',
      category: 'won',
      probability: 100,
      color: 'positive',
      staleAfterDays: null,
    },
    {
      name: 'Declined',
      category: 'lost',
      probability: 0,
      color: 'destructive',
      staleAfterDays: null,
    },
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
