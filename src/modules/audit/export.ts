import 'server-only';

import { toCsv } from '@/lib/csv';
import { instantToZoned } from '@/lib/dates';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { actionLabel, actorLabel, entityLabel } from './format';
import { selectAuditEntries } from './queries';
import type { AuditFilters } from './schemas';

/** A year of a busy business; a bigger export is a database job, not a click. */
export const AUDIT_EXPORT_LIMIT = 10_000;

const json = (value: unknown) =>
  value === null || value === undefined ? '' : JSON.stringify(value);

/**
 * The audit log as CSV, under the same filters as the screen. It carries who did what from
 * where, so it needs audit.view, and the export is itself recorded in the log.
 */
export async function exportAuditLog(
  ctx: TenantContext,
  filters: AuditFilters,
): Promise<{ csv: string; rows: number; truncated: boolean }> {
  requirePermission(ctx, 'audit.view');
  const applied: AuditFilters = { ...filters, cursor: undefined };

  return withRls(ctx, async (tx) => {
    const rows = await selectAuditEntries(tx, ctx, applied, AUDIT_EXPORT_LIMIT + 1);
    const shown = rows.slice(0, AUDIT_EXPORT_LIMIT);
    const csv = toCsv(
      shown.map((row) => {
        const local = instantToZoned(ctx.tenant.timezone, row.createdAt);
        return {
          Entry: row.id,
          'Time (UTC)': row.createdAt.toISOString(),
          [`Time (${ctx.tenant.timezone})`]: `${local.date} ${local.time}`,
          Person: actorLabel(row),
          Action: actionLabel(row.action),
          'Record type': entityLabel(row.entityType, ctx.tenant.labels),
          'Record ID': row.entityId ?? '',
          Changes: json(row.changes),
          Details: json(row.context),
          'IP address': row.ip ?? '',
          Browser: row.userAgent ?? '',
        };
      }),
    );
    await audit(tx, ctx, {
      action: 'export',
      entityType: 'audit_log',
      entityId: null,
      // Ids and dates only, never names: the filters say what was taken out.
      context: { what: 'audit_log', filters: applied, rows: shown.length },
    });
    return { csv, rows: shown.length, truncated: rows.length > AUDIT_EXPORT_LIMIT };
  });
}
