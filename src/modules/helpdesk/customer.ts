import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import {
  auditLogs,
  contactOrganizations,
  contacts,
  opportunities,
  tenants,
  ticketOpportunities,
  tickets,
} from '@/db/schema';
import { isTenantOpen } from '@/lib/tenant/status';
import type { Tx } from '@/server/db/with-rls';

import { nextTicketNumber } from './numbering';
import { responseDueAt, type Priority } from './schemas';

/*
 * The customer around a ticket (ADR-069): their organization and open opportunities, and the
 * tickets that follow an inbox conversation. Works inside the caller's transaction, under a
 * person's RLS (they then link only what they may see) or the privileged one of a verified
 * webhook.
 */

/** How many of the customer's open opportunities a new ticket links at most. */
const MAX_LINKED_OPPORTUNITIES = 20;

/** The contact's primary organization (or first linked one) and their open opportunities. */
export async function customerContext(
  tx: Tx,
  tenantId: string,
  contactId: string | null,
): Promise<{ organizationId: string | null; opportunityIds: string[] }> {
  if (!contactId) return { organizationId: null, opportunityIds: [] };
  const [organization] = await tx
    .select({ id: contactOrganizations.organizationId })
    .from(contactOrganizations)
    .where(
      and(
        eq(contactOrganizations.tenantId, tenantId),
        eq(contactOrganizations.contactId, contactId),
      ),
    )
    .orderBy(desc(contactOrganizations.isPrimary), asc(contactOrganizations.createdAt))
    .limit(1);
  const open = await tx
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.tenantId, tenantId),
        eq(opportunities.contactId, contactId),
        eq(opportunities.status, 'open'),
        isNull(opportunities.deletedAt),
      ),
    )
    .orderBy(desc(opportunities.createdAt))
    .limit(MAX_LINKED_OPPORTUNITIES);
  return { organizationId: organization?.id ?? null, opportunityIds: open.map((row) => row.id) };
}

export async function linkOpportunities(
  tx: Tx,
  tenantId: string,
  ticketId: string,
  opportunityIds: string[],
  userId: string | null,
): Promise<void> {
  if (opportunityIds.length === 0) return;
  await tx
    .insert(ticketOpportunities)
    .values(
      opportunityIds.map((opportunityId) => ({
        tenantId,
        ticketId,
        opportunityId,
        createdBy: userId,
      })),
    )
    .onConflictDoNothing();
}

/**
 * A customer wrote on an inbox conversation (verified webhook). A ticket that follows it and was
 * waiting on them or solved opens again, which also starts its resolution clock again (trigger
 * `tickets_sla`); one being worked moves to the top of the queue. When none follows it and the
 * account is set to, a new ticket is opened for the conversation.
 */
export async function ticketForInboundMessage(
  tx: Tx,
  input: {
    tenantId: string;
    conversationId: string;
    contactId: string | null;
    customerName: string;
    /** The customer's email address, when the channel gives one (ADR-070). */
    customerEmail?: string | null;
    channelName: string;
    autoTicket: boolean;
    priority: Priority;
  },
): Promise<{ ticketId: string; created: boolean } | null> {
  const now = new Date();
  const followed = await tx
    .select({ id: tickets.id, status: tickets.status })
    .from(tickets)
    .where(
      and(
        eq(tickets.tenantId, input.tenantId),
        eq(tickets.conversationId, input.conversationId),
        isNull(tickets.deletedAt),
        inArray(tickets.status, ['open', 'pending', 'on_hold', 'solved']),
      ),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(1);
  const current = followed[0];
  if (current) {
    await tx
      .update(tickets)
      .set({
        ...(current.status === 'pending' || current.status === 'solved'
          ? { status: 'open', solvedAt: null }
          : {}),
        lastActivityAt: now,
      })
      .where(and(eq(tickets.tenantId, input.tenantId), eq(tickets.id, current.id)));
    return { ticketId: current.id, created: false };
  }
  if (!input.autoTicket) return null;

  const [tenant] = await tx
    .select({ status: tenants.status, features: tenants.features })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!tenant || !isTenantOpen(tenant.status) || !tenant.features.includes('helpdesk')) {
    return null;
  }
  const [contact] = input.contactId
    ? await tx
        .select({ name: contacts.fullName, email: contacts.email })
        .from(contacts)
        .where(and(eq(contacts.tenantId, input.tenantId), eq(contacts.id, input.contactId)))
        .limit(1)
    : [];
  const context = await customerContext(tx, input.tenantId, input.contactId);
  const number = await nextTicketNumber(tx, input.tenantId);
  const requesterName = (contact?.name || input.customerName).slice(0, 120);
  const [created] = await tx
    .insert(tickets)
    .values({
      tenantId: input.tenantId,
      number,
      // Not what they wrote: the subject names the channel and the customer only.
      subject: `${input.channelName} conversation with ${requesterName}`.slice(0, 160),
      requesterName,
      requesterEmail: contact?.email?.toLowerCase() ?? input.customerEmail ?? null,
      contactId: input.contactId,
      organizationId: context.organizationId,
      conversationId: input.conversationId,
      priority: input.priority,
      source: 'conversation',
      publicToken: randomBytes(18).toString('base64url'),
      responseDueAt: responseDueAt(now, input.priority),
      lastActivityAt: now,
    })
    .returning({ id: tickets.id });
  if (!created) throw new Error('ticket not stored');
  await linkOpportunities(tx, input.tenantId, created.id, context.opportunityIds, null);
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorUserId: null,
    actorType: 'system',
    action: 'create',
    entityType: 'ticket',
    entityId: created.id,
    context: { source: 'conversation', conversationId: input.conversationId },
  });
  return { ticketId: created.id, created: true };
}
