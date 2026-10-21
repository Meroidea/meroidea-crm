import 'server-only';

import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';

import {
  publicHolidays,
  rosterShifts,
  rosterTeamMembers,
  rosterTeams,
  rosters,
  tenantMemberships,
  users,
  workforceSettings,
} from '@/db/schema';
import {
  addDaysToDate,
  daysBetweenDates,
  instantToZoned,
  zonedDateTimeToInstant,
} from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { isEmailConfigured, sendEmail } from '@/server/email';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { rosterEmail, type NotifiedShift } from './notify';
import { unpaidMinutes } from './rules';
import {
  ROSTER_SPAN_DAYS,
  type AddHolidayInput,
  type CopyShiftInput,
  type CreateRosterInput,
  type PublishRosterInput,
  type SaveRulesInput,
  type SaveShiftInput,
  type SaveTeamInput,
} from './schemas';

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

async function liveTeamIds(tx: Tx, ctx: TenantContext): Promise<Set<string>> {
  const rows = await tx
    .select({ id: rosterTeams.id })
    .from(rosterTeams)
    .where(and(eq(rosterTeams.tenantId, ctx.tenantId), isNull(rosterTeams.deletedAt)));
  return new Set(rows.map((row) => row.id));
}

/** One person's live shifts never overlap, on this roster or any other. */
async function assertNoOverlap(
  tx: Tx,
  ctx: TenantContext,
  shift: { userId: string; startsAt: Date; endsAt: Date; exceptId?: string },
) {
  const [overlap] = await tx
    .select({ id: rosterShifts.id })
    .from(rosterShifts)
    .where(
      and(
        eq(rosterShifts.tenantId, ctx.tenantId),
        eq(rosterShifts.userId, shift.userId),
        isNull(rosterShifts.deletedAt),
        lt(rosterShifts.startsAt, shift.endsAt),
        gt(rosterShifts.endsAt, shift.startsAt),
        shift.exceptId ? ne(rosterShifts.id, shift.exceptId) : undefined,
      ),
    )
    .limit(1);
  if (overlap) {
    throw new AppError('CONFLICT', 'This person already has a shift at that time.', {
      startTime: ['Overlaps another shift for this person'],
    });
  }
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
 * off. People who are no longer active are left out; vacant shifts come across as they are.
 * The rules for a single shift still hold: a copy that would overlap the person's other shifts
 * (one running in from the roster before, say) is left out and counted, and a person keeps a
 * team only while they still belong to it.
 */
async function copyFromPrevious(
  tx: Tx,
  ctx: TenantContext,
  target: { id: string; startsOn: string; endsOn: string },
): Promise<{ copied: number; skipped: number }> {
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
  if (!source) return { copied: 0, skipped: 0 };

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
  const teams = await liveTeamIds(tx, ctx);
  const memberships = new Set(
    (
      await tx
        .select({ teamId: rosterTeamMembers.teamId, userId: rosterTeamMembers.userId })
        .from(rosterTeamMembers)
        .where(eq(rosterTeamMembers.tenantId, ctx.tenantId))
    ).map((row) => `${row.teamId}:${row.userId}`),
  );
  const timezone = ctx.tenant.timezone;
  const sourceDays = daysBetweenDates(source.startsOn, source.endsOn) + 1;
  const targetDays = daysBetweenDates(target.startsOn, target.endsOn) + 1;

  const copies = sourceShifts.flatMap((shift) => {
    if (shift.userId && !active.has(shift.userId)) return [];
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
        teamId:
          shift.teamId &&
          teams.has(shift.teamId) &&
          (!shift.userId || memberships.has(`${shift.teamId}:${shift.userId}`))
            ? shift.teamId
            : null,
        breakMinutes: shift.breakMinutes,
        breaks: shift.breaks,
        autoBreaks: shift.autoBreaks,
        note: shift.note,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
    }
    return placed;
  });

  // Each person's live shifts around the new roster, which the copies must not overlap; every
  // copy kept joins them, so two copies cannot overlap each other either.
  const people = [...new Set(copies.flatMap((copy) => (copy.userId ? [copy.userId] : [])))];
  const taken = new Map<string, { startsAt: Date; endsAt: Date }[]>();
  if (people.length > 0) {
    const earliest = new Date(Math.min(...copies.map((copy) => copy.startsAt.getTime())));
    const latest = new Date(Math.max(...copies.map((copy) => copy.endsAt.getTime())));
    const existing = await tx
      .select({
        userId: rosterShifts.userId,
        startsAt: rosterShifts.startsAt,
        endsAt: rosterShifts.endsAt,
      })
      .from(rosterShifts)
      .where(
        and(
          eq(rosterShifts.tenantId, ctx.tenantId),
          inArray(rosterShifts.userId, people),
          isNull(rosterShifts.deletedAt),
          lt(rosterShifts.startsAt, latest),
          gt(rosterShifts.endsAt, earliest),
        ),
      );
    for (const shift of existing) {
      if (!shift.userId) continue;
      taken.set(shift.userId, [...(taken.get(shift.userId) ?? []), shift]);
    }
  }
  const kept = copies.filter((copy) => {
    if (!copy.userId) return true;
    const theirs = taken.get(copy.userId) ?? [];
    if (theirs.some((other) => other.startsAt < copy.endsAt && other.endsAt > copy.startsAt)) {
      return false;
    }
    taken.set(copy.userId, [...theirs, copy]);
    return true;
  });

  if (kept.length > 0) await tx.insert(rosterShifts).values(kept);
  return { copied: kept.length, skipped: copies.length - kept.length };
}

export async function createRoster(
  ctx: TenantContext,
  input: CreateRosterInput,
): Promise<{ id: string; copiedShifts: number; skippedShifts: number }> {
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

    const copy = input.copyPrevious
      ? await copyFromPrevious(tx, ctx, created)
      : { copied: 0, skipped: 0 };
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'roster',
      entityId: created.id,
      context: {
        startsOn: created.startsOn,
        endsOn: created.endsOn,
        copiedShifts: copy.copied,
        skippedShifts: copy.skipped,
      },
    });
    return { id: created.id, copiedShifts: copy.copied, skippedShifts: copy.skipped };
  });
}

export type PublishOutcome = {
  id: string;
  /** Shifts that were added, changed or removed since the last publish. */
  published: number;
  emailed: number;
  /** False when email was asked for but the server has no mail provider set up. */
  emailConfigured: boolean;
};

/**
 * Shows staff the roster as it now stands. Every shift with unpublished changes becomes
 * visible to its person, and removals are marked as announced. Email is optional and goes out
 * after the change is saved, so a mail failure never undoes a publish.
 */
export async function publishRoster(
  ctx: TenantContext,
  input: PublishRosterInput,
): Promise<PublishOutcome> {
  requirePermission(ctx, 'rosters.manage');
  const timezone = ctx.tenant.timezone;

  const result = await withRls(ctx, async (tx) => {
    const roster = await loadRoster(tx, ctx, input.id);
    assertNotAuthorised(roster);
    const inRoster = and(
      eq(rosterShifts.tenantId, ctx.tenantId),
      eq(rosterShifts.rosterId, roster.id),
    );
    const shifts = await tx
      .select({
        userId: rosterShifts.userId,
        teamId: rosterShifts.teamId,
        startsAt: rosterShifts.startsAt,
        endsAt: rosterShifts.endsAt,
        deletedAt: rosterShifts.deletedAt,
        unpublishedChanges: rosterShifts.unpublishedChanges,
      })
      .from(rosterShifts)
      .where(inRoster)
      .orderBy(rosterShifts.startsAt);
    const pending = shifts.filter((shift) => shift.unpublishedChanges);
    const live = shifts.filter((shift) => !shift.deletedAt);

    await tx
      .update(rosterShifts)
      .set({ publishedAt: sql`now()`, unpublishedChanges: false })
      .where(and(inRoster, isNull(rosterShifts.deletedAt), rosterShifts.unpublishedChanges));
    await tx
      .update(rosterShifts)
      .set({ unpublishedChanges: false })
      .where(and(inRoster, isNotNull(rosterShifts.deletedAt), rosterShifts.unpublishedChanges));
    if (roster.status !== 'published') {
      await tx
        .update(rosters)
        .set({
          status: 'published',
          publishedAt: new Date(),
          publishedBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .where(and(eq(rosters.tenantId, ctx.tenantId), eq(rosters.id, roster.id)));
    }
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'roster',
      entityId: roster.id,
      changes: roster.status === 'published' ? null : { status: [roster.status, 'published'] },
      context: { publishedShifts: pending.length, scope: input.scope, notify: input.notify },
    });

    if (!input.notify) return { roster, published: pending.length, mail: [] };

    const peopleOn = (rows: typeof shifts) => rows.flatMap((shift) => shift.userId ?? []);
    const skip = new Set(input.skipUserIds);
    const recipientIds = [
      ...new Set([...peopleOn(pending), ...(input.scope === 'all' ? peopleOn(live) : [])]),
    ].filter((userId) => !skip.has(userId));
    if (recipientIds.length === 0) return { roster, published: pending.length, mail: [] };

    const people = await tx
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, recipientIds));
    const teams = await tx
      .select({ id: rosterTeams.id, name: rosterTeams.name })
      .from(rosterTeams)
      .where(and(eq(rosterTeams.tenantId, ctx.tenantId), isNull(rosterTeams.deletedAt)));
    const teamName = new Map(teams.map((team) => [team.id, team.name]));

    const mail = people.map((person) => {
      const own: NotifiedShift[] = live
        .filter((shift) => shift.userId === person.id)
        .map((shift) => {
          const start = instantToZoned(timezone, shift.startsAt);
          return {
            date: start.date,
            startTime: start.time,
            endTime: instantToZoned(timezone, shift.endsAt).time,
            team: shift.teamId ? (teamName.get(shift.teamId) ?? null) : null,
          };
        });
      return {
        to: person.email,
        ...rosterEmail({
          workspace: ctx.tenant.name,
          fullName: person.fullName,
          startsOn: roster.startsOn,
          endsOn: roster.endsOn,
          shifts: own,
          message: input.message,
          color: ctx.tenant.primaryColor,
        }),
      };
    });
    return { roster, published: pending.length, mail };
  });

  const sent = await Promise.all(result.mail.map((message) => sendEmail(message)));
  return {
    id: result.roster.id,
    published: result.published,
    emailed: sent.filter((outcome) => outcome.sent).length,
    emailConfigured: !input.notify || isEmailConfigured(),
  };
}

/** Hides the whole roster from staff again; every shift goes back to unpublished. */
export async function unpublishRoster(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'rosters.manage');
  return withRls(ctx, async (tx) => {
    const roster = await loadRoster(tx, ctx, id);
    assertNotAuthorised(roster);
    if (roster.status === 'draft') return { id };
    await tx
      .update(rosters)
      .set({ status: 'draft', publishedAt: null, publishedBy: null, updatedBy: ctx.userId })
      .where(and(eq(rosters.tenantId, ctx.tenantId), eq(rosters.id, id)));
    await tx
      .update(rosterShifts)
      .set({ publishedAt: null, unpublishedChanges: true })
      .where(
        and(
          eq(rosterShifts.tenantId, ctx.tenantId),
          eq(rosterShifts.rosterId, id),
          isNull(rosterShifts.deletedAt),
        ),
      );
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'roster',
      entityId: id,
      changes: { status: [roster.status, 'draft'] },
    });
    return { id };
  });
}

export async function deleteRoster(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'rosters.manage');
  return withRls(ctx, async (tx) => {
    assertNotAuthorised(await loadRoster(tx, ctx, id));
    const now = new Date();
    await tx
      .update(rosterShifts)
      .set({ deletedAt: now, unpublishedChanges: false, updatedBy: ctx.userId })
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
    const totalBreak = input.breaks.reduce((sum, item) => sum + item.minutes, 0);
    if (totalBreak >= lengthMinutes) {
      throw new AppError('VALIDATION', 'The breaks are as long as the shift.', {
        breaks: ['Make the breaks shorter than the shift'],
      });
    }

    if (input.userId && !(await activeMemberIds(tx, ctx)).has(input.userId)) {
      throw new AppError('VALIDATION', 'That person is not an active member of this workspace.', {
        userId: ['Choose an active member'],
      });
    }
    if (input.teamId) {
      if (!(await liveTeamIds(tx, ctx)).has(input.teamId)) {
        throw new AppError('VALIDATION', 'That team was not found.', {
          teamId: ['Choose a team from the list'],
        });
      }
      if (input.userId) {
        const [member] = await tx
          .select({ userId: rosterTeamMembers.userId })
          .from(rosterTeamMembers)
          .where(
            and(
              eq(rosterTeamMembers.tenantId, ctx.tenantId),
              eq(rosterTeamMembers.teamId, input.teamId),
              eq(rosterTeamMembers.userId, input.userId),
            ),
          )
          .limit(1);
        if (!member) {
          throw new AppError('VALIDATION', 'This person is not in that team.', {
            teamId: ['Choose one of this person\u2019s teams, or add them to this one'],
          });
        }
      }
    }
    if (input.userId) {
      await assertNoOverlap(tx, ctx, {
        userId: input.userId,
        startsAt,
        endsAt,
        exceptId: input.id,
      });
    }

    const values = {
      userId: input.userId,
      teamId: input.teamId,
      startsAt,
      endsAt,
      breakMinutes: unpaidMinutes(input.breaks),
      breaks: input.breaks,
      autoBreaks: input.autoBreaks,
      note: input.note,
      // Staff are not shown the change until the roster is published again.
      unpublishedChanges: true,
      updatedBy: ctx.userId,
    };

    if (input.id) {
      const [before] = await tx
        .select({ userId: rosterShifts.userId, publishedAt: rosterShifts.publishedAt })
        .from(rosterShifts)
        .where(
          and(
            eq(rosterShifts.tenantId, ctx.tenantId),
            eq(rosterShifts.id, input.id),
            eq(rosterShifts.rosterId, roster.id),
            isNull(rosterShifts.deletedAt),
          ),
        )
        .limit(1);
      if (!before) throw new AppError('NOT_FOUND', 'That shift was not found.');
      // A shift someone has already been told about, moved to someone else: it is taken off
      // them like a removed shift (so publishing tells them) and given anew to the other person.
      if (before.publishedAt && before.userId && before.userId !== input.userId) {
        await tx
          .update(rosterShifts)
          .set({ deletedAt: new Date(), unpublishedChanges: true, updatedBy: ctx.userId })
          .where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.id, input.id)));
        const [moved] = await tx
          .insert(rosterShifts)
          .values({ ...values, tenantId: ctx.tenantId, rosterId: roster.id, createdBy: ctx.userId })
          .returning({ id: rosterShifts.id });
        if (!moved) throw new AppError('INTERNAL', 'Could not save the shift.');
        await audit(tx, ctx, {
          action: 'update',
          entityType: 'roster_shift',
          entityId: moved.id,
          changes: { userId: [before.userId, input.userId] },
          context: { replacesShift: input.id },
        });
        return moved;
      }
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
      .select({ rosterId: rosterShifts.rosterId, publishedAt: rosterShifts.publishedAt })
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
      // Removing a shift staff have seen is a change they still need to be told about.
      .set({
        deletedAt: new Date(),
        unpublishedChanges: shift.publishedAt !== null,
        updatedBy: ctx.userId,
      })
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

/**
 * Repeats a shift on other days of the same roster, for the same person and team. A day the
 * person is already working is refused rather than skipped, so nothing is half done.
 */
export async function copyShift(
  ctx: TenantContext,
  input: CopyShiftInput,
): Promise<{ created: number }> {
  requirePermission(ctx, 'rosters.manage');
  return withRls(ctx, async (tx) => {
    const [source] = await tx
      .select()
      .from(rosterShifts)
      .where(
        and(
          eq(rosterShifts.tenantId, ctx.tenantId),
          eq(rosterShifts.id, input.id),
          isNull(rosterShifts.deletedAt),
        ),
      )
      .limit(1);
    if (!source) throw new AppError('NOT_FOUND', 'That shift was not found.');
    const roster = await loadRoster(tx, ctx, source.rosterId);
    assertNotAuthorised(roster);

    const timezone = ctx.tenant.timezone;
    const start = instantToZoned(timezone, source.startsAt);
    const end = instantToZoned(timezone, source.endsAt);
    const dates = [...new Set(input.dates)].filter((date) => date !== start.date);
    if (dates.some((date) => date < roster.startsOn || date > roster.endsOn)) {
      throw new AppError('VALIDATION', 'One of those days is outside this roster.', {
        dates: ['Choose days inside this roster'],
      });
    }

    const copies = [];
    for (const date of dates) {
      const instants = shiftInstants(timezone, date, start.time, end.time);
      if (source.userId) await assertNoOverlap(tx, ctx, { userId: source.userId, ...instants });
      copies.push({
        tenantId: ctx.tenantId,
        rosterId: roster.id,
        userId: source.userId,
        teamId: source.teamId,
        ...instants,
        breakMinutes: source.breakMinutes,
        breaks: source.breaks,
        autoBreaks: source.autoBreaks,
        note: source.note,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
    }
    if (copies.length === 0) return { created: 0 };
    const created = await tx.insert(rosterShifts).values(copies).returning({ id: rosterShifts.id });
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'roster_shift',
      entityId: source.id,
      context: { copiedTo: dates, created: created.map((row) => row.id) },
    });
    return { created: created.length };
  });
}

/** Creates a team, or renames, recolours and re-staffs the one named by `input.id`. */
export async function saveTeam(ctx: TenantContext, input: SaveTeamInput): Promise<{ id: string }> {
  requirePermission(ctx, 'rosters.manage');
  return withRls(ctx, async (tx) => {
    const [clash] = await tx
      .select({ id: rosterTeams.id })
      .from(rosterTeams)
      .where(
        and(
          eq(rosterTeams.tenantId, ctx.tenantId),
          isNull(rosterTeams.deletedAt),
          sql`lower(${rosterTeams.name}) = lower(${input.name})`,
          input.id ? ne(rosterTeams.id, input.id) : undefined,
        ),
      )
      .limit(1);
    if (clash) {
      throw new AppError('DUPLICATE', 'There is already a team with that name.', {
        name: ['Choose a name no other team uses'],
      });
    }
    const active = await activeMemberIds(tx, ctx);
    const memberIds = [...new Set(input.memberIds)];
    if (memberIds.some((userId) => !active.has(userId))) {
      throw new AppError('VALIDATION', 'One of those people is not an active member.', {
        memberIds: ['Choose active members only'],
      });
    }

    let id = input.id;
    if (id) {
      const [updated] = await tx
        .update(rosterTeams)
        .set({ name: input.name, color: input.color, updatedBy: ctx.userId })
        .where(
          and(
            eq(rosterTeams.tenantId, ctx.tenantId),
            eq(rosterTeams.id, id),
            isNull(rosterTeams.deletedAt),
          ),
        )
        .returning({ id: rosterTeams.id });
      if (!updated) throw new AppError('NOT_FOUND', 'That team was not found.');
    } else {
      const [created] = await tx
        .insert(rosterTeams)
        .values({
          tenantId: ctx.tenantId,
          name: input.name,
          color: input.color,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: rosterTeams.id });
      if (!created) throw new AppError('INTERNAL', 'Could not save the team.');
      id = created.id;
    }

    const inTeam = and(
      eq(rosterTeamMembers.tenantId, ctx.tenantId),
      eq(rosterTeamMembers.teamId, id),
    );
    const current = await tx
      .select({ userId: rosterTeamMembers.userId })
      .from(rosterTeamMembers)
      .where(inTeam);
    const had = new Set(current.map((row) => row.userId));
    const leaving = [...had].filter((userId) => !memberIds.includes(userId));
    const joining = memberIds.filter((userId) => !had.has(userId));
    if (leaving.length > 0) {
      await tx
        .delete(rosterTeamMembers)
        .where(and(inTeam, inArray(rosterTeamMembers.userId, leaving)));
    }
    if (joining.length > 0) {
      const teamId = id;
      await tx.insert(rosterTeamMembers).values(
        joining.map((userId) => ({
          tenantId: ctx.tenantId,
          teamId,
          userId,
          createdBy: ctx.userId,
        })),
      );
    }
    await audit(tx, ctx, {
      action: input.id ? 'update' : 'create',
      entityType: 'roster_team',
      entityId: id,
      context: { name: input.name, joined: joining.length, left: leaving.length },
    });
    return { id };
  });
}

/** Removes a team from the list. Shifts already in it stay as they are, without a team. */
export async function deleteTeam(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'rosters.manage');
  return withRls(ctx, async (tx) => {
    const [removed] = await tx
      .update(rosterTeams)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(rosterTeams.tenantId, ctx.tenantId),
          eq(rosterTeams.id, id),
          isNull(rosterTeams.deletedAt),
        ),
      )
      .returning({ id: rosterTeams.id });
    if (!removed) throw new AppError('NOT_FOUND', 'That team was not found.');
    await tx
      .delete(rosterTeamMembers)
      .where(and(eq(rosterTeamMembers.tenantId, ctx.tenantId), eq(rosterTeamMembers.teamId, id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'roster_team', entityId: id });
    return removed;
  });
}

/** Saves what weekends and public holidays pay, and which breaks a shift gets by itself. */
export async function saveRules(
  ctx: TenantContext,
  input: SaveRulesInput,
): Promise<{ saved: true }> {
  requirePermission(ctx, 'rosters.manage');
  const values = {
    saturdayLoading: input.saturday.toFixed(2),
    sundayLoading: input.sunday.toFixed(2),
    publicHolidayLoading: input.publicHoliday.toFixed(2),
    breakRules: [...input.breakRules].sort((a, b) => a.fromMinutes - b.fromMinutes),
    updatedBy: ctx.userId,
  };
  return withRls(ctx, async (tx) => {
    await tx
      .insert(workforceSettings)
      .values({ ...values, tenantId: ctx.tenantId, createdBy: ctx.userId })
      .onConflictDoUpdate({ target: workforceSettings.tenantId, set: values });
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'workforce_settings',
      entityId: ctx.tenantId,
      context: {
        saturday: input.saturday,
        sunday: input.sunday,
        publicHoliday: input.publicHoliday,
        breakRules: input.breakRules.length,
      },
    });
    return { saved: true as const };
  });
}

export async function addHoliday(
  ctx: TenantContext,
  input: AddHolidayInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'rosters.manage');
  return withRls(ctx, async (tx) => {
    const [clash] = await tx
      .select({ id: publicHolidays.id })
      .from(publicHolidays)
      .where(and(eq(publicHolidays.tenantId, ctx.tenantId), eq(publicHolidays.day, input.day)))
      .limit(1);
    if (clash) {
      throw new AppError('DUPLICATE', 'That day is already on the list.', {
        day: ['Choose a day that is not listed yet'],
      });
    }
    const [created] = await tx
      .insert(publicHolidays)
      .values({ tenantId: ctx.tenantId, day: input.day, name: input.name, createdBy: ctx.userId })
      .returning({ id: publicHolidays.id });
    if (!created) throw new AppError('INTERNAL', 'Could not add the holiday.');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'public_holiday',
      entityId: created.id,
      context: { day: input.day },
    });
    return created;
  });
}

export async function removeHoliday(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'rosters.manage');
  return withRls(ctx, async (tx) => {
    const [removed] = await tx
      .delete(publicHolidays)
      .where(and(eq(publicHolidays.tenantId, ctx.tenantId), eq(publicHolidays.id, id)))
      .returning({ id: publicHolidays.id });
    if (!removed) throw new AppError('NOT_FOUND', 'That holiday was not found.');
    await audit(tx, ctx, { action: 'delete', entityType: 'public_holiday', entityId: id });
    return removed;
  });
}
