import 'server-only';

import { addDaysToDate } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { logActivity } from '@/modules/activities/service';
import type { SaveInvoiceInput } from '@/modules/invoices/schemas';
import { saveInvoice } from '@/modules/invoices/service';
import { listActiveMembers } from '@/modules/members/queries';
import { getRosterForDate } from '@/modules/roster/queries';
import { createRoster, saveShift } from '@/modules/roster/service';
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
 * see nothing until the manager publishes. Shifts are only ever added, never replacing one that is
 * there; any the roster service refuses (a clash, a locked roster) are reported back, not forced.
 */
export async function approveRosterPreview(
  ctx: TenantContext,
  input: ApproveRosterInput,
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
  });
  return { saved: saved.length, skipped, firstDate: shifts[0]?.date ?? null };
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
