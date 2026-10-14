import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { importBatches, leadSources, leadSubSources, users } from '@/db/schema';
import { scopeFilter } from '@/lib/permissions/scope';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { ImportReportRow } from './schemas';

export type ImportBatchSummary = {
  id: string;
  fileName: string;
  createdAt: Date;
  completedAt: Date | null;
  createdByName: string | null;
  sourceName: string | null;
  subSourceName: string | null;
  campaignName: string | null;
  leadType: 'b2b' | 'b2c' | null;
  asLeads: boolean;
  duplicateStrategy: string;
  rowCount: number;
  createdCount: number;
  mergedCount: number;
  skippedCount: number;
  duplicateCreatedCount: number;
  errorCount: number;
};

function columns() {
  return {
    id: importBatches.id,
    fileName: importBatches.fileName,
    createdAt: importBatches.createdAt,
    completedAt: importBatches.completedAt,
    createdByName: users.fullName,
    sourceName: leadSources.name,
    subSourceName: leadSubSources.name,
    campaignName: importBatches.campaignName,
    leadType: importBatches.leadType,
    duplicateStrategy: importBatches.duplicateStrategy,
    rowCount: importBatches.rowCount,
    createdCount: importBatches.createdCount,
    mergedCount: importBatches.mergedCount,
    skippedCount: importBatches.skippedCount,
    duplicateCreatedCount: importBatches.duplicateCreatedCount,
    errorCount: importBatches.errorCount,
    report: importBatches.report,
  };
}

const asLeadsOf = (report: unknown) => (report as { asLeads?: unknown } | null)?.asLeads === true;

/**
 * Uploads the viewer may look back on: their own, or everyone's when they see every record
 * (the report links to the records each upload made).
 */
export async function listImportBatches(ctx: TenantContext): Promise<ImportBatchSummary[]> {
  requirePermission(ctx, 'contacts.import');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select(columns())
      .from(importBatches)
      .leftJoin(users, eq(users.id, importBatches.createdBy))
      .leftJoin(leadSources, eq(leadSources.id, importBatches.sourceId))
      .leftJoin(leadSubSources, eq(leadSubSources.id, importBatches.subSourceId))
      .where(
        and(
          eq(importBatches.tenantId, ctx.tenantId),
          scopeFilter(ctx, 'contacts.view', { ownerUserId: importBatches.createdBy }),
        ),
      )
      .orderBy(desc(importBatches.createdAt))
      .limit(25),
  );
  return rows.map(({ report, ...row }) => ({ ...row, asLeads: asLeadsOf(report) }));
}

export async function getImportBatch(
  ctx: TenantContext,
  id: string,
): Promise<(ImportBatchSummary & { rows: ImportReportRow[] }) | null> {
  requirePermission(ctx, 'contacts.import');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select(columns())
      .from(importBatches)
      .leftJoin(users, eq(users.id, importBatches.createdBy))
      .leftJoin(leadSources, eq(leadSources.id, importBatches.sourceId))
      .leftJoin(leadSubSources, eq(leadSubSources.id, importBatches.subSourceId))
      .where(
        and(
          eq(importBatches.tenantId, ctx.tenantId),
          eq(importBatches.id, id),
          scopeFilter(ctx, 'contacts.view', { ownerUserId: importBatches.createdBy }),
        ),
      )
      .limit(1),
  );
  if (!row) return null;
  const { report, ...rest } = row;
  const rows = (report as { rows?: unknown } | null)?.rows;
  return {
    ...rest,
    asLeads: asLeadsOf(report),
    rows: Array.isArray(rows) ? (rows as ImportReportRow[]) : [],
  };
}
