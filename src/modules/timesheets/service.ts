import 'server-only';

import { and, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';

import { rosters, tenantMemberships, timeEntries } from '@/db/schema';
import { addDaysToDate, instantToZoned, zonedDateTimeToInstant } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { distanceMetres } from '@/lib/geo';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { ClockPosition, DecideEntriesInput, ManualEntryInput } from './schemas';

const MAX_SHIFT_MINUTES = 24 * 60;
/** A reading the device itself says could be this far off is no evidence of where someone is. */
const MAX_ACCURACY_METRES = 100;

/**
 * When the platform owner has set where the business is, clocking in or out only works from
 * within its radius. Returns the distance to record, or null when no location is required.
 * The position comes from the person's device, so this deters rather than proves: see ADR-033.
 */
function distanceFromWorkplace(ctx: TenantContext, position: ClockPosition): number | null {
  const workplace = ctx.tenant.clockLocation;
  if (!workplace) return null;
  if (!position) {
    throw new AppError(
      'VALIDATION',
      'Your location is needed to clock in or out. Allow location access for this site and try again.',
    );
  }
  if (position.accuracy > MAX_ACCURACY_METRES) {
    throw new AppError(
      'VALIDATION',
      'Your device could not get an accurate location. Move near a window or outside and try again.',
    );
  }
  const distance = Math.round(distanceMetres(workplace, position));
  if (distance > workplace.radiusMetres) {
    throw new AppError(
      'FORBIDDEN',
      `You are about ${distance} m from the workplace. You can only clock in or out within ${workplace.radiusMetres} m of it.`,
    );
  }
  return distance;
}

/**
 * Once a pay period has been authorised its payslips are fixed, so the time recorded in it
 * cannot change any more.
 */
async function assertPayPeriodOpen(tx: Tx, ctx: TenantContext, instants: Date[]) {
  for (const instant of instants) {
    const { date } = instantToZoned(ctx.tenant.timezone, instant);
    const [closed] = await tx
      .select({ id: rosters.id })
      .from(rosters)
      .where(
        and(
          eq(rosters.tenantId, ctx.tenantId),
          isNull(rosters.deletedAt),
          isNotNull(rosters.authorisedAt),
          lte(rosters.startsOn, date),
          gte(rosters.endsOn, date),
        ),
      )
      .limit(1);
    if (closed) {
      throw new AppError(
        'CONFLICT',
        'That pay period has already been authorised, so its time can no longer change.',
      );
    }
  }
}

async function findEntry(tx: Tx, ctx: TenantContext, id: string) {
  const [entry] = await tx
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.tenantId, ctx.tenantId),
        eq(timeEntries.id, id),
        isNull(timeEntries.deletedAt),
      ),
    )
    .limit(1);
  if (!entry) throw new AppError('NOT_FOUND', 'That entry was not found.');
  return entry;
}

export async function clockIn(
  ctx: TenantContext,
  note: string | null,
  position?: ClockPosition,
): Promise<{ id: string }> {
  requirePermission(ctx, 'timesheets.clock');
  const distance = distanceFromWorkplace(ctx, position);
  return withRls(ctx, async (tx) => {
    const [open] = await tx
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.tenantId, ctx.tenantId),
          eq(timeEntries.userId, ctx.userId),
          isNull(timeEntries.clockOut),
          isNull(timeEntries.deletedAt),
        ),
      )
      .limit(1);
    if (open) throw new AppError('CONFLICT', 'You are already clocked in.');
    const [created] = await tx
      .insert(timeEntries)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        clockIn: new Date(),
        note,
        clockInDistanceM: distance,
        source: 'clock',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: timeEntries.id });
    if (!created) throw new AppError('INTERNAL', 'Could not clock you in.');
    await audit(tx, ctx, { action: 'create', entityType: 'time_entry', entityId: created.id });
    return created;
  });
}

export async function clockOut(
  ctx: TenantContext,
  breakMinutes: number,
  position?: ClockPosition,
): Promise<{ id: string }> {
  requirePermission(ctx, 'timesheets.clock');
  const distance = distanceFromWorkplace(ctx, position);
  return withRls(ctx, async (tx) => {
    const [open] = await tx
      .select({ id: timeEntries.id, clockIn: timeEntries.clockIn })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.tenantId, ctx.tenantId),
          eq(timeEntries.userId, ctx.userId),
          isNull(timeEntries.clockOut),
          isNull(timeEntries.deletedAt),
        ),
      )
      .limit(1);
    if (!open) throw new AppError('CONFLICT', 'You are not clocked in.');
    // At least a minute, so a double-press still leaves a valid entry.
    const now = new Date(Math.max(Date.now(), open.clockIn.getTime() + 60_000));
    const length = Math.round((now.getTime() - open.clockIn.getTime()) / 60_000);
    if (breakMinutes >= length && breakMinutes > 0) {
      throw new AppError('VALIDATION', 'The break is longer than the time worked.', {
        breakMinutes: ['Enter a shorter break'],
      });
    }
    await tx
      .update(timeEntries)
      .set({ clockOut: now, breakMinutes, clockOutDistanceM: distance, updatedBy: ctx.userId })
      .where(and(eq(timeEntries.tenantId, ctx.tenantId), eq(timeEntries.id, open.id)));
    await audit(tx, ctx, { action: 'update', entityType: 'time_entry', entityId: open.id });
    return { id: open.id };
  });
}

/**
 * Adds or corrects a finished stretch of work. People add their own (a forgotten clock-in) and
 * it waits for approval; someone who manages timesheets can add or correct anyone's.
 */
export async function saveManualEntry(
  ctx: TenantContext,
  input: ManualEntryInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'timesheets.clock');
  const manages = hasPermission(ctx, 'timesheets.manage');
  // Typing time in would sidestep the location check, so where one applies only managers may.
  if (ctx.tenant.clockLocation && !manages) {
    throw new AppError(
      'FORBIDDEN',
      'Time here is recorded by clocking in at the workplace. Ask a manager to add missed time.',
    );
  }
  const timezone = ctx.tenant.timezone;
  const start = zonedDateTimeToInstant(timezone, input.date, input.start);
  const endDate = input.end <= input.start ? addDaysToDate(input.date, 1) : input.date;
  const end = zonedDateTimeToInstant(timezone, endDate, input.end);
  const length = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (length <= 0 || length > MAX_SHIFT_MINUTES) {
    throw new AppError('VALIDATION', 'Check the start and finish times.', {
      end: ['Check the finish time'],
    });
  }
  if (input.breakMinutes >= length) {
    throw new AppError('VALIDATION', 'The break is longer than the time worked.', {
      breakMinutes: ['Enter a shorter break'],
    });
  }
  if (end.getTime() > Date.now()) {
    throw new AppError('VALIDATION', 'Time can only be recorded after it has been worked.', {
      end: ['This is in the future'],
    });
  }

  return withRls(ctx, async (tx) => {
    if (input.id) {
      const entry = await findEntry(tx, ctx, input.id);
      const own = entry.userId === ctx.userId && entry.status === 'pending';
      if (!manages && !own) {
        throw new AppError('CONFLICT', 'Only a manager can change this entry now.');
      }
      await assertPayPeriodOpen(tx, ctx, [entry.clockIn, start]);
      await tx
        .update(timeEntries)
        .set({
          clockIn: start,
          clockOut: end,
          breakMinutes: input.breakMinutes,
          note: input.note,
          // A corrected entry has to be looked at again.
          status: 'pending',
          decidedBy: null,
          decidedAt: null,
          updatedBy: ctx.userId,
        })
        .where(and(eq(timeEntries.tenantId, ctx.tenantId), eq(timeEntries.id, entry.id)));
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'time_entry',
        entityId: entry.id,
        context: { corrected: true },
      });
      return { id: entry.id };
    }

    const userId = input.userId ?? ctx.userId;
    if (userId !== ctx.userId) {
      if (!manages) throw new AppError('FORBIDDEN', 'You do not have access to that.');
      const [person] = await tx
        .select({ id: tenantMemberships.id })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, ctx.tenantId),
            eq(tenantMemberships.userId, userId),
            eq(tenantMemberships.status, 'active'),
          ),
        )
        .limit(1);
      if (!person) throw new AppError('NOT_FOUND', 'That person was not found.');
    }
    await assertPayPeriodOpen(tx, ctx, [start]);
    const [created] = await tx
      .insert(timeEntries)
      .values({
        tenantId: ctx.tenantId,
        userId,
        clockIn: start,
        clockOut: end,
        breakMinutes: input.breakMinutes,
        note: input.note,
        source: 'manual',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: timeEntries.id });
    if (!created) throw new AppError('INTERNAL', 'The entry could not be saved.');
    await audit(tx, ctx, { action: 'create', entityType: 'time_entry', entityId: created.id });
    return created;
  });
}

/** Approves, rejects or re-opens finished entries. */
export async function decideEntries(
  ctx: TenantContext,
  input: DecideEntriesInput,
): Promise<{ changed: number }> {
  requirePermission(ctx, 'timesheets.manage');
  return withRls(ctx, async (tx) => {
    const entries = await tx
      .select({ id: timeEntries.id, clockIn: timeEntries.clockIn, clockOut: timeEntries.clockOut })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.tenantId, ctx.tenantId),
          inArray(timeEntries.id, input.ids),
          isNull(timeEntries.deletedAt),
        ),
      );
    if (entries.length !== new Set(input.ids).size) {
      throw new AppError('NOT_FOUND', 'One of those entries was not found.');
    }
    if (entries.some((entry) => !entry.clockOut)) {
      throw new AppError('CONFLICT', 'Someone is still clocked in on one of those entries.');
    }
    await assertPayPeriodOpen(
      tx,
      ctx,
      entries.map((entry) => entry.clockIn),
    );
    const decided = input.decision !== 'pending';
    await tx
      .update(timeEntries)
      .set({
        status: input.decision,
        decidedBy: decided ? ctx.userId : null,
        decidedAt: decided ? new Date() : null,
        updatedBy: ctx.userId,
      })
      .where(and(eq(timeEntries.tenantId, ctx.tenantId), inArray(timeEntries.id, input.ids)));
    for (const entry of entries) {
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'time_entry',
        entityId: entry.id,
        context: { decision: input.decision },
      });
    }
    return { changed: entries.length };
  });
}

/** Removes an entry: the person's own while it is waiting, or any by a manager. */
export async function deleteEntry(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'timesheets.clock');
  const manages = hasPermission(ctx, 'timesheets.manage');
  return withRls(ctx, async (tx) => {
    const entry = await findEntry(tx, ctx, id);
    if (!manages && !(entry.userId === ctx.userId && entry.status === 'pending')) {
      throw new AppError('CONFLICT', 'Only a manager can remove this entry now.');
    }
    await assertPayPeriodOpen(tx, ctx, [entry.clockIn]);
    await tx
      .update(timeEntries)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(timeEntries.tenantId, ctx.tenantId), eq(timeEntries.id, entry.id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'time_entry', entityId: entry.id });
    return { id: entry.id };
  });
}
