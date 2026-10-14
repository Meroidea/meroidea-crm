import 'server-only';

import { and, eq, inArray, ne } from 'drizzle-orm';

import { concernMessages, concerns, rolePermissions, tenantMemberships, users } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { escapeHtml } from '@/modules/access/service';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { sendEmail } from '@/server/email';
import { serverEnv } from '@/server/env';

import { canHandleConcern, canHandleConcerns } from './queries';
import type { ConcernStatus, RaiseConcernInput } from './schemas';

/*
 * Staff concerns (ADR-049). Every read and write runs through RLS, which is what keeps a concern
 * raised with the admin away from managers; the checks here give clear errors on top of it.
 */

const GONE = 'That concern was not found.';

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
 * Emails the people who can answer a new concern that one is waiting, with nothing of what it
 * says: an inbox is read on shared screens and phones, and the concern is the raiser's to share.
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
  const text = `A new concern has been raised in ${ctx.tenant.name}. Sign in to read and answer it: ${link}`;
  for (const { email } of recipients) {
    await sendEmail({
      to: email,
      subject: `A concern was raised in ${ctx.tenant.name}`,
      text,
      html: `<p>A new concern has been raised in ${escapeHtml(ctx.tenant.name)}.</p><p><a href="${link}">Sign in to read and answer it</a></p>`,
    });
  }
}

export async function raiseConcern(
  ctx: TenantContext,
  input: RaiseConcernInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'concerns.raise');
  const created = await withRls(ctx, async (tx) => {
    const [concern] = await tx
      .insert(concerns)
      .values({
        tenantId: ctx.tenantId,
        raisedBy: ctx.userId,
        raisedWith: input.raisedWith,
        category: input.category,
        subject: input.subject,
        status: 'open',
      })
      .returning({ id: concerns.id });
    if (!concern) throw new AppError('INTERNAL', 'The concern could not be saved.');
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
      context: { raisedWith: input.raisedWith, category: input.category },
    });
    return concern;
  });

  try {
    await notifyHandlers(ctx, { id: created.id, raisedWith: input.raisedWith });
  } catch (cause) {
    // The concern is saved either way; it is on the list for whoever answers concerns.
    console.error('[concerns] notify failed', {
      name: cause instanceof Error ? cause.name : typeof cause,
    });
  }
  return created;
}

/**
 * Adds to a concern's conversation: the person who raised it, or someone who may answer it.
 * An answer from the business moves an open concern to "being looked at".
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
    if (concern.status === 'resolved') {
      throw new AppError(
        'CONFLICT',
        'This concern is resolved. Ask for it to be reopened, or raise a new one.',
      );
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
    if (handling && concern.status === 'open') {
      await tx
        .update(concerns)
        .set({ status: 'in_progress' })
        .where(and(eq(concerns.tenantId, ctx.tenantId), eq(concerns.id, concern.id)));
    }
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'concern',
      entityId: concern.id,
      context: { replied: true },
    });
    return { id: concern.id };
  });
}

/** Moves a concern along, or reopens it. Never by the person who raised it. */
export async function setConcernStatus(
  ctx: TenantContext,
  input: { id: string; status: ConcernStatus },
): Promise<{ id: string }> {
  if (!canHandleConcerns(ctx)) throw new AppError('FORBIDDEN', 'You do not have access to that.');
  return withRls(ctx, async (tx) => {
    const concern = await findConcern(tx, ctx, input.id);
    if (concern.raisedBy === ctx.userId) {
      throw new AppError('CONFLICT', 'Someone else has to deal with a concern you raised.');
    }
    if (!canHandleConcern(ctx, concern)) throw new AppError('NOT_FOUND', GONE);
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
