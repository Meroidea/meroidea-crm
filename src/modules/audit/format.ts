import { fieldWords } from '@/lib/audit-diff';
import type { Labels } from '@/lib/tenant/labels';

/** "stage_approval" → "Stage approval". */
function sentence(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

const ACTION_WORDS: Record<string, string> = {
  create: 'Created',
  update: 'Changed',
  delete: 'Deleted',
  restore: 'Restored',
  stage_change: 'Moved stage',
  owner_change: 'Changed owner',
  permission_change: 'Changed access',
  accept: 'Accepted',
  decline: 'Declined',
  export: 'Exported',
  import: 'Imported',
  download: 'Downloaded',
  view_sensitive: 'Revealed sensitive details',
  login: 'Signed in',
};

export function actionLabel(action: string): string {
  return ACTION_WORDS[action] ?? sentence(action);
}

/** Record types a business can rename take the business's own words (rules/architecture.md). */
const RENAMABLE: Record<string, keyof Labels> = {
  contact: 'contact',
  organization: 'organization',
  opportunity: 'opportunity',
  opportunity_item: 'opportunityItem',
  partner: 'partner',
  product: 'product',
};

const TYPE_WORDS: Record<string, string> = {
  tenant: 'Workspace',
  membership: 'Person’s access',
  user: 'Profile',
  books: 'Books setup',
  books_report: 'Books report',
  library_document: 'Document',
  employee_payroll_details: 'Tax, bank and super details',
  time_entry: 'Time record',
  task_time_log: 'Time on a task',
  ledger_entry: 'Ledger entry',
  ledger_account: 'Account',
  ledger_tax_code: 'Tax code',
  tenant_agreement: 'Service agreement',
  job_applicant: 'Applicant',
  workforce_settings: 'Workforce settings',
};

export function entityLabel(type: string, labels: Labels): string {
  const renamable = RENAMABLE[type];
  if (renamable) return labels[renamable].singular;
  return TYPE_WORDS[type] ?? sentence(type);
}

const ACTOR_WORDS: Record<string, string> = {
  system: 'Meroidea (automatic)',
  employee_link: 'New hire, by their link',
  agreement_link: 'Admin, by the agreement link',
  document_editor: 'Document editor',
  integration: 'Integration',
  api: 'API',
};

/** Who did it, in words; entries written without a person say what wrote them instead. */
export function actorLabel(row: {
  actorType: string;
  actorName: string | null;
  actorUserId: string | null;
}): string {
  if (row.actorType === 'platform') {
    return row.actorName ? `${row.actorName} (platform owner)` : 'Platform owner';
  }
  if (row.actorName) return row.actorName;
  return ACTOR_WORDS[row.actorType] ?? (row.actorUserId ? 'Unknown person' : 'Meroidea');
}

const DETAIL_LIMIT = 160;

/** One stored value as text: what the screen shows, cut short so one entry cannot flood it. */
export function valueText(value: unknown, limit = DETAIL_LIMIT): string {
  if (value === null || value === undefined || value === '') return '—';
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export type ChangeLine = { field: string; before: string; after: string };

/**
 * `changes` is `{field: [old, new]}` (src/lib/audit-diff.ts). Sensitive fields were stored as
 * "•••" on both sides when the entry was written, so nothing here needs to hide them again.
 */
export function changeLines(changes: unknown): ChangeLine[] {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return [];
  return Object.entries(changes as Record<string, unknown>).map(([key, pair]) => {
    const [before, after] = Array.isArray(pair) && pair.length === 2 ? pair : [undefined, pair];
    return { field: fieldWords(key), before: valueText(before), after: valueText(after) };
  });
}

export type DetailLine = { label: string; value: string };

/** `context` is free-form: the request, the reason, counts. Shown as label and value. */
export function detailLines(context: unknown): DetailLine[] {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return [];
  return Object.entries(context as Record<string, unknown>).map(([key, value]) => ({
    label: sentence(fieldWords(key)),
    value: valueText(value),
  }));
}

const RECORD_PAGES: Record<string, string> = {
  contact: '/contacts',
  opportunity: '/opportunities',
  organization: '/organizations',
  partner: '/partners',
  employee: '/staff',
  job_opening: '/recruitment',
  payslip: '/payslips',
  library_document: '/documents',
  ticket: '/helpdesk',
  concern: '/concerns',
  purchase_order: '/orders',
  supplier: '/suppliers',
  inventory_item: '/inventory',
  project: '/projects',
  invoice: '/invoices',
};

/** The record's own page, where it has one. That page still checks the viewer may open it. */
export function recordHref(type: string, id: string | null): string | null {
  const base = RECORD_PAGES[type];
  return base && id ? `${base}/${id}` : null;
}
