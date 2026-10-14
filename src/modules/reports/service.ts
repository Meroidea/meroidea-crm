import 'server-only';

import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

/**
 * Report tables are exported in the browser from figures already on the page (totals, no
 * personal details); the export is still recorded, like every other (rules/security.md).
 */
export async function recordReportExport(
  ctx: TenantContext,
  input: { report: string; rows: number },
): Promise<{ ok: true }> {
  requirePermission(ctx, 'reports.export');
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'export',
      entityType: 'report',
      entityId: null,
      context: { report: input.report, rows: input.rows },
    }),
  );
  return { ok: true };
}
