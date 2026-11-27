import {
  BookOpen,
  LifeBuoy,
  Star,
  FolderKanban,
  Gauge,
  GraduationCap,
  Inbox,
  Briefcase,
  BarChart3,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Files,
  Banknote,
  ChartPie,
  CircleDollarSign,
  Handshake,
  HeartHandshake,
  Home,
  Package,
  TrendingUp,
  UsersRound,
  IdCard,
  MessageSquareWarning,
  Palmtree,
  Timer,
  KanbanSquare,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Mail,
  MessageSquare,
  MessagesSquare,
  Settings,
  Receipt,
  ScrollText,
  Send,
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
  /**
   * Hidden unless this feature is switched on for the business, or, given several, any of them.
   * A permission alone is not enough where it spans features (the inbox's `social.view` covers
   * social media, email and live chat).
   */
  feature?: FeatureKey | FeatureKey[];
  /** False until the milestone that builds the page ships; rendered disabled, never as a dead link. */
  available: boolean;
};

export type NavGroup = {
  title: string;
  icon: LucideIcon;
  /** Shown as plain links, always in view; every other group opens downwards from its title. */
  pinned?: boolean;
  items: NavItem[];
};

export const NAVIGATION: NavGroup[] = [
  {
    title: 'Home',
    icon: Home,
    pinned: true,
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: { title: 'Dashboard' }, available: true },
      {
        href: '/my-day',
        icon: CalendarCheck,
        label: { title: 'My Day' },
        permission: 'tasks.view',
        available: true,
      },
    ],
  },
  {
    title: 'Sales',
    icon: TrendingUp,
    items: [
      {
        href: '/pipeline',
        icon: KanbanSquare,
        label: { title: 'Pipeline' },
        permission: 'opportunities.view',
        available: true,
      },
      {
        href: '/leads',
        icon: Inbox,
        label: { title: 'Leads' },
        permission: 'contacts.view',
        available: true,
      },
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
    ],
  },
  {
    // Three areas (ADR-073), named Communication since ADR-088: customers' messages on social media
    // and website chat, customer email, and campaigns, which are planned next.
    title: 'Communication',
    icon: MessageSquare,
    items: [
      {
        href: '/social',
        icon: MessagesSquare,
        label: { title: 'Social inbox' },
        permission: 'social.view',
        feature: ['social', 'live_chat'],
        available: true,
      },
      {
        href: '/email',
        icon: Mail,
        label: { title: 'Email' },
        permission: 'social.view',
        feature: 'email_channel',
        available: true,
      },
      {
        href: '/campaigns',
        icon: Send,
        label: { title: 'Marketing campaigns' },
        permission: 'social.view',
        available: false,
      },
    ],
  },
  {
    title: 'Work',
    icon: FolderKanban,
    items: [
      {
        href: '/projects',
        icon: FolderKanban,
        label: { title: 'Projects' },
        permission: 'projects.view',
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
        href: '/documents',
        icon: Files,
        label: { title: 'Documents' },
        permission: 'files.view',
        available: true,
      },
    ],
  },
  {
    title: 'Customer care',
    icon: HeartHandshake,
    items: [
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
      {
        href: '/kb',
        icon: BookOpen,
        label: { title: 'Knowledge base' },
        permission: 'kb.manage',
        available: true,
      },
    ],
  },
  {
    title: 'People',
    icon: UsersRound,
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
        href: '/training',
        icon: GraduationCap,
        label: { title: 'Training' },
        permission: 'training.learn',
        available: true,
      },
      {
        href: '/concerns',
        icon: MessageSquareWarning,
        label: { title: 'Questions & concerns' },
        permission: 'concerns.raise',
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
    title: 'Stock',
    icon: Package,
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
    icon: CircleDollarSign,
    items: [
      {
        href: '/payslips',
        icon: Wallet,
        label: { title: 'My payslips' },
        feature: 'payroll',
        available: true,
      },
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
      {
        href: '/books',
        icon: Landmark,
        label: { title: 'Books' },
        permission: 'books.view',
        available: true,
      },
    ],
  },
  {
    title: 'Insight',
    icon: ChartPie,
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
    icon: Settings,
    pinned: true,
    items: [
      {
        href: '/settings',
        icon: Settings,
        label: { title: 'Settings' },
        permission: 'settings.manage',
        available: true,
      },
      {
        href: '/audit',
        icon: ScrollText,
        label: { title: 'Audit log' },
        permission: 'audit.view',
        available: true,
      },
    ],
  },
];

export function navItemTitle(item: NavItem, labels: Labels): string {
  return 'labelKey' in item.label ? labels[item.label.labelKey].plural : item.label.title;
}

/** Whether a navigation item's feature (or any of its features) is switched on. */
export function navFeatureOn(item: NavItem, features: readonly string[]): boolean {
  if (!item.feature) return true;
  const wanted = Array.isArray(item.feature) ? item.feature : [item.feature];
  return wanted.some((feature) => features.includes(feature));
}
