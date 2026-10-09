import 'server-only';

import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm';

import { timeEntries, users } from '@/db/schema';
import { addDaysToDate, zonedDateToInstant } from '@/lib/dates';
import { hasPermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { EntryStatus } from './schemas';

export type TimeEntryRow = {
  id: string;
  userId: string;
  personName: string;
  clockIn: Date;
  clockOut: Date | null;
  breakMinutes: number;
  note: string | null;
  source: 'clock' | 'manual';
  status: EntryStatus;
};

/** The entry the signed-in person is clocked in on right now, if any. */
export async function getOpenEntry(ctx: TenantContext) {
  const [entry] = await withRls(ctx, (tx) =>
    tx
      .select({ id: timeEntries.id, clockIn: timeEntries.clockIn, note: timeEntries.note })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.tenantId, ctx.tenantId),
          eq(timeEntries.userId, ctx.userId),
          isNull(timeEntries.clockOut),
          isNull(timeEntries.deletedAt),
        ),
      )
      .limit(1),
  );
  return entry ?? null;
}

/**
 * Time entries that started in a range of calendar days (in the business's timezone), oldest
 * first. `'everyone'` needs timesheets.manage and falls back to the person's own without it.
 */
export async function listTimeEntries(
  ctx: TenantContext,
  options: { scope: 'mine' | 'everyone'; from: string; to: string },
): Promise<TimeEntryRow[]> {
  const everyone = options.scope === 'everyone' && hasPermission(ctx, 'timesheets.manage');
  const timezone = ctx.tenant.timezone;
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: timeEntries.id,
        userId: timeEntries.userId,
        personName: users.fullName,
        clockIn: timeEntries.clockIn,
        clockOut: timeEntries.clockOut,
        breakMinutes: timeEntries.breakMinutes,
        note: timeEntries.note,
        source: timeEntries.source,
        status: timeEntries.status,
      })
      .from(timeEntries)
      .innerJoin(users, eq(users.id, timeEntries.userId))
      .where(
        and(
          eq(timeEntries.tenantId, ctx.tenantId),
          isNull(timeEntries.deletedAt),
          everyone ? undefined : eq(timeEntries.userId, ctx.userId),
          gte(timeEntries.clockIn, zonedDateToInstant(timezone, options.from)),
          lt(timeEntries.clockIn, zonedDateToInstant(timezone, addDaysToDate(options.to, 1))),
        ),
      )
      .orderBy(asc(users.fullName), asc(timeEntries.clockIn)),
  );
  return rows as TimeEntryRow[];
}
