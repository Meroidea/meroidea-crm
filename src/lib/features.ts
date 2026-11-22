import type { PermissionKey } from '@/lib/permissions/catalog';

/**
 * What a business's workspace can contain. The platform owner switches these on per business
 * when onboarding it (ADR-029); inside a workspace, roles and permissions then decide who may
 * use each one. A permission that belongs to a switched-off feature is treated as not granted,
 * so every existing page, menu item and action respects the switch without its own check.
 */
export const FEATURES = [
  {
    key: 'crm',
    label: 'Sales and customers',
    description:
      'Contacts, organizations, opportunities, the pipeline, partners, imports and reports.',
  },
  {
    key: 'reviews',
    label: 'Customer reviews',
    description: 'Review links and QR codes for customers, and an inbox for what they say.',
  },
  {
    key: 'helpdesk',
    label: 'Helpdesk',
    description:
      'Support tickets with a public contact form, replies, priorities and response targets.',
  },
  { key: 'tasks', label: 'Tasks', description: 'Follow-ups, My Day and the task list.' },
  { key: 'roster', label: 'Rosters', description: 'Weekly and fortnightly staff rosters.' },
  {
    key: 'timeoff',
    label: 'Time off',
    description: 'Leave requests, approvals and who is away.',
  },
  {
    key: 'timesheets',
    label: 'Timesheets',
    description: 'Clocking in and out, approving worked hours, and paying from them.',
  },
  {
    key: 'training',
    label: 'Training',
    description:
      'Courses and modules staff complete online, with quizzes, assigned by role, department or person, and everyone’s progress.',
  },
  {
    key: 'concerns',
    label: 'Questions & concerns',
    description:
      'Staff ask a manager or the admin about pay, hours, shifts, leave or anything else, and get an answer.',
  },
  {
    key: 'staff',
    label: 'Staff and hiring',
    description: 'Hiring, contracts, the staff directory, departments and employee profiles.',
  },
  {
    key: 'recruitment',
    label: 'Recruitment',
    description: 'Job openings, a public apply page and tracking applicants through to hiring.',
  },
  {
    key: 'projects',
    label: 'Projects',
    description: 'Projects, a task board, assignments and time logged on tasks.',
  },
  {
    key: 'productivity',
    label: 'Productivity reports',
    description: 'Hours rostered, clocked and logged, and tasks finished, per person.',
  },
  { key: 'inventory', label: 'Inventory', description: 'Stock items, levels and stock history.' },
  {
    key: 'purchasing',
    label: 'Suppliers and ordering',
    description: 'Suppliers, price lists and purchase orders.',
  },
  {
    key: 'files',
    label: 'Documents',
    description:
      'A shared document library with in-browser editing of Word, Excel, PowerPoint and PDF files.',
  },
  {
    key: 'expenses',
    label: 'Expenses',
    description: 'Staff expense claims with receipts, approval and reimbursement.',
  },
  { key: 'invoices', label: 'Invoices', description: 'Customer invoices and what is owed.' },
  {
    key: 'payroll',
    label: 'Payroll and payslips',
    description: 'Authorising rosters for pay and payslips for staff.',
  },
  {
    key: 'social',
    label: 'Social inbox',
    description:
      'Connect Facebook, Instagram, WhatsApp and TikTok business accounts and answer customers’ messages from one inbox.',
  },
  {
    key: 'knowledge_base',
    label: 'Knowledge base',
    description:
      'A public help portal of articles, with search and “Was this helpful?”, and links to articles sent from replies.',
  },
  {
    key: 'email_channel',
    label: 'Email inbox',
    description:
      'A shared email address whose messages arrive in the inbox, with replies sent from it, threaded, and linked to contacts and tickets.',
  },
  {
    key: 'books',
    label: 'Bookkeeping',
    description:
      'A chart of accounts and double-entry ledger: money in and out, journals, GST, and the Profit and Loss, Balance Sheet and Trial Balance, posted from invoices and payroll.',
  },
] as const;

export type FeatureKey = (typeof FEATURES)[number]['key'];
export const FEATURE_KEYS = FEATURES.map((feature) => feature.key) as FeatureKey[];

/** Which feature each permission family belongs to. Families not listed are always available. */
const FAMILY_FEATURE: Record<string, FeatureKey> = {
  contacts: 'crm',
  opportunities: 'crm',
  revenue: 'crm',
  activities: 'crm',
  documents: 'crm',
  partners: 'crm',
  organizations: 'crm',
  products: 'crm',
  reports: 'crm',
  tasks: 'tasks',
  rosters: 'roster',
  timeoff: 'timeoff',
  timesheets: 'timesheets',
  employees: 'staff',
  recruitment: 'recruitment',
  reviews: 'reviews',
  tickets: 'helpdesk',
  projects: 'projects',
  productivity: 'productivity',
  inventory: 'inventory',
  purchasing: 'purchasing',
  files: 'files',
  invoices: 'invoices',
  expenses: 'expenses',
  payroll: 'payroll',
  concerns: 'concerns',
  training: 'training',
  books: 'books',
  kb: 'knowledge_base',
};

/**
 * Groups of features of which any one switches a family on (ADR-070): the inbox's permissions
 * serve social media and email alike, so they count as granted while either is on, and each
 * account then follows its own channel's feature in the database. The group's name is what
 * `app.permission_feature` returns for the family, and `app.feature_enabled` understands it.
 */
export const FEATURE_GROUPS = {
  inbox: ['social', 'email_channel'],
} as const satisfies Record<string, readonly FeatureKey[]>;

const FAMILY_GROUP: Record<string, keyof typeof FEATURE_GROUPS> = { social: 'inbox' };

/**
 * The feature (or feature group) a permission needs, as the database names it, or null for
 * workspace basics such as settings and users.
 */
export function featureForPermission(
  permission: PermissionKey | string,
): FeatureKey | keyof typeof FEATURE_GROUPS | null {
  const family = permission.split('.')[0] ?? '';
  return FAMILY_FEATURE[family] ?? FAMILY_GROUP[family] ?? null;
}

/** Whether a permission is usable with these features switched on. */
export function permissionAvailable(
  permission: PermissionKey | string,
  features: readonly string[],
): boolean {
  const needed = featureForPermission(permission);
  if (!needed) return true;
  const group = (FEATURE_GROUPS as Record<string, readonly string[]>)[needed];
  return group ? group.some((feature) => features.includes(feature)) : features.includes(needed);
}

export const isFeatureKey = (value: string): value is FeatureKey =>
  (FEATURE_KEYS as string[]).includes(value);

/** Rostered, clocked-in workplaces share the same people features. */
const PEOPLE = [
  'roster',
  'timeoff',
  'timesheets',
  'staff',
  'recruitment',
  'concerns',
  'training',
] as const satisfies readonly FeatureKey[];

/** A starting set of features for each kind of business; the platform owner adjusts from here. */
export const BUSINESS_TYPES = [
  {
    key: 'restaurant',
    label: 'Restaurant or cafe',
    features: [
      ...PEOPLE,
      'inventory',
      'purchasing',
      'payroll',
      'expenses',
      'reviews',
      'helpdesk',
      'files',
    ],
  },
  {
    key: 'grocery',
    label: 'Grocery store',
    features: [
      ...PEOPLE,
      'inventory',
      'purchasing',
      'payroll',
      'expenses',
      'reviews',
      'helpdesk',
      'files',
    ],
  },
  {
    key: 'retail',
    label: 'Retail shop',
    features: [
      ...PEOPLE,
      'inventory',
      'purchasing',
      'invoices',
      'payroll',
      'expenses',
      'reviews',
      'helpdesk',
      'files',
    ],
  },
  {
    key: 'consultancy',
    label: 'Education or migration consultancy',
    features: [
      'crm',
      'tasks',
      'timeoff',
      'staff',
      'recruitment',
      'concerns',
      'training',
      'projects',
      'productivity',
      'invoices',
      'expenses',
      'reviews',
      'helpdesk',
      'files',
    ],
  },
  {
    key: 'services',
    label: 'Service business',
    features: [
      'crm',
      'tasks',
      ...PEOPLE,
      'projects',
      'productivity',
      'invoices',
      'payroll',
      'expenses',
      'reviews',
      'helpdesk',
      'files',
    ],
  },
  { key: 'other', label: 'Something else', features: [] },
] as const satisfies readonly { key: string; label: string; features: readonly FeatureKey[] }[];

export type BusinessTypeKey = (typeof BUSINESS_TYPES)[number]['key'];
