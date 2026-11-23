import { z } from 'zod';

/** What an audit entry can say happened. Older or rarer actions still show, just unfiltered. */
export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'restore',
  'stage_change',
  'owner_change',
  'permission_change',
  'accept',
  'decline',
  'export',
  'import',
  'download',
  'view_sensitive',
  'login',
  'ai_assist',
  'ai_approve',
] as const;

export type AuditActionKey = (typeof AUDIT_ACTIONS)[number];

/**
 * The viewer's filters, kept in the URL so a view can be bookmarked and shared (docs/architecture.md
 * §4). Ids and dates only: there is deliberately no free-text search, because what people search
 * an audit log for is names and email addresses, which must never sit in a URL
 * (rules/security.md).
 */
export const auditFiltersSchema = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  person: z.uuid().optional().catch(undefined),
  action: z.enum(AUDIT_ACTIONS).optional().catch(undefined),
  type: z
    .string()
    .regex(/^[a-z][a-z_]{0,63}$/)
    .optional()
    .catch(undefined),
  record: z.uuid().optional().catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
});

export type AuditFilters = z.output<typeof auditFiltersSchema>;
