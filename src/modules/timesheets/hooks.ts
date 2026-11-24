import 'server-only';

import { and, eq, gt, inArray, isNull, lt } from 'drizzle-orm';

import { timeEntries } from '@/db/schema';
import { hasPermission, type TenantContext } from '@/server/context';
import type { Tx } from '@/server/db/with-rls';

/**
 * How a pay run paid from the roster shows up in Timesheets (ADR-083). Called inside payroll's
 * own transaction when a roster is authorised for pay with its rostered hours: each paid shift
 * becomes approved time (`source = 'roster'`), linked to its shift, so Timesheets and its export
 * show exactly what was paid. A shift the person already has time recorded against, or time that
 * overlaps it, is left alone. Nothing is recorded while Timesheets is switched off for the
 * business, and a failure here never stops the pay run: it runs in a savepoint and is skipped.
 */
export async function recordPaidRosterTime(
  tx: Tx,
  ctx: TenantContext,
  shifts: { id: string; userId: string; startsAt: Date; endsAt: Date; breakMinutes: number }[],
): Promise<number> {
  if (!hasPermission(ctx, 'timesheets.manage') || shifts.length === 0) return 0;
  const earliest = new Date(Math.min(...shifts.map((shift) => shift.startsAt.getTime())));
  const latest = new Date(Math.max(...shifts.map((shift) => shift.endsAt.getTime())));
  const existing = await tx
    .select({
      userId: timeEntries.userId,
      shiftId: timeEntries.shiftId,
      clockIn: timeEntries.clockIn,
      clockOut: timeEntries.clockOut,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.tenantId, ctx.tenantId),
        inArray(timeEntries.userId, [...new Set(shifts.map((shift) => shift.userId))]),
        isNull(timeEntries.deletedAt),
        lt(timeEntries.clockIn, latest),
        gt(timeEntries.clockOut, earliest),
      ),
    );
  const now = new Date();
  const rows = shifts
    .filter(
      (shift) =>
        !existing.some(
          (entry) =>
            entry.shiftId === shift.id ||
            (entry.userId === shift.userId &&
              entry.clockOut !== null &&
              entry.clockIn < shift.endsAt &&
              entry.clockOut > shift.startsAt),
        ),
    )
    .map((shift) => ({
      tenantId: ctx.tenantId,
      userId: shift.userId,
      shiftId: shift.id,
      clockIn: shift.startsAt,
      clockOut: shift.endsAt,
      breakMinutes: shift.breakMinutes,
      source: 'roster',
      status: 'approved',
      decidedBy: ctx.userId,
      decidedAt: now,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    }));
  if (rows.length === 0) return 0;
  try {
    await tx.transaction(async (savepoint) => {
      await savepoint.insert(timeEntries).values(rows);
    });
    return rows.length;
  } catch (error) {
    console.error('[timesheets] could not record paid roster time', {
      name: error instanceof Error ? error.name : typeof error,
    });
    return 0;
  }
}
