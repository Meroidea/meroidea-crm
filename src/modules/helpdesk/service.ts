import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  businessHours,
  contacts,
  helpdeskForms,
  opportunities,
  organizations,
  rolePermissions,
  slaPolicies,
  slaTargets,
  tenantMemberships,
  ticketMessages,
  ticketOpportunities,
  tickets,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { scopeFilter } from '@/lib/permissions/scope';
import { getMyName } from '@/modules/members/queries';
import { PLATFORM_LABELS } from '@/modules/social/format';
import { getConversationForTicket } from '@/modules/social/queries';
import { replyToConversation } from '@/modules/social/service';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { sendEmail } from '@/server/email';
import { serverEnv } from '@/server/env';

import { customerContext, linkOpportunities } from './customer';
import { nextTicketNumber } from './numbering';
import {
  PRIORITIES,
  responseDueAt,
  type ConversationTicketInput,
  type CreateTicketInput,
  type SlaSettingsInput,
  type ReplyEmail,
  type ReplyInput,
  type UpdateTicketInput,
} from './schemas';
import { renderEmail } from '@/server/email-template';

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

/** A ticket goes only to one of the business's own people whose role can work tickets. */
async function assertMember(tx: Tx, ctx: TenantContext, userId: string | null | undefined) {
  if (!userId) return;
  const [member] = await tx
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .innerJoin(
      rolePermissions,
      and(
        eq(rolePermissions.tenantId, tenantMemberships.tenantId),
        eq(rolePermissions.roleId, tenantMemberships.roleId),
        eq(rolePermissions.permission, 'tickets.work'),
      ),
    )
    .where(
      and(
        eq(tenantMemberships.tenantId, ctx.tenantId),
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.status, 'active'),
        eq(tenantMemberships.isSupport, false),
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
    const context = await customerContext(tx, ctx.tenantId, contact?.id ?? null);
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
        organizationId: context.organizationId,
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
    await linkOpportunities(tx, ctx.tenantId, created.id, context.opportunityIds, ctx.userId);
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
): Promise<{ id: string; email: ReplyEmail }> {
  requirePermission(ctx, 'tickets.work');
  const authorName = await getMyName(ctx);
  const now = new Date();
  // A ticket that follows an inbox conversation is answered on that channel (ADR-069): the
  // reply goes through the inbox, with all its checks (reply window, permission), and lives in
  // the conversation rather than being copied onto the ticket.
  const target = await withRls(ctx, (tx) => findTicket(tx, ctx, input.ticketId));
  const viaChannel = !input.isInternal && target.conversationId !== null;
  if (viaChannel) {
    if (target.status === 'closed') {
      throw new AppError('CONFLICT', 'This ticket is closed. Reopen it to reply.');
    }
    if (!hasPermission(ctx, 'social.reply')) {
      throw new AppError(
        'FORBIDDEN',
        'Replying on this channel needs permission to reply in the inbox.',
      );
    }
    await replyToConversation(ctx, { conversationId: target.conversationId!, body: input.body });
  }
  const ticket = await withRls(ctx, async (tx) => {
    const found = await findTicket(tx, ctx, input.ticketId);
    if (found.status === 'closed' && !input.isInternal) {
      throw new AppError('CONFLICT', 'This ticket is closed. Reopen it to reply.');
    }
    if (!viaChannel) {
      await tx.insert(ticketMessages).values({
        tenantId: ctx.tenantId,
        ticketId: found.id,
        authorUserId: ctx.userId,
        authorName,
        body: input.body,
        isInternal: input.isInternal,
      });
    }
    let changes: Record<string, [unknown, unknown]> | null = null;
    if (!input.isInternal) {
      const status = input.status ?? 'pending';
      // Replying takes an unassigned ticket, unless it is the platform owner on support.
      const assigneeUserId = found.assigneeUserId ?? (ctx.isSupport ? null : ctx.userId);
      await tx
        .update(tickets)
        .set({
          status,
          firstResponseAt: found.firstResponseAt ?? now,
          solvedAt: status === 'solved' || status === 'closed' ? (found.solvedAt ?? now) : null,
          assigneeUserId,
          lastActivityAt: now,
          updatedBy: ctx.userId,
        })
        .where(and(eq(tickets.tenantId, ctx.tenantId), eq(tickets.id, found.id)));
      changes = changedFields({
        status: [found.status, status],
        assigneeUserId: [found.assigneeUserId, assigneeUserId],
      });
    }
    await audit(tx, ctx, {
      action: changes?.assigneeUserId
        ? 'owner_change'
        : changes?.status
          ? 'stage_change'
          : 'update',
      entityType: 'ticket',
      entityId: found.id,
      changes,
      context: { kind: input.isInternal ? 'note' : viaChannel ? 'channel_reply' : 'reply' },
    });
    return found;
  });

  let email: ReplyEmail = 'none';
  if (!input.isInternal && !viaChannel && ticket.requesterEmail) {
    const link = ticketLink(ticket.publicToken);
    const result = await sendEmail({
      to: ticket.requesterEmail,
      subject: `Re: ${ticket.subject} [#${ticket.number}]`,
      ...renderEmail({
        sender: {
          kind: 'business',
          name: ctx.tenant.name,
          color: ctx.tenant.primaryColor,
        },
        preheader: input.body.replace(/\s+/g, ' ').slice(0, 120),
        heading: `Re: ${ticket.subject}`,
        blocks: [
          { type: 'message', text: input.body },
          { type: 'button', label: 'View or reply to your request', url: link },
        ],
        signature: [authorName, ctx.tenant.name],
        reason: `You received this because you contacted ${ctx.tenant.name} (request #${ticket.number}).`,
      }),
    });
    email = result.sent ? 'sent' : result.reason;
  }
  return { id: ticket.id, email };
}

/** Only the fields whose value moved, or null when none did. */
function changedFields(
  candidates: Record<string, [unknown, unknown]>,
): Record<string, [unknown, unknown]> | null {
  const moved = Object.entries(candidates).filter(([, [before, after]]) => before !== after);
  return moved.length > 0 ? Object.fromEntries(moved) : null;
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
    const changes = changedFields({
      ...(input.status ? { status: [ticket.status, input.status] } : {}),
      ...(input.priority ? { priority: [ticket.priority, input.priority] } : {}),
      ...(input.category !== undefined ? { category: [ticket.category, input.category] } : {}),
      ...(input.assigneeUserId !== undefined
        ? { assigneeUserId: [ticket.assigneeUserId, input.assigneeUserId] }
        : {}),
    });
    await audit(tx, ctx, {
      action: changes?.assigneeUserId
        ? 'owner_change'
        : changes?.status
          ? 'stage_change'
          : 'update',
      entityType: 'ticket',
      entityId: ticket.id,
      changes,
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

/**
 * Opens a ticket for an inbox conversation (ADR-069), for the conversation's contact, their
 * organization and open opportunities. One conversation is followed by one ticket at a time:
 * while one is still being worked, asking again returns it.
 */
export async function createTicketFromConversation(
  ctx: TenantContext,
  input: ConversationTicketInput,
): Promise<{ id: string; number: number; existing: boolean }> {
  requirePermission(ctx, 'tickets.work');
  requirePermission(ctx, 'social.view');
  const conversation = await getConversationForTicket(ctx, input.conversationId);
  if (!conversation) throw new AppError('NOT_FOUND', 'That conversation was not found.');
  const now = new Date();
  return withRls(ctx, async (tx) => {
    const [open] = await tx
      .select({ id: tickets.id, number: tickets.number })
      .from(tickets)
      .where(
        and(
          eq(tickets.tenantId, ctx.tenantId),
          eq(tickets.conversationId, conversation.id),
          isNull(tickets.deletedAt),
          inArray(tickets.status, ['open', 'pending', 'on_hold']),
        ),
      )
      .limit(1);
    if (open) return { ...open, existing: true };
    await assertMember(tx, ctx, input.assigneeUserId);
    const [contact] = conversation.contactId
      ? await tx
          .select({ name: contacts.fullName, email: contacts.email })
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, ctx.tenantId),
              eq(contacts.id, conversation.contactId),
              isNull(contacts.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const context = await customerContext(tx, ctx.tenantId, conversation.contactId);
    const number = await nextTicketNumber(tx, ctx.tenantId);
    const [created] = await tx
      .insert(tickets)
      .values({
        tenantId: ctx.tenantId,
        number,
        subject: input.subject,
        requesterName: (contact?.name || conversation.customerName).slice(0, 120),
        requesterEmail: contact?.email?.toLowerCase() ?? conversation.customerEmail,
        contactId: conversation.contactId,
        organizationId: context.organizationId,
        conversationId: conversation.id,
        priority: input.priority,
        assigneeUserId: input.assigneeUserId,
        source: 'conversation',
        publicToken: randomBytes(18).toString('base64url'),
        responseDueAt: responseDueAt(now, input.priority),
        lastActivityAt: now,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: tickets.id });
    if (!created) throw new AppError('INTERNAL', 'The ticket could not be saved.');
    await linkOpportunities(tx, ctx.tenantId, created.id, context.opportunityIds, ctx.userId);
    await tx.insert(ticketMessages).values({
      tenantId: ctx.tenantId,
      ticketId: created.id,
      authorUserId: ctx.userId,
      authorName: await getMyName(ctx),
      body: `Opened from the ${PLATFORM_LABELS[conversation.platform]} conversation with ${conversation.accountName}. Replies here go to the customer there.`,
      isInternal: true,
    });
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'ticket',
      entityId: created.id,
      context: { source: 'conversation', conversationId: conversation.id },
    });
    return { id: created.id, number, existing: false };
  });
}

/** Sets the organization a ticket concerns, from those the person may see, or clears it. */
export async function setTicketOrganization(
  ctx: TenantContext,
  input: { ticketId: string; organizationId: string | null },
): Promise<void> {
  requirePermission(ctx, 'tickets.work');
  if (input.organizationId) requirePermission(ctx, 'organizations.view');
  await withRls(ctx, async (tx) => {
    const ticket = await findTicket(tx, ctx, input.ticketId);
    if (input.organizationId) {
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.tenantId, ctx.tenantId),
            eq(organizations.id, input.organizationId),
            isNull(organizations.deletedAt),
          ),
        )
        .limit(1);
      if (!organization) throw new AppError('NOT_FOUND', 'That organization was not found.');
    }
    await tx
      .update(tickets)
      .set({ organizationId: input.organizationId, updatedBy: ctx.userId })
      .where(and(eq(tickets.tenantId, ctx.tenantId), eq(tickets.id, ticket.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'ticket',
      entityId: ticket.id,
      changes: { organizationId: [ticket.organizationId, input.organizationId] },
    });
  });
}

/**
 * Links one of the person's visible opportunities to a ticket, or unlinks it. Only an
 * opportunity of the ticket's own contact may be linked, so a ticket never points at someone
 * else's deal.
 */
export async function setTicketOpportunity(
  ctx: TenantContext,
  input: { ticketId: string; opportunityId: string; linked: boolean },
): Promise<void> {
  requirePermission(ctx, 'tickets.work');
  requirePermission(ctx, 'opportunities.view');
  await withRls(ctx, async (tx) => {
    const ticket = await findTicket(tx, ctx, input.ticketId);
    const [opportunity] = await tx
      .select({ id: opportunities.id, contactId: opportunities.contactId })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.tenantId, ctx.tenantId),
          eq(opportunities.id, input.opportunityId),
          isNull(opportunities.deletedAt),
          scopeFilter(ctx, 'opportunities.view', opportunities),
        ),
      )
      .limit(1);
    if (!opportunity) throw new AppError('NOT_FOUND', 'That opportunity was not found.');
    if (input.linked) {
      if (!ticket.contactId || opportunity.contactId !== ticket.contactId) {
        throw new AppError('VALIDATION', 'Only the customer’s own opportunities can be linked.');
      }
      await linkOpportunities(tx, ctx.tenantId, ticket.id, [opportunity.id], ctx.userId);
    } else {
      await tx
        .delete(ticketOpportunities)
        .where(
          and(
            eq(ticketOpportunities.tenantId, ctx.tenantId),
            eq(ticketOpportunities.ticketId, ticket.id),
            eq(ticketOpportunities.opportunityId, opportunity.id),
          ),
        );
    }
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'ticket',
      entityId: ticket.id,
      context: { opportunityId: opportunity.id, linked: input.linked },
    });
  });
}

function knownTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves the business's response targets (ADR-069): the default policy's four priorities, how far
 * in a ticket counts as at risk, who hears about breaches, and the hours time is counted in. The
 * tickets still being worked then follow the new targets.
 */
export async function saveSlaSettings(
  ctx: TenantContext,
  input: SlaSettingsInput,
): Promise<{ reapplied: number }> {
  requirePermission(ctx, 'tickets.manage');
  if (input.useBusinessHours && !knownTimezone(input.timezone)) {
    throw new AppError('VALIDATION', 'Choose a timezone from the list.', {
      timezone: ['Choose a timezone from the list'],
    });
  }
  return withRls(ctx, async (tx) => {
    const [policy] = await tx
      .select()
      .from(slaPolicies)
      .where(and(eq(slaPolicies.tenantId, ctx.tenantId), eq(slaPolicies.isDefault, true)))
      .limit(1);
    if (!policy) throw new AppError('INTERNAL', 'This business has no response targets yet.');
    await assertMember(tx, ctx, input.escalateToUserId);

    // The policy's hours, else the ones saved here before (kept while switched off), so saving
    // never piles up copies.
    let hoursId = policy.businessHoursId;
    if (!hoursId) {
      const [saved] = await tx
        .select({ id: businessHours.id })
        .from(businessHours)
        .where(eq(businessHours.tenantId, ctx.tenantId))
        .orderBy(desc(businessHours.updatedAt))
        .limit(1);
      hoursId = saved?.id ?? null;
    }
    if (input.weekly.length > 0) {
      const values = {
        timezone: input.timezone,
        weekly: input.weekly,
        skipPublicHolidays: input.skipPublicHolidays,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      };
      if (hoursId) {
        await tx
          .update(businessHours)
          .set(values)
          .where(and(eq(businessHours.tenantId, ctx.tenantId), eq(businessHours.id, hoursId)));
      } else {
        const [created] = await tx
          .insert(businessHours)
          .values({
            tenantId: ctx.tenantId,
            name: 'Business hours',
            ...values,
            createdBy: ctx.userId,
          })
          .returning({ id: businessHours.id });
        hoursId = created!.id;
      }
    }
    await tx
      .update(slaPolicies)
      .set({
        atRiskPercent: input.atRiskPercent,
        escalateToUserId: input.escalateToUserId,
        businessHoursId: input.useBusinessHours ? hoursId : null,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(slaPolicies.tenantId, ctx.tenantId), eq(slaPolicies.id, policy.id)));
    for (const priority of PRIORITIES) {
      const target = input.targets[priority];
      const values = {
        firstResponseMinutes: Math.round(target.firstResponseHours * 60),
        resolutionMinutes: Math.round(target.resolutionHours * 60),
      };
      await tx
        .insert(slaTargets)
        .values({ tenantId: ctx.tenantId, policyId: policy.id, priority, ...values })
        .onConflictDoUpdate({ target: [slaTargets.policyId, slaTargets.priority], set: values });
    }
    const [result] = (await tx.execute(
      sql`select app.sla_reapply_policy(${policy.id}::uuid) as count`,
    )) as unknown as { count: number }[];
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'sla_policy',
      entityId: policy.id,
      changes: {
        atRiskPercent: [policy.atRiskPercent, input.atRiskPercent],
        escalateToUserId: [policy.escalateToUserId, input.escalateToUserId],
        businessHours: [policy.businessHoursId !== null, input.useBusinessHours],
      },
      context: { targets: input.targets },
    });
    return { reapplied: result?.count ?? 0 };
  });
}
