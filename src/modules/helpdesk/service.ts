import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { contacts, helpdeskForms, tenantMemberships, ticketMessages, tickets } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { getMyName } from '@/modules/members/queries';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { sendEmail } from '@/server/email';
import { serverEnv } from '@/server/env';

import { nextTicketNumber } from './numbering';
import {
  responseDueAt,
  type CreateTicketInput,
  type ReplyInput,
  type UpdateTicketInput,
} from './schemas';

export const ticketLink = (token: string) => `${serverEnv().APP_URL}/support/ticket/${token}`;

async function findTicket(tx: Tx, ctx: TenantContext, id: string) {
  const [ticket] = await tx
    .select()
    .from(tickets)
    .where(and(eq(tickets.tenantId, ctx.tenantId), eq(tickets.id, id), isNull(tickets.deletedAt)))
    .limit(1);
  if (!ticket) throw new AppError('NOT_FOUND', 'That ticket was not found.');
  return ticket;
}

async function assertMember(tx: Tx, ctx: TenantContext, userId: string | null | undefined) {
  if (!userId) return;
  const [member] = await tx
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
  if (!member) {
    throw new AppError('VALIDATION', 'Choose someone from your team.', {
      assigneeUserId: ['Choose someone from your team'],
    });
  }
}

/** Logs a request that came in by phone, in person or by email. */
export async function createTicket(
  ctx: TenantContext,
  input: CreateTicketInput,
): Promise<{ id: string; number: number }> {
  requirePermission(ctx, 'tickets.work');
  const now = new Date();
  return withRls(ctx, async (tx) => {
    await assertMember(tx, ctx, input.assigneeUserId);
    const [contact] = input.requesterEmail
      ? await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, ctx.tenantId),
              eq(contacts.emailNormalized, input.requesterEmail),
              isNull(contacts.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const number = await nextTicketNumber(tx, ctx.tenantId);
    const [created] = await tx
      .insert(tickets)
      .values({
        tenantId: ctx.tenantId,
        number,
        subject: input.subject,
        requesterName: input.requesterName,
        requesterEmail: input.requesterEmail,
        contactId: contact?.id ?? null,
        category: input.category,
        priority: input.priority,
        assigneeUserId: input.assigneeUserId,
        source: 'manual',
        publicToken: randomBytes(18).toString('base64url'),
        responseDueAt: responseDueAt(now, input.priority),
        lastActivityAt: now,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: tickets.id });
    if (!created) throw new AppError('INTERNAL', 'The ticket could not be saved.');
    // The request itself is the first message, in the customer's name.
    await tx.insert(ticketMessages).values({
      tenantId: ctx.tenantId,
      ticketId: created.id,
      authorUserId: ctx.userId,
      authorName: `${input.requesterName} (logged by staff)`,
      body: input.description,
    });
    await audit(tx, ctx, { action: 'create', entityType: 'ticket', entityId: created.id });
    return { id: created.id, number };
  });
}

/**
 * Writes on a ticket: a reply the customer can see, or a private note for staff. A reply
 * records the first-response time and, unless told otherwise, leaves the ticket waiting on the
 * customer. When email is set up the customer is sent the reply with a link to their ticket.
 */
export async function replyToTicket(
  ctx: TenantContext,
  input: ReplyInput,
): Promise<{ id: string; emailed: boolean }> {
  requirePermission(ctx, 'tickets.work');
  const authorName = await getMyName(ctx);
  const now = new Date();
  const ticket = await withRls(ctx, async (tx) => {
    const found = await findTicket(tx, ctx, input.ticketId);
    if (found.status === 'closed' && !input.isInternal) {
      throw new AppError('CONFLICT', 'This ticket is closed. Reopen it to reply.');
    }
    await tx.insert(ticketMessages).values({
      tenantId: ctx.tenantId,
      ticketId: found.id,
      authorUserId: ctx.userId,
      authorName,
      body: input.body,
      isInternal: input.isInternal,
    });
    if (!input.isInternal) {
      const status = input.status ?? 'pending';
      await tx
        .update(tickets)
        .set({
          status,
          firstResponseAt: found.firstResponseAt ?? now,
          solvedAt: status === 'solved' || status === 'closed' ? (found.solvedAt ?? now) : null,
          // Whoever answers an unassigned ticket takes it.
          assigneeUserId: found.assigneeUserId ?? ctx.userId,
          lastActivityAt: now,
          updatedBy: ctx.userId,
        })
        .where(and(eq(tickets.tenantId, ctx.tenantId), eq(tickets.id, found.id)));
    }
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'ticket',
      entityId: found.id,
      context: { kind: input.isInternal ? 'note' : 'reply' },
    });
    return found;
  });

  let emailed = false;
  if (!input.isInternal && ticket.requesterEmail) {
    const link = ticketLink(ticket.publicToken);
    const result = await sendEmail({
      to: ticket.requesterEmail,
      subject: `Re: ${ticket.subject} [#${ticket.number}]`,
      text: `${input.body}\n\n— ${authorName}, ${ctx.tenant.name}\n\nView or reply to your request: ${link}`,
      html: `<p style="white-space:pre-wrap">${input.body.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)}</p><p>— ${authorName.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)}</p><p><a href="${link}">View or reply to your request</a></p>`,
    });
    emailed = result.sent;
  }
  return { id: ticket.id, emailed };
}

/** Changes a ticket's status, priority, category or who is working on it. */
export async function updateTicket(
  ctx: TenantContext,
  input: UpdateTicketInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'tickets.work');
  return withRls(ctx, async (tx) => {
    const ticket = await findTicket(tx, ctx, input.id);
    await assertMember(tx, ctx, input.assigneeUserId);
    const done = input.status === 'solved' || input.status === 'closed';
    await tx
      .update(tickets)
      .set({
        ...(input.status ? { status: input.status } : {}),
        ...(input.status ? { solvedAt: done ? (ticket.solvedAt ?? new Date()) : null } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {}),
        updatedBy: ctx.userId,
      })
      .where(and(eq(tickets.tenantId, ctx.tenantId), eq(tickets.id, ticket.id)));
    await audit(tx, ctx, {
      action:
        input.assigneeUserId !== undefined && input.assigneeUserId !== ticket.assigneeUserId
          ? 'owner_change'
          : input.status && input.status !== ticket.status
            ? 'stage_change'
            : 'update',
      entityType: 'ticket',
      entityId: ticket.id,
      changes: input.status ? { status: [ticket.status, input.status] } : null,
    });
    return { id: ticket.id };
  });
}

export async function deleteTicket(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'tickets.manage');
  return withRls(ctx, async (tx) => {
    const ticket = await findTicket(tx, ctx, id);
    await tx
      .update(tickets)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(tickets.tenantId, ctx.tenantId), eq(tickets.id, ticket.id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'ticket', entityId: ticket.id });
    return { id: ticket.id };
  });
}

/** Switches the public contact form on (creating its address the first time) or off. */
export async function setFormOpen(
  ctx: TenantContext,
  isOpen: boolean,
): Promise<{ isOpen: boolean }> {
  requirePermission(ctx, 'tickets.manage');
  return withRls(ctx, async (tx) => {
    await tx
      .insert(helpdeskForms)
      .values({
        tenantId: ctx.tenantId,
        publicToken: randomBytes(15).toString('base64url'),
        isOpen,
      })
      .onConflictDoUpdate({ target: helpdeskForms.tenantId, set: { isOpen } });
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'helpdesk_form',
      entityId: null,
      context: { isOpen },
    });
    return { isOpen };
  });
}
