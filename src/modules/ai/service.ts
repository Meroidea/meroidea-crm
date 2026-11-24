import 'server-only';

import { addDaysToDate } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { logActivity } from '@/modules/activities/service';
import type { SaveInvoiceInput } from '@/modules/invoices/schemas';
import { saveInvoice } from '@/modules/invoices/service';
import { listActiveMembers } from '@/modules/members/queries';
import { getRosterForDate, rostersOfShifts } from '@/modules/roster/queries';
import { createRoster, removeShifts, saveShift } from '@/modules/roster/service';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { ApproveNoteInput, ApproveRosterInput } from './schemas';
import type { RosterApprovalResult } from './types';

/**
 * Saving what a person approved in the assistant (ADR-074). The assistant itself never writes;
 * these run only from the person's own click, through each module's ordinary service, which
 * checks permission, scope and every business rule again as if the person had typed the values.
 * Each service audits its own change; an `ai_approve` row then records that it began as a draft.
 */

async function recordApproval(
  ctx: TenantContext,
  entityType: string,
  entityId: string | null,
  context: Record<string, unknown>,
): Promise<void> {
  await withRls(ctx, (tx) =>
    audit(tx, ctx, { action: 'ai_approve', entityType, entityId, context }),
  );
}

/** Saves an approved invoice preview as a draft. Sending stays a separate step on the invoice. */
export async function approveInvoiceDraft(
  ctx: TenantContext,
  input: SaveInvoiceInput,
): Promise<{ id: string; number: number }> {
  requirePermission(ctx, 'invoices.manage');
  // Always a new draft: an approval can never overwrite an existing invoice.
  const saved = await saveInvoice(ctx, { ...input, id: undefined });
  await recordApproval(ctx, 'invoice', saved.id, { lines: input.lines.length });
  return saved;
}

/**
 * Adds an approved roster preview's shifts. Each one is saved as an unpublished change, so staff
 * see nothing until the manager publishes. Shifts already there stay, unless the manager asked the
 * roster agent to replace them (ADR-079), in which case those are removed first; any shift the
 * roster service refuses (a clash, a locked roster) is reported back, not forced.
 */
export async function approveRosterPreview(
  ctx: TenantContext,
  input: Omit<ApproveRosterInput, 'replaceShiftIds'> & { replaceShiftIds?: string[] },
): Promise<RosterApprovalResult> {
  requirePermission(ctx, 'rosters.manage');
  const names = new Map(
    (await listActiveMembers(ctx)).map((member) => [member.userId, member.fullName]),
  );
  const covering: { id: string; startsOn: string; endsOn: string }[] = [];
  const uncoverable = new Map<string, string>();

  const rosterFor = async (date: string): Promise<string | null> => {
    const known = covering.find((roster) => roster.startsOn <= date && roster.endsOn >= date);
    if (known) return known.id;
    if (uncoverable.has(date)) return null;
    const found = await getRosterForDate(ctx, date);
    if (found) {
      covering.push(found);
      return found.id;
    }
    try {
      // A day no roster covers gets a new draft week starting that day.
      const created = await createRoster(ctx, {
        startsOn: date,
        span: 'week',
        copyPrevious: false,
      });
      covering.push({ id: created.id, startsOn: date, endsOn: addDaysToDate(date, 6) });
      return created.id;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      uncoverable.set(
        date,
        'No roster covers this day, and a new week from it would overlap another roster. Create one on the Roster page.',
      );
      return null;
    }
  };

  // "Delete existing shifts first" (ADR-079): the shifts the plan replaces go before any is added,
  // one roster at a time, all or nothing within each.
  let removed = 0;
  const replacing = input.replaceShiftIds ?? [];
  if (replacing.length > 0) {
    const byRoster = new Map<string, string[]>();
    for (const [shiftId, rosterId] of await rostersOfShifts(ctx, replacing)) {
      byRoster.set(rosterId, [...(byRoster.get(rosterId) ?? []), shiftId]);
    }
    for (const [rosterId, shiftIds] of byRoster) {
      removed += (await removeShifts(ctx, { rosterId, shiftIds, reason: 'replace' })).removed;
    }
  }

  const shifts = [...input.shifts].sort((a, b) =>
    a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date),
  );
  const saved: string[] = [];
  const skipped: RosterApprovalResult['skipped'] = [];
  for (const shift of shifts) {
    const personName = shift.userId ? (names.get(shift.userId) ?? null) : null;
    const rosterId = await rosterFor(shift.date);
    if (!rosterId) {
      skipped.push({
        date: shift.date,
        startTime: shift.startTime,
        personName,
        reason: uncoverable.get(shift.date) ?? 'No roster covers this day.',
      });
      continue;
    }
    try {
      const result = await saveShift(ctx, {
        rosterId,
        userId: shift.userId,
        teamId: shift.teamId,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        breaks: shift.breaks,
        autoBreaks: true,
        note: shift.note,
      });
      saved.push(result.id);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      skipped.push({
        date: shift.date,
        startTime: shift.startTime,
        personName,
        reason: error.message,
      });
    }
  }

  await recordApproval(ctx, 'roster', covering[0]?.id ?? null, {
    rosters: covering.map((roster) => roster.id),
    shiftsSaved: saved.length,
    shiftsSkipped: skipped.length,
    shiftsReplaced: removed,
  });
  return {
    saved: saved.length,
    removed,
    skipped,
    firstDate: shifts[0]?.date ?? null,
    rosterIds: covering.map((roster) => roster.id),
  };
}

/** Saves an approved note on the contact's timeline, as the person, through the activities module. */
export async function approveNote(
  ctx: TenantContext,
  input: ApproveNoteInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'activities.create');
  const created = await logActivity(ctx, {
    type: 'note',
    body: input.body,
    contactId: input.contactId,
  });
  await recordApproval(ctx, 'activity', created.id, { contactId: input.contactId });
  return created;
}

/** A thumbs up or down on the roster agent: the rating and what it was about, nothing more. */
export async function recordRosterFeedback(
  ctx: TenantContext,
  input: { rating: 'up' | 'down'; about: 'plan' | 'check' | 'reply' },
): Promise<{ saved: true }> {
  requirePermission(ctx, 'ai.use');
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_assist',
      entityType: 'ai_assistant',
      entityId: null,
      context: { surface: 'roster_agent', action: 'feedback', ...input },
    }),
  );
  return { saved: true as const };
}
