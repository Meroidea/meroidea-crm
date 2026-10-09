import {
  LifeBuoy,
  Star,
  FolderKanban,
  Gauge,
  Briefcase,
  BarChart3,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Files,
  Banknote,
  Handshake,
  IdCard,
  Palmtree,
  Timer,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  Settings,
  Receipt,
  ReceiptText,
  Target,
  Truck,
  Upload,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import type { FeatureKey } from '@/lib/features';
import type { PermissionKey } from '@/lib/permissions/catalog';
import type { LabelKey, Labels } from '@/lib/tenant/labels';

export type NavItem = {
  href: string;
  icon: LucideIcon;
  /** A renamable object uses the tenant's plural label; everything else has a fixed title. */
  label: { labelKey: LabelKey } | { title: string };
  /** Hidden unless the signed-in person holds this permission. */
  permission?: PermissionKey;
  /** Hidden unless this feature is switched on for the business; for items with no permission. */
  feature?: FeatureKey;
  /** False until the milestone that builds the page ships; rendered disabled, never as a dead link. */
  available: boolean;
};

export type NavGroup = { title: string; items: NavItem[] };

export const NAVIGATION: NavGroup[] = [
  {
    title: 'Workspace',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: { title: 'Dashboard' }, available: true },
      {
        href: '/my-day',
        icon: CalendarCheck,
        label: { title: 'My Day' },
        permission: 'tasks.view',
        available: true,
      },
      {
        href: '/documents',
        icon: Files,
        label: { title: 'Documents' },
        permission: 'files.view',
        available: true,
      },
      {
        href: '/payslips',
        icon: Wallet,
        label: { title: 'My payslips' },
        feature: 'payroll',
        available: true,
      },
      {
        href: '/projects',
        icon: FolderKanban,
        label: { title: 'Projects' },
        permission: 'projects.view',
        available: true,
      },
      {
        href: '/pipeline',
        icon: KanbanSquare,
        label: { title: 'Pipeline' },
        permission: 'opportunities.view',
        available: true,
      },
    ],
  },
  {
    title: 'Records',
    items: [
      {
        href: '/contacts',
        icon: Users,
        label: { labelKey: 'contact' },
        permission: 'contacts.view',
        available: true,
      },
      {
        href: '/organizations',
        icon: Building2,
        label: { labelKey: 'organization' },
        permission: 'organizations.view',
        available: true,
      },
      {
        href: '/opportunities',
        icon: Target,
        label: { labelKey: 'opportunity' },
        permission: 'opportunities.view',
        available: true,
      },
      {
        href: '/partners',
        icon: Handshake,
        label: { labelKey: 'partner' },
        permission: 'partners.view',
        available: true,
      },
      {
        href: '/tasks',
        icon: ListChecks,
        label: { title: 'Tasks' },
        permission: 'tasks.view',
        available: true,
      },
      {
        href: '/reviews',
        icon: Star,
        label: { title: 'Reviews' },
        permission: 'reviews.view',
        available: true,
      },
      {
        href: '/helpdesk',
        icon: LifeBuoy,
        label: { title: 'Helpdesk' },
        permission: 'tickets.work',
        available: true,
      },
    ],
  },
  {
    title: 'Team',
    items: [
      {
        href: '/roster',
        icon: CalendarDays,
        label: { title: 'Roster' },
        permission: 'rosters.view',
        available: true,
      },
      {
        href: '/timesheets',
        icon: Timer,
        label: { title: 'Timesheets' },
        permission: 'timesheets.clock',
        available: true,
      },
      {
        href: '/time-off',
        icon: Palmtree,
        label: { title: 'Time off' },
        permission: 'timeoff.request',
        available: true,
      },
      {
        href: '/staff',
        icon: IdCard,
        label: { title: 'Staff' },
        permission: 'employees.manage',
        available: true,
      },
      {
        href: '/hiring',
        icon: UserPlus,
        label: { title: 'Hiring' },
        permission: 'employees.manage',
        available: true,
      },
      {
        href: '/recruitment',
        icon: Briefcase,
        label: { title: 'Recruitment' },
        permission: 'recruitment.manage',
        available: true,
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        href: '/inventory',
        icon: Boxes,
        label: { title: 'Inventory' },
        permission: 'inventory.view',
        available: true,
      },
      {
        href: '/suppliers',
        icon: Truck,
        label: { title: 'Suppliers' },
        permission: 'purchasing.manage',
        available: true,
      },
      {
        href: '/orders',
        icon: ClipboardList,
        label: { title: 'Orders' },
        permission: 'purchasing.manage',
        available: true,
      },
    ],
  },
  {
    title: 'Finance',
    items: [
      {
        href: '/expenses',
        icon: Receipt,
        label: { title: 'Expenses' },
        permission: 'expenses.submit',
        available: true,
      },
      {
        href: '/invoices',
        icon: ReceiptText,
        label: { title: 'Invoices' },
        permission: 'invoices.manage',
        available: true,
      },
      {
        href: '/payroll',
        icon: Banknote,
        label: { title: 'Payroll' },
        permission: 'payroll.manage',
        available: true,
      },
    ],
  },
  {
    title: 'Insight',
    items: [
      {
        href: '/reports',
        icon: BarChart3,
        label: { title: 'Reports' },
        permission: 'reports.view',
        available: true,
      },
      {
        href: '/productivity',
        icon: Gauge,
        label: { title: 'Productivity' },
        permission: 'productivity.view',
        available: true,
      },
      {
        href: '/imports',
        icon: Upload,
        label: { title: 'Imports' },
        permission: 'contacts.import',
        available: true,
      },
    ],
  },
  {
    title: 'Admin',
    items: [
      {
        href: '/settings',
        icon: Settings,
        label: { title: 'Settings' },
        permission: 'settings.manage',
        available: true,
      },
    ],
  },
];

export function navItemTitle(item: NavItem, labels: Labels): string {
  return 'labelKey' in item.label ? labels[item.label.labelKey].plural : item.label.title;
}
