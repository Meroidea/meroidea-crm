import 'server-only';

import { and, desc, eq, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { auditLogs } from '@/db/schema';
import { addDaysToDate, zonedDateToInstant } from '@/lib/dates';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { AuditFilters } from './schemas';
import type { AuditEntryRow, AuditFacets } from './types';

export const AUDIT_PAGE_SIZE = 50;

/**
 * Keyset cursor over (created_at desc, id desc). The time is carried at the database's own
 * microsecond precision: a JavaScript Date keeps only milliseconds, and entries written in the
 * same millisecond would be skipped between pages.
 */
const cursorSchema = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.string().regex(/^\d{1,19}$/),
});
type AuditCursor = z.output<typeof cursorSchema>;

function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeAuditCursor(raw: string | undefined): AuditCursor | null {
  if (!raw) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function conditions(ctx: TenantContext, filters: AuditFilters): SQL[] {
  const timeZone = ctx.tenant.timezone;
  const where: SQL[] = [eq(auditLogs.tenantId, ctx.tenantId)];
  // Whole days in the business's timezone: "to 3 March" includes all of 3 March there.
  if (filters.from)
    where.push(gte(auditLogs.createdAt, zonedDateToInstant(timeZone, filters.from)));
  if (filters.to) {
    where.push(lt(auditLogs.createdAt, zonedDateToInstant(timeZone, addDaysToDate(filters.to, 1))));
  }
  if (filters.person) where.push(eq(auditLogs.actorUserId, filters.person));
  if (filters.action) where.push(eq(auditLogs.action, filters.action));
  if (filters.type) where.push(eq(auditLogs.entityType, filters.type));
  if (filters.record) where.push(eq(auditLogs.entityId, filters.record));
  const cursor = decodeAuditCursor(filters.cursor);
  if (cursor) {
    where.push(
      sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${cursor.t}::timestamptz, ${cursor.id}::bigint)`,
    );
  }
  return where;
}

/**
 * Names of the people behind entries, including people who have left the business, through
 * `app.audit_actor_names` (ADR-063). Only someone with audit.view gets any.
 */
async function actorNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = (await tx.execute(sql`
    select user_id, full_name from app.audit_actor_names(
      array[${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]::uuid[]
    )`)) as unknown as { user_id: string; full_name: string }[];
  return new Map(rows.map((row) => [row.user_id, row.full_name]));
}

/** Entries matching the filters, newest first, with who did each. Shared by screen and export. */
export async function selectAuditEntries(
  tx: Tx,
  ctx: TenantContext,
  filters: AuditFilters,
  limit: number,
): Promise<(AuditEntryRow & { cursorAt: string })[]> {
  const rows = await tx
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      cursorAt: sql<string>`to_char(${auditLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      actorUserId: auditLogs.actorUserId,
      actorType: auditLogs.actorType,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      changes: auditLogs.changes,
      context: auditLogs.context,
      ip: auditLogs.ip,
      userAgent: auditLogs.userAgent,
    })
    .from(auditLogs)
    .where(and(...conditions(ctx, filters)))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit);
  const names = await actorNames(tx, [
    ...new Set(rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : []))),
  ]);
  return rows.map((row) => ({
    ...row,
    id: String(row.id),
    actorName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
  }));
}

/**
 * One page of the business's audit log. Needs audit.view, checked here and again by the
 * database (policy `audit_read`, ADR-063).
 */
export async function listAuditEntries(
  ctx: TenantContext,
  filters: AuditFilters,
): Promise<{ entries: AuditEntryRow[]; nextCursor: string | null }> {
  requirePermission(ctx, 'audit.view');
  const rows = await withRls(ctx, (tx) =>
    selectAuditEntries(tx, ctx, filters, AUDIT_PAGE_SIZE + 1),
  );
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    entries: page,
    nextCursor:
      rows.length > AUDIT_PAGE_SIZE && last
        ? encodeAuditCursor({ t: last.cursorAt, id: last.id })
        : null,
  };
}

/** The choices the filters offer: everyone who appears in the log, and every record type. */
export async function getAuditFacets(ctx: TenantContext): Promise<AuditFacets> {
  requirePermission(ctx, 'audit.view');
  return withRls(ctx, async (tx) => {
    const types = await tx
      .selectDistinct({ type: auditLogs.entityType })
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, ctx.tenantId))
      .orderBy(auditLogs.entityType);
    const actors = await tx
      .selectDistinct({ id: auditLogs.actorUserId })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, ctx.tenantId), isNotNull(auditLogs.actorUserId)));
    const names = await actorNames(
      tx,
      actors.flatMap((actor) => (actor.id ? [actor.id] : [])),
    );
    return {
      people: [...names]
        .map(([userId, name]) => ({ userId, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      types: types.map((row) => row.type),
    };
  });
}
