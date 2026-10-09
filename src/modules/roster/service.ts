import 'server-only';

import { and, desc, eq, gt, gte, isNull, lt, lte, ne } from 'drizzle-orm';

import { rosterShifts, rosters, tenantMemberships } from '@/db/schema';
import {
  addDaysToDate,
  daysBetweenDates,
  instantToZoned,
  zonedDateTimeToInstant,
} from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { ROSTER_SPAN_DAYS, type CreateRosterInput, type SaveShiftInput } from './schemas';

async function loadRoster(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .select()
    .from(rosters)
    .where(and(eq(rosters.tenantId, ctx.tenantId), eq(rosters.id, id), isNull(rosters.deletedAt)))
    .limit(1)
    .for('update');
  if (!row) throw new AppError('NOT_FOUND', 'That roster was not found.');
  return row;
}

/** A roster signed off for pay is the record payslips were made from; it no longer changes. */
function assertNotAuthorised(roster: { authorisedAt: Date | null }) {
  if (roster.authorisedAt) {
    throw new AppError(
      'CONFLICT',
      'This roster has been authorised for pay and can no longer be changed.',
    );
  }
}

async function activeMemberIds(tx: Tx, ctx: TenantContext): Promise<Set<string>> {
  const rows = await tx
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .where(
      and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.status, 'active')),
    );
  return new Set(rows.map((row) => row.userId));
}

/** Start and end instants for a shift given in the workspace's wall-clock time. */
function shiftInstants(timezone: string, date: string, startTime: string, endTime: string) {
  const startsAt = zonedDateTimeToInstant(timezone, date, startTime);
  // An end at or before the start means the shift runs past midnight.
  const endDate = endTime <= startTime ? addDaysToDate(date, 1) : date;
  return { startsAt, endsAt: zonedDateTimeToInstant(timezone, endDate, endTime) };
}

/**
 * Copies the shifts of the roster before `target` onto it, day for day. A shorter source repeats
 * to fill a longer target (a week copied into a fortnight fills both weeks); a longer one is cut
 * off. People who are no longer active are left out.
 */
async function copyFromPrevious(
  tx: Tx,
  ctx: TenantContext,
  target: { id: string; startsOn: string; endsOn: string },
): Promise<number> {
  const [source] = await tx
    .select({ id: rosters.id, startsOn: rosters.startsOn, endsOn: rosters.endsOn })
    .from(rosters)
    .where(
      and(
        eq(rosters.tenantId, ctx.tenantId),
        isNull(rosters.deletedAt),
        lt(rosters.endsOn, target.startsOn),
      ),
    )
    .orderBy(desc(rosters.startsOn))
    .limit(1);
  if (!source) return 0;

  const sourceShifts = await tx
    .select()
    .from(rosterShifts)
    .where(
      and(
        eq(rosterShifts.tenantId, ctx.tenantId),
        eq(rosterShifts.rosterId, source.id),
        isNull(rosterShifts.deletedAt),
      ),
    );
  const active = await activeMemberIds(tx, ctx);
  const timezone = ctx.tenant.timezone;
  const sourceDays = daysBetweenDates(source.startsOn, source.endsOn) + 1;
  const targetDays = daysBetweenDates(target.startsOn, target.endsOn) + 1;

  const copies = sourceShifts.flatMap((shift) => {
    if (!active.has(shift.userId)) return [];
    const start = instantToZoned(timezone, shift.startsAt);
    const end = instantToZoned(timezone, shift.endsAt);
    const dayIndex = daysBetweenDates(source.startsOn, start.date);
    const placed = [];
    for (let day = dayIndex; day < targetDays; day += sourceDays) {
      const date = addDaysToDate(target.startsOn, day);
      placed.push({
        tenantId: ctx.tenantId,
        rosterId: target.id,
        userId: shift.userId,
        ...shiftInstants(timezone, date, start.time, end.time),
        breakMinutes: shift.breakMinutes,
        position: shift.position,
        note: shift.note,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
    }
    return placed;
  });

  if (copies.length > 0) await tx.insert(rosterShifts).values(copies);
  return copies.length;
}

export async function createRoster(
  ctx: TenantContext,
  input: CreateRosterInput,
): Promise<{ id: string; copiedShifts: number }> {
  requirePermission(ctx, 'rosters.manage');
  const endsOn = addDaysToDate(input.startsOn, ROSTER_SPAN_DAYS[input.span] - 1);

  return withRls(ctx, async (tx) => {
    const [clash] = await tx
      .select({ id: rosters.id })
      .from(rosters)
      .where(
        and(
          eq(rosters.tenantId, ctx.tenantId),
          isNull(rosters.deletedAt),
          lte(rosters.startsOn, endsOn),
          gte(rosters.endsOn, input.startsOn),
        ),
      )
      .limit(1);
    if (clash) {
      throw new AppError('CONFLICT', 'A roster already covers some of those days.', {
        startsOn: ['Choose days that no other roster covers'],
      });
    }

    const [created] = await tx
      .insert(rosters)
      .values({
        tenantId: ctx.tenantId,
        startsOn: input.startsOn,
        endsOn,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: rosters.id, startsOn: rosters.startsOn, endsOn: rosters.endsOn });
    if (!created) throw new AppError('INTERNAL', 'Could not create the roster.');

    const copiedShifts = input.copyPrevious ? await copyFromPrevious(tx, ctx, created) : 0;
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'roster',
      entityId: created.id,
      context: { startsOn: created.startsOn, endsOn: created.endsOn, copiedShifts },
    });
    return { id: created.id, copiedShifts };
  });
}

async function setRosterStatus(
  ctx: TenantContext,
  id: string,
  status: 'draft' | 'published',
): Promise<{ id: string }> {
  requirePermission(ctx, 'rosters.manage');
  return withRls(ctx, async (tx) => {
    const roster = await loadRoster(tx, ctx, id);
    assertNotAuthorised(roster);
    if (roster.status === status) return { id };
    await tx
      .update(rosters)
      .set({
        status,
        publishedAt: status === 'published' ? new Date() : null,
        publishedBy: status === 'published' ? ctx.userId : null,
        updatedBy: ctx.userId,
      })
      .where(and(eq(rosters.tenantId, ctx.tenantId), eq(rosters.id, id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'roster',
      entityId: id,
      changes: { status: [roster.status, status] },
    });
    return { id };
  });
}

export const publishRoster = (ctx: TenantContext, id: string) =>
  setRosterStatus(ctx, id, 'published');
export const unpublishRoster = (ctx: TenantContext, id: string) =>
  setRosterStatus(ctx, id, 'draft');

export async function deleteRoster(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'rosters.manage');
  return withRls(ctx, async (tx) => {
    assertNotAuthorised(await loadRoster(tx, ctx, id));
    const now = new Date();
    await tx
      .update(rosterShifts)
      .set({ deletedAt: now, updatedBy: ctx.userId })
      .where(
        and(
          eq(rosterShifts.tenantId, ctx.tenantId),
          eq(rosterShifts.rosterId, id),
          isNull(rosterShifts.deletedAt),
        ),
      );
    await tx
      .update(rosters)
      .set({ deletedAt: now, updatedBy: ctx.userId })
      .where(and(eq(rosters.tenantId, ctx.tenantId), eq(rosters.id, id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'roster', entityId: id });
    return { id };
  });
}

/** Creates a shift, or updates the one named by `input.id`. */
export async function saveShift(
  ctx: TenantContext,
  input: SaveShiftInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'rosters.manage');

  return withRls(ctx, async (tx) => {
    const roster = await loadRoster(tx, ctx, input.rosterId);
    assertNotAuthorised(roster);
    if (input.date < roster.startsOn || input.date > roster.endsOn) {
      throw new AppError('VALIDATION', 'That day is outside this roster.', {
        date: ['Choose a day inside this roster'],
      });
    }

    const { startsAt, endsAt } = shiftInstants(
      ctx.tenant.timezone,
      input.date,
      input.startTime,
      input.endTime,
    );
    const lengthMinutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
    if (input.breakMinutes >= lengthMinutes) {
      throw new AppError('VALIDATION', 'The break is as long as the shift.', {
        breakMinutes: ['Make the break shorter than the shift'],
      });
    }

    if (!(await activeMemberIds(tx, ctx)).has(input.userId)) {
      throw new AppError('VALIDATION', 'That person is not an active member of this workspace.', {
        userId: ['Choose an active member'],
      });
    }

    const [overlap] = await tx
      .select({ id: rosterShifts.id })
      .from(rosterShifts)
      .where(
        and(
          eq(rosterShifts.tenantId, ctx.tenantId),
          eq(rosterShifts.userId, input.userId),
          isNull(rosterShifts.deletedAt),
          lt(rosterShifts.startsAt, endsAt),
          gt(rosterShifts.endsAt, startsAt),
          input.id ? ne(rosterShifts.id, input.id) : undefined,
        ),
      )
      .limit(1);
    if (overlap) {
      throw new AppError('CONFLICT', 'This person already has a shift at that time.', {
        startTime: ['Overlaps another shift for this person'],
      });
    }

    const values = {
      userId: input.userId,
      startsAt,
      endsAt,
      breakMinutes: input.breakMinutes,
      position: input.position,
      note: input.note,
      updatedBy: ctx.userId,
    };

    if (input.id) {
      const [updated] = await tx
        .update(rosterShifts)
        .set(values)
        .where(
          and(
            eq(rosterShifts.tenantId, ctx.tenantId),
            eq(rosterShifts.id, input.id),
            eq(rosterShifts.rosterId, roster.id),
            isNull(rosterShifts.deletedAt),
          ),
        )
        .returning({ id: rosterShifts.id });
      if (!updated) throw new AppError('NOT_FOUND', 'That shift was not found.');
      await audit(tx, ctx, { action: 'update', entityType: 'roster_shift', entityId: updated.id });
      return updated;
    }

    const [created] = await tx
      .insert(rosterShifts)
      .values({ ...values, tenantId: ctx.tenantId, rosterId: roster.id, createdBy: ctx.userId })
      .returning({ id: rosterShifts.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the shift.');
    await audit(tx, ctx, { action: 'create', entityType: 'roster_shift', entityId: created.id });
    return created;
  });
}

export async function deleteShift(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'rosters.manage');
  return withRls(ctx, async (tx) => {
    const [shift] = await tx
      .select({ rosterId: rosterShifts.rosterId })
      .from(rosterShifts)
      .where(
        and(
          eq(rosterShifts.tenantId, ctx.tenantId),
          eq(rosterShifts.id, id),
          isNull(rosterShifts.deletedAt),
        ),
      )
      .limit(1);
    if (!shift) throw new AppError('NOT_FOUND', 'That shift was not found.');
    assertNotAuthorised(await loadRoster(tx, ctx, shift.rosterId));
    const [removed] = await tx
      .update(rosterShifts)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(rosterShifts.tenantId, ctx.tenantId),
          eq(rosterShifts.id, id),
          isNull(rosterShifts.deletedAt),
        ),
      )
      .returning({ id: rosterShifts.id });
    if (!removed) throw new AppError('NOT_FOUND', 'That shift was not found.');
    await audit(tx, ctx, { action: 'delete', entityType: 'roster_shift', entityId: id });
    return removed;
  });
}
