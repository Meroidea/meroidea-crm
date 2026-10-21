import 'server-only';

import { and, eq, inArray, ne } from 'drizzle-orm';

import {
  concernMessages,
  concerns,
  payslips,
  rolePermissions,
  tenantMemberships,
  users,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { sendEmail } from '@/server/email';
import { serverEnv } from '@/server/env';

import { canHandleConcern } from './queries';
import type { ConcernStatus, RaiseConcernInput } from './schemas';
import { renderEmail } from '@/server/email-template';

/*
 * Questions and concerns (ADR-049): how staff ask the business something, such as the hours on a
 * payslip, a shift or leave, and get an answer. Every read and write runs through RLS, which keeps
 * a question raised with the admin only away from managers; the checks here give clear errors.
 */

const GONE = 'That question was not found.';

async function findConcern(tx: Tx, ctx: TenantContext, id: string) {
  const [concern] = await tx
    .select({
      id: concerns.id,
      raisedBy: concerns.raisedBy,
      raisedWith: concerns.raisedWith,
      status: concerns.status,
    })
    .from(concerns)
    .where(and(eq(concerns.tenantId, ctx.tenantId), eq(concerns.id, id)))
    .limit(1);
  // Outside what the reader may see is "not found", never "forbidden" (rules/security.md).
  if (!concern) throw new AppError('NOT_FOUND', GONE);
  return concern;
}

/**
 * Emails the people who can answer a new question that one is waiting, without what it says: it
 * may be about someone's pay, and inboxes are read on shared screens and phones.
 */
async function notifyHandlers(ctx: TenantContext, input: { id: string; raisedWith: string }) {
  const permissions =
    input.raisedWith === 'manager'
      ? ['concerns.handle', 'concerns.handle_all']
      : ['concerns.handle_all'];
  const recipients = await withRls(ctx, (tx) =>
    tx
      .selectDistinct({ email: users.email })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(
        rolePermissions,
        and(
          eq(rolePermissions.tenantId, tenantMemberships.tenantId),
          eq(rolePermissions.roleId, tenantMemberships.roleId),
        ),
      )
      .where(
        and(
          eq(tenantMemberships.tenantId, ctx.tenantId),
          eq(tenantMemberships.status, 'active'),
          eq(tenantMemberships.isSupport, false),
          ne(tenantMemberships.userId, ctx.userId),
          inArray(rolePermissions.permission, permissions),
        ),
      ),
  );
  const link = new URL(`/concerns/${input.id}`, serverEnv().APP_URL).toString();
  // Says only that a question is waiting: what it is about can concern someone's pay (ADR-049).
  const email = renderEmail({
    sender: { kind: 'platform' },
    preheader: `A question is waiting for an answer in ${ctx.tenant.name}.`,
    heading: 'A question is waiting for you',
    blocks: [
      {
        type: 'paragraph',
        text: `Someone in ${ctx.tenant.name} has asked a question or raised a concern. Sign in to read and answer it.`,
      },
      { type: 'button', label: 'Read and answer it', url: link },
    ],
    reason: `You received this because you answer staff questions in ${ctx.tenant.name}.`,
  });
  for (const { email: to } of recipients) {
    await sendEmail({ to, subject: `A question is waiting in ${ctx.tenant.name}`, ...email });
  }
}

export async function raiseConcern(
  ctx: TenantContext,
  input: RaiseConcernInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'concerns.raise');
  const created = await withRls(ctx, async (tx) => {
    if (input.payslipId) {
      // Only your own released payslip: the payslips policy shows nothing else to staff, and the
      // owner check stops someone who runs payroll filing a question about another person's.
      const [own] = await tx
        .select({ id: payslips.id })
        .from(payslips)
        .where(
          and(
            eq(payslips.tenantId, ctx.tenantId),
            eq(payslips.id, input.payslipId),
            eq(payslips.userId, ctx.userId),
          ),
        )
        .limit(1);
      if (!own) {
        throw new AppError('VALIDATION', 'That payslip was not found.', {
          payslipId: ['Ask about one of your own payslips'],
        });
      }
    }
    const [concern] = await tx
      .insert(concerns)
      .values({
        tenantId: ctx.tenantId,
        raisedBy: ctx.userId,
        raisedWith: input.raisedWith,
        category: input.category,
        subject: input.subject,
        payslipId: input.payslipId,
        status: 'open',
      })
      .returning({ id: concerns.id });
    if (!concern) throw new AppError('INTERNAL', 'The question could not be saved.');
    await tx.insert(concernMessages).values({
      tenantId: ctx.tenantId,
      concernId: concern.id,
      authorUserId: ctx.userId,
      body: input.details,
    });
    // What it says stays out of the audit log, like any other personal content.
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'concern',
      entityId: concern.id,
      context: {
        raisedWith: input.raisedWith,
        category: input.category,
        payslipId: input.payslipId,
      },
    });
    return concern;
  });

  try {
    await notifyHandlers(ctx, { id: created.id, raisedWith: input.raisedWith });
  } catch (cause) {
    // The question is saved either way; it is on the list of whoever answers questions.
    console.error('[concerns] notify failed', {
      name: cause instanceof Error ? cause.name : typeof cause,
    });
  }
  return created;
}

/**
 * Adds to a question's conversation: the person who asked, or someone who may answer it. Replying
 * to one marked resolved reopens it. An answer from the business moves an open question to
 * "being looked at".
 */
export async function replyToConcern(
  ctx: TenantContext,
  input: { id: string; body: string },
): Promise<{ id: string }> {
  requirePermission(ctx, 'concerns.raise');
  return withRls(ctx, async (tx) => {
    const concern = await findConcern(tx, ctx, input.id);
    const handling = canHandleConcern(ctx, concern);
    if (concern.raisedBy !== ctx.userId && !handling) throw new AppError('NOT_FOUND', GONE);
    const next =
      handling && concern.status !== 'in_progress'
        ? 'in_progress'
        : concern.status === 'resolved'
          ? 'open'
          : concern.status;
    // Before the message: a message may only be added to a question that is not resolved.
    if (next !== concern.status) {
      await tx
        .update(concerns)
        .set({ status: next, resolvedAt: null, resolvedBy: null })
        .where(and(eq(concerns.tenantId, ctx.tenantId), eq(concerns.id, concern.id)));
    }
    const [message] = await tx
      .insert(concernMessages)
      .values({
        tenantId: ctx.tenantId,
        concernId: concern.id,
        authorUserId: ctx.userId,
        body: input.body,
      })
      .returning({ id: concernMessages.id });
    if (!message) throw new AppError('INTERNAL', 'The reply could not be saved.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'concern',
      entityId: concern.id,
      context: { replied: true },
      ...(next !== concern.status ? { changes: { status: [concern.status, next] } } : {}),
    });
    return { id: concern.id };
  });
}

/**
 * Moves a question along. Whoever answers it may set any status; the person who asked may mark it
 * resolved when they have their answer, or reopen it.
 */
export async function setConcernStatus(
  ctx: TenantContext,
  input: { id: string; status: ConcernStatus },
): Promise<{ id: string }> {
  requirePermission(ctx, 'concerns.raise');
  return withRls(ctx, async (tx) => {
    const concern = await findConcern(tx, ctx, input.id);
    const asker = concern.raisedBy === ctx.userId;
    if (!asker && !canHandleConcern(ctx, concern)) throw new AppError('NOT_FOUND', GONE);
    if (asker && input.status === 'in_progress') {
      throw new AppError('CONFLICT', 'You can mark your question resolved, or reopen it.');
    }
    if (concern.status === input.status) return { id: concern.id };
    const resolved = input.status === 'resolved';
    await tx
      .update(concerns)
      .set({
        status: input.status,
        resolvedAt: resolved ? new Date() : null,
        resolvedBy: resolved ? ctx.userId : null,
      })
      .where(and(eq(concerns.tenantId, ctx.tenantId), eq(concerns.id, concern.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'concern',
      entityId: concern.id,
      changes: { status: [concern.status, input.status] },
    });
    return { id: concern.id };
  });
}
