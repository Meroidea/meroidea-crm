/**
 * The permission catalog lives in code and is versioned with the features that check it
 * (ADR-004). The database stores only grants, in role_permissions.
 * Mirrors docs/permissions.md.
 */

export const PERMISSIONS = {
  'contacts.view': { scoped: true },
  'contacts.create': { scoped: false },
  'contacts.edit': { scoped: true },
  'contacts.delete': { scoped: true },
  'contacts.assign': { scoped: true },
  'contacts.view_sensitive': { scoped: false },
  'contacts.import': { scoped: false },
  'contacts.export': { scoped: false },
  /** Fold a duplicate into another record (moves its history, removes the duplicate). */
  'contacts.merge': { scoped: false },
  /** Erase a person's details on request (privacy law); history stays without them. */
  'contacts.anonymize': { scoped: false },
  'opportunities.view': { scoped: true },
  'opportunities.create': { scoped: false },
  'opportunities.edit': { scoped: true },
  'opportunities.delete': { scoped: true },
  'opportunities.assign': { scoped: true },
  'opportunities.export': { scoped: false },
  /** Approve moving an opportunity into a stage that needs approval. */
  'opportunities.approve': { scoped: false },
  'revenue.view': { scoped: true },
  'activities.create': { scoped: false },
  'activities.edit_any': { scoped: false },
  'tasks.view': { scoped: true },
  'tasks.manage': { scoped: true },
  'tasks.assign_others': { scoped: false },
  'documents.view': { scoped: false },
  'documents.upload': { scoped: false },
  'documents.download': { scoped: false },
  'documents.verify': { scoped: false },
  'documents.delete': { scoped: false },
  'partners.view': { scoped: false },
  'partners.manage': { scoped: false },
  'partners.view_commission': { scoped: false },
  'organizations.view': { scoped: false },
  'organizations.manage': { scoped: false },
  'products.manage': { scoped: false },
  'files.view': { scoped: false },
  'files.edit': { scoped: false },
  'files.manage': { scoped: false },
  'invoices.manage': { scoped: false },
  'payroll.manage': { scoped: false },
  'purchasing.manage': { scoped: false },
  'inventory.view': { scoped: false },
  'inventory.manage': { scoped: false },
  'employees.manage': { scoped: false },
  'recruitment.manage': { scoped: false },
  'employees.view_sensitive': { scoped: false },
  'rosters.view': { scoped: false },
  'rosters.view_all': { scoped: false },
  'rosters.manage': { scoped: false },
  'timeoff.request': { scoped: false },
  'timeoff.manage': { scoped: false },
  'timesheets.clock': { scoped: false },
  'timesheets.manage': { scoped: false },
  'expenses.submit': { scoped: false },
  'expenses.manage': { scoped: false },
  'concerns.raise': { scoped: false },
  'concerns.handle': { scoped: false },
  'concerns.handle_all': { scoped: false },
  'training.learn': { scoped: false },
  'training.view_all': { scoped: false },
  'training.manage': { scoped: false },
  'reviews.view': { scoped: false },
  'reviews.manage': { scoped: false },
  'tickets.work': { scoped: false },
  'tickets.manage': { scoped: false },
  'projects.view': { scoped: false },
  'projects.manage': { scoped: false },
  'productivity.view': { scoped: false },
  'reports.view': { scoped: true },
  'reports.export': { scoped: false },
  'settings.manage': { scoped: false },
  'users.manage': { scoped: false },
  'roles.manage': { scoped: false },
  'audit.view': { scoped: false },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export type Scope = 'own' | 'team' | 'all';
/** A grant is a scope for record permissions, or `true` for the unscoped ones. */
export type Grant = Scope | true;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isScoped(key: PermissionKey): boolean {
  return PERMISSIONS[key].scoped;
}

export type RoleDefinition = {
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  grants: Partial<Record<PermissionKey, Grant>>;
};

/**
 * Default roles applied when a workspace is provisioned: the business's Admin and its two staff
 * levels, Manager and Staff (ADR-048). The keys are what code and the database refer to and
 * never change; the names are what people see.
 */
export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    key: 'owner',
    name: 'Admin',
    description:
      'Runs the business: every feature switched on for it, settings, people, hiring and pay.',
    isSystem: true,
    grants: Object.fromEntries(
      PERMISSION_KEYS.map((key) => [key, isScoped(key) ? 'all' : true]),
    ) as Partial<Record<PermissionKey, Grant>>,
  },
  {
    key: 'manager',
    name: 'Manager',
    description:
      'Runs the team day to day: sees everyone’s roster, assigns tasks, approves time and leave. Not pay, hiring or settings.',
    isSystem: false,
    grants: {
      'contacts.view': 'team',
      'contacts.create': true,
      'contacts.edit': 'team',
      'contacts.delete': 'team',
      'contacts.assign': 'team',
      'contacts.view_sensitive': true,
      'contacts.import': true,
      'contacts.export': true,
      'opportunities.view': 'team',
      'opportunities.create': true,
      'opportunities.edit': 'team',
      'opportunities.delete': 'team',
      'opportunities.assign': 'team',
      'opportunities.export': true,
      'opportunities.approve': true,
      'contacts.merge': true,
      'revenue.view': 'team',
      'activities.create': true,
      'tasks.view': 'team',
      'tasks.manage': 'team',
      'tasks.assign_others': true,
      'documents.view': true,
      'documents.upload': true,
      'documents.download': true,
      'documents.verify': true,
      'partners.view': true,
      'partners.view_commission': true,
      'organizations.view': true,
      'organizations.manage': true,
      'files.view': true,
      'files.edit': true,
      'files.manage': true,
      'inventory.view': true,
      'inventory.manage': true,
      'rosters.view': true,
      'rosters.view_all': true,
      'recruitment.manage': true,
      'reviews.view': true,
      'reviews.manage': true,
      'tickets.work': true,
      'tickets.manage': true,
      'projects.view': true,
      'projects.manage': true,
      'productivity.view': true,
      'timeoff.request': true,
      'timeoff.manage': true,
      'timesheets.clock': true,
      'timesheets.manage': true,
      'expenses.submit': true,
      'expenses.manage': true,
      'concerns.raise': true,
      'concerns.handle': true,
      'training.learn': true,
      'training.view_all': true,
      'reports.view': 'team',
      'reports.export': true,
    },
  },
  {
    key: 'member',
    name: 'Staff',
    description:
      'Their own roster, payslips, time, leave, tasks and expenses, and the records they work on.',
    isSystem: false,
    grants: {
      'contacts.view': 'own',
      'contacts.create': true,
      'contacts.edit': 'own',
      'contacts.view_sensitive': true,
      'opportunities.view': 'own',
      'opportunities.create': true,
      'opportunities.edit': 'own',
      'revenue.view': 'own',
      'activities.create': true,
      'tasks.view': 'own',
      'tasks.manage': 'own',
      'documents.view': true,
      'documents.upload': true,
      'documents.download': true,
      'partners.view': true,
      'organizations.view': true,
      'files.view': true,
      'files.edit': true,
      'inventory.view': true,
      'rosters.view': true,
      'timeoff.request': true,
      'timesheets.clock': true,
      'expenses.submit': true,
      'concerns.raise': true,
      'training.learn': true,
      'projects.view': true,
      'tickets.work': true,
      'reports.view': 'own',
    },
  },
];
