import 'server-only';

import { and, eq, gt, inArray, sql } from 'drizzle-orm';

import { aiPendingActions } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { emailStaff } from '@/modules/members/service';
import { staffEmailSchema } from '@/modules/members/schemas';
import { saveInvoice } from '@/modules/invoices/service';
import { moveStageSchema } from '@/modules/opportunities/schemas';
import { moveStage } from '@/modules/opportunities/service';
import { saveRosterShiftsSchema } from '@/modules/roster/schemas';
import { saveRosterShifts } from '@/modules/roster/service';
import { createTaskSchema } from '@/modules/tasks/schemas';
import { createTask } from '@/modules/tasks/service';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import {
  PAYLOAD_SCHEMAS,
  invoiceTotals,
  pendingEditSchema,
  type PendingActionView,
  type PendingEdit,
  type PendingPayload,
  type PendingStatus,
} from './pending-schemas';

/*
 * The approval half of Meroidea AI (ADR-064). The model can only call createPendingAction();
 * everything that changes the business happens in approvePendingAction(), which only a signed-in
 * person can reach, for a proposal only they made, through the module's own service.
 */

type Row = typeof aiPendingActions.$inferSelect;
type ActionResult = NonNullable<PendingActionView['result']>;

const live = (ctx: TenantContext, id: string) =>
  and(
    eq(aiPendingActions.tenantId, ctx.tenantId),
    eq(aiPendingActions.id, id),
    // RLS already limits rows to the person who asked; saying so here keeps the query honest.
    eq(aiPendingActions.createdBy, ctx.userId),
  );

function toView(row: Row, now = new Date()): PendingActionView {
  const lapsed = row.status === 'pending' && row.expiresAt <= now;
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload,
    summary: row.summary,
    status: lapsed ? 'expired' : (row.status as PendingStatus),
    error: row.error,
    result: (row.result as ActionResult | null) ?? null,
    expiresAt: row.expiresAt.toISOString(),
  } as PendingActionView;
}

/** One line for the card header and the conversation, in plain words. */
export function summarize(proposal: PendingPayload, currency: string): string {
  switch (proposal.kind) {
    case 'invoice': {
      const { invoice } = proposal.payload;
      const { total } = invoiceTotals(invoice);
      const lines = invoice.lines.length;
      return `Draft invoice for ${invoice.customerName}: ${lines} ${lines === 1 ? 'line' : 'lines'}, ${currency} ${total} due ${invoice.dueDate}`;
    }
    case 'roster': {
      const { shifts, startsOn, span } = proposal.payload;
      const people = new Set(shifts.map((shift) => shift.userId)).size;
      return `${shifts.length} ${shifts.length === 1 ? 'shift' : 'shifts'} for ${people} ${people === 1 ? 'person' : 'people'} on the ${span} from ${startsOn} (unpublished)`;
    }
    case 'staff_email': {
      const count = proposal.payload.recipients.length;
      return `Email to ${count} staff ${count === 1 ? 'member' : 'members'}: “${proposal.payload.subject}”`;
    }
    case 'record_update': {
      const change = proposal.payload;
      return change.change === 'move_stage'
        ? `Move “${change.opportunityName}” from ${change.fromStageName} to ${change.stageName}`
        : `Task: ${change.title}${change.dueDate ? ` (due ${change.dueDate})` : ''}${change.assigneeName ? ` for ${change.assigneeName}` : ''}`;
    }
  }
}

function validate(proposal: PendingPayload): PendingPayload {
  const parsed = PAYLOAD_SCHEMAS[proposal.kind].safeParse(proposal.payload);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION',
      parsed.error.issues[0]?.message ?? 'That proposal is not valid.',
    );
  }
  return { kind: proposal.kind, payload: parsed.data } as PendingPayload;
}

/**
 * Records a proposal for the person to decide. Writes nothing else. A revision names the
 * proposal it replaces, which is withdrawn in the same transaction so only one card can act.
 */
export async function createPendingAction(
  ctx: TenantContext,
  proposal: PendingPayload,
  replaces: string | null = null,
): Promise<PendingActionView> {
  requirePermission(ctx, 'assistant.use');
  const valid = validate(proposal);
  return withRls(ctx, async (tx) => {
    if (replaces) {
      await tx
        .update(aiPendingActions)
        .set({
          status: 'rejected',
          error: 'Replaced by a revised proposal.',
          decidedBy: ctx.userId,
          decidedAt: new Date(),
        })
        .where(and(live(ctx, replaces), eq(aiPendingActions.status, 'pending')));
    }
    const [row] = await tx
      .insert(aiPendingActions)
      .values({
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        kind: valid.kind,
        payload: valid.payload,
        summary: summarize(valid, ctx.tenant.currency),
      })
      .returning();
    if (!row) throw new AppError('INTERNAL', 'Could not save the proposal.');
    return toView(row);
  });
}

/** The person's own proposals among `ids`; anything else is silently left out. */
export async function listPendingActions(
  ctx: TenantContext,
  ids: string[],
): Promise<PendingActionView[]> {
  if (ids.length === 0) return [];
  const rows = await withRls(ctx, (tx) =>
    tx
      .select()
      .from(aiPendingActions)
      .where(
        and(
          eq(aiPendingActions.tenantId, ctx.tenantId),
          eq(aiPendingActions.createdBy, ctx.userId),
          inArray(aiPendingActions.id, ids.slice(0, 50)),
        ),
      ),
  );
  return rows.map((row) => toView(row));
}

export async function getPendingAction(ctx: TenantContext, id: string): Promise<PendingActionView> {
  const [row] = await withRls(ctx, (tx) =>
    tx.select().from(aiPendingActions).where(live(ctx, id)).limit(1),
  );
  if (!row) throw new AppError('NOT_FOUND', 'That proposal was not found.');
  return toView(row);
}

/** Why a proposal that is not pending (or has lapsed) cannot be acted on, as an error to throw. */
async function notActionable(tx: Tx, ctx: TenantContext, id: string): Promise<AppError> {
  const [row] = await tx.select().from(aiPendingActions).where(live(ctx, id)).limit(1);
  if (!row) return new AppError('NOT_FOUND', 'That proposal was not found.');
  if (row.status === 'pending') {
    await tx
      .update(aiPendingActions)
      .set({ status: 'expired' })
      .where(and(live(ctx, id), eq(aiPendingActions.status, 'pending')));
    return new AppError('CONFLICT', 'This proposal has expired. Ask the assistant again.');
  }
  return new AppError('CONFLICT', 'This proposal has already been decided.');
}

const stillPending = (ctx: TenantContext, id: string) =>
  and(
    live(ctx, id),
    eq(aiPendingActions.status, 'pending'),
    gt(aiPendingActions.expiresAt, sql`now()`),
  );

/** Applies the person's own edits from the card; the result is validated as a whole again. */
export async function editPendingAction(
  ctx: TenantContext,
  id: string,
  rawEdit: PendingEdit,
): Promise<PendingActionView> {
  requirePermission(ctx, 'assistant.use');
  const edit = pendingEditSchema.parse(rawEdit);
  return withRls(ctx, async (tx) => {
    const [row] = await tx.select().from(aiPendingActions).where(stillPending(ctx, id)).limit(1);
    if (!row) throw await notActionable(tx, ctx, id);
    const current = toView(row);
    if (current.kind !== edit.kind) {
      throw new AppError('VALIDATION', 'That edit does not match this proposal.');
    }

    let next: PendingPayload;
    if (current.kind === 'invoice' && edit.kind === 'invoice') {
      next = { kind: 'invoice', payload: { invoice: edit.invoice } };
    } else if (current.kind === 'staff_email' && edit.kind === 'staff_email') {
      // Recipients can be dropped, never added: adding people is a new proposal.
      const keep = new Set(edit.userIds);
      const recipients = current.payload.recipients.filter((person) => keep.has(person.userId));
      if (recipients.length !== keep.size) {
        throw new AppError('VALIDATION', 'Ask the assistant to add recipients.');
      }
      next = {
        kind: 'staff_email',
        payload: { recipients, subject: edit.subject, body: edit.body },
      };
    } else if (current.kind === 'roster' && edit.kind === 'roster') {
      // Shifts can be dropped or retimed, never moved to another person or day.
      const names = new Map(current.payload.shifts.map((s) => [`${s.userId}|${s.date}`, s]));
      const shifts = edit.shifts.map((shift) => {
        const before = names.get(`${shift.userId}|${shift.date}`);
        if (!before) throw new AppError('VALIDATION', 'Ask the assistant to add or move shifts.');
        return { ...shift, personName: before.personName };
      });
      next = { kind: 'roster', payload: { ...current.payload, shifts } };
    } else if (
      current.kind === 'record_update' &&
      edit.kind === 'record_update' &&
      current.payload.change === 'create_task'
    ) {
      next = {
        kind: 'record_update',
        payload: {
          ...current.payload,
          title: edit.title,
          dueDate: edit.dueDate,
          priority: edit.priority,
        },
      };
    } else {
      throw new AppError('VALIDATION', 'Ask the assistant to revise this one.');
    }

    const valid = validate(next);
    const [updated] = await tx
      .update(aiPendingActions)
      .set({ payload: valid.payload, summary: summarize(valid, ctx.tenant.currency), error: null })
      .where(stillPending(ctx, id))
      .returning();
    if (!updated) throw await notActionable(tx, ctx, id);
    return toView(updated);
  });
}

export async function rejectPendingAction(
  ctx: TenantContext,
  id: string,
): Promise<PendingActionView> {
  requirePermission(ctx, 'assistant.use');
  return withRls(ctx, async (tx) => {
    const [row] = await tx
      .update(aiPendingActions)
      .set({ status: 'rejected', decidedBy: ctx.userId, decidedAt: new Date() })
      .where(and(live(ctx, id), eq(aiPendingActions.status, 'pending')))
      .returning();
    if (!row) throw await notActionable(tx, ctx, id);
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'ai_pending_action',
      entityId: row.id,
      context: { aiProposed: true, decision: 'rejected', kind: row.kind },
    });
    return toView(row);
  });
}

/** Runs the module's own service, as the approving person, for one validated proposal. */
async function execute(ctx: TenantContext, proposal: PendingPayload): Promise<ActionResult> {
  switch (proposal.kind) {
    case 'invoice': {
      const saved = await saveInvoice(ctx, proposal.payload.invoice);
      return {
        entityType: 'invoice',
        entityId: saved.id,
        href: `/invoices/${saved.id}`,
        note: `Draft invoice #${saved.number} created. It has not been sent.`,
      };
    }
    case 'roster': {
      const { startsOn, span, shifts } = proposal.payload;
      const saved = await saveRosterShifts(
        ctx,
        saveRosterShiftsSchema.parse({
          startsOn,
          span,
          shifts: shifts.map((shift) => ({
            userId: shift.userId,
            date: shift.date,
            startTime: shift.startTime,
            endTime: shift.endTime,
            note: shift.note,
          })),
        }),
      );
      return {
        entityType: 'roster',
        entityId: saved.rosterId,
        href: `/roster?date=${startsOn}`,
        note: `${saved.shifts} ${saved.shifts === 1 ? 'shift' : 'shifts'} added${saved.createdRoster ? ' to a new roster' : ''}. Not published yet.`,
      };
    }
    case 'staff_email': {
      const { recipients, subject, body } = proposal.payload;
      const outcome = await emailStaff(
        ctx,
        staffEmailSchema.parse({ userIds: recipients.map((r) => r.userId), subject, body }),
      );
      // Nothing left the building: safe to let the person try again.
      if (outcome.sent === 0) {
        throw new AppError('CONFLICT', 'The email provider did not accept the message. Try again.');
      }
      return {
        entityType: 'staff_email',
        entityId: null,
        href: null,
        note: `Sent to ${outcome.sent} of ${outcome.recipients}${outcome.failed ? `; ${outcome.failed} could not be delivered` : ''}.`,
      };
    }
    case 'record_update': {
      const change = proposal.payload;
      if (change.change === 'move_stage') {
        const moved = await moveStage(
          ctx,
          moveStageSchema.parse({
            id: change.opportunityId,
            stageId: change.stageId,
            lostReasonId: change.lostReasonId ?? '',
          }),
        );
        return {
          entityType: 'opportunity',
          entityId: moved.id,
          href: `/opportunities/${moved.id}`,
          note: moved.pendingApproval
            ? `Sent for approval to move to ${change.stageName}.`
            : `Moved to ${change.stageName}.`,
        };
      }
      const task = await createTask(
        ctx,
        createTaskSchema.parse({
          title: change.title,
          type: change.taskType,
          priority: change.priority,
          dueDate: change.dueDate ?? '',
          assignedTo: change.assignedTo ?? '',
          contactId: change.contactId ?? undefined,
          opportunityId: change.opportunityId ?? undefined,
        }),
      );
      return { entityType: 'task', entityId: task.id, href: '/tasks', note: 'Task created.' };
    }
  }
}

/**
 * Approves a proposal: claims it atomically (pending → executing, only for the person who made
 * it and only before it lapses, so a double click or a second tab cannot run it twice), runs it
 * through the module service as that person, then records the outcome with an audit row saying
 * it was proposed by the assistant and approved by them.
 *
 * When a service refuses with a business reason (an AppError: a permission, a clash, a rule),
 * its own transaction wrote nothing, so the proposal goes back to pending with the reason shown
 * on the card, to edit or cancel. Anything unexpected marks it failed for good: we cannot be
 * sure nothing happened, so it must not run again.
 */
export async function approvePendingAction(
  ctx: TenantContext,
  id: string,
): Promise<PendingActionView> {
  requirePermission(ctx, 'assistant.use');

  const claimed = await withRls(ctx, async (tx) => {
    const [row] = await tx
      .update(aiPendingActions)
      .set({ status: 'executing', decidedBy: ctx.userId, decidedAt: new Date(), error: null })
      .where(stillPending(ctx, id))
      .returning();
    if (!row) throw await notActionable(tx, ctx, id);
    return row;
  });

  const view = toView(claimed);
  const proposal = { kind: view.kind, payload: view.payload } as PendingPayload;

  let result: ActionResult;
  try {
    result = await execute(ctx, validate(proposal));
  } catch (error) {
    const known = error instanceof AppError;
    if (!known) {
      console.error('[assistant] approval failed', error instanceof Error ? error.name : 'unknown');
    }
    const message = known
      ? error.message
      : 'Something went wrong while applying this. Check the record before trying again.';
    const [row] = await withRls(ctx, (tx) =>
      tx
        .update(aiPendingActions)
        .set(
          known
            ? { status: 'pending', error: message, decidedBy: null, decidedAt: null }
            : { status: 'failed', error: message },
        )
        .where(and(live(ctx, id), eq(aiPendingActions.status, 'executing')))
        .returning(),
    );
    if (known) throw error;
    return row ? toView(row) : { ...view, status: 'failed', error: message };
  }

  return withRls(ctx, async (tx) => {
    const [row] = await tx
      .update(aiPendingActions)
      .set({ status: 'approved', result })
      .where(and(live(ctx, id), eq(aiPendingActions.status, 'executing')))
      .returning();
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'ai_pending_action',
      entityId: id,
      context: {
        aiProposed: true,
        decision: 'approved',
        approvedBy: ctx.userId,
        kind: view.kind,
        resultEntityType: result.entityType,
        resultEntityId: result.entityId,
      },
    });
    return row ? toView(row) : { ...view, status: 'approved', result };
  });
}
