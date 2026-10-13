import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, asc, eq, gte, isNull, ne, sql } from 'drizzle-orm';

import { auditLogs, contacts, helpdeskForms, tenants, ticketMessages, tickets } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { adminDb } from '@/server/db/admin';
import { enforceRateLimit } from '@/server/rate-limit';

import { nextTicketNumber } from './numbering';
import { responseDueAt, type PublicTicketInput } from './schemas';

/**
 * The public side of the helpdesk: a business's contact form, and the page where a customer
 * follows their own ticket. There is no session, so this file uses the privileged client. It
 * always starts from a token (the form's, or one ticket's), never accepts a business or ticket
 * id from the caller, and never returns private notes (ADR-037).
 */

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
/**
 * Tickets one sender may open through a form per hour; tickets one form accepts per hour from
 * everyone together (a ceiling against a flood from many addresses); and messages one ticket
 * accepts per hour. The per-sender limit is what stops one script locking real customers out.
 */
const SENDER_HOURLY_LIMIT = 5;
const FORM_HOURLY_LIMIT = 200;
const REPLY_HOURLY_LIMIT = 20;

async function formByToken(token: string) {
  if (!TOKEN.test(token)) return null;
  const [row] = await adminDb()
    .select({ tenantId: helpdeskForms.tenantId, businessName: tenants.name })
    .from(helpdeskForms)
    .innerJoin(tenants, eq(tenants.id, helpdeskForms.tenantId))
    .where(
      and(
        eq(helpdeskForms.publicToken, token),
        eq(helpdeskForms.isOpen, true),
        ne(tenants.status, 'suspended'),
        sql`'helpdesk' = any(${tenants.features})`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getPublicForm(token: string): Promise<{ businessName: string } | null> {
  const row = await formByToken(token);
  return row ? { businessName: row.businessName } : null;
}

/** Creates a ticket from the contact form and returns what the customer needs to follow it. */
export async function submitPublicTicket(
  token: string,
  input: PublicTicketInput,
  sender: string | null,
): Promise<{ number: number; ticketToken: string }> {
  const form = await formByToken(token);
  if (!form) throw new AppError('NOT_FOUND', 'This contact form is not available.');
  await enforceRateLimit(
    {
      bucket: `helpdesk:${form.tenantId}`,
      subject: sender,
      limit: SENDER_HOURLY_LIMIT,
      windowSeconds: 3600,
    },
    'You have sent several requests already. Please wait a while before sending another.',
  );
  const db = adminDb();
  const [recent] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(tickets)
    .where(
      and(
        eq(tickets.tenantId, form.tenantId),
        eq(tickets.source, 'web_form'),
        gte(tickets.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    );
  if ((recent?.total ?? 0) >= FORM_HOURLY_LIMIT) {
    throw new AppError(
      'RATE_LIMITED',
      'We are receiving a lot of requests right now. Try again later.',
    );
  }
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.tenantId, form.tenantId),
        eq(contacts.emailNormalized, input.requesterEmail),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);

  const now = new Date();
  const ticketToken = randomBytes(18).toString('base64url');
  const number = await db.transaction(async (tx) => {
    const next = await nextTicketNumber(tx, form.tenantId);
    const [created] = await tx
      .insert(tickets)
      .values({
        tenantId: form.tenantId,
        number: next,
        subject: input.subject,
        requesterName: input.requesterName,
        requesterEmail: input.requesterEmail,
        contactId: contact?.id ?? null,
        priority: 'normal',
        source: 'web_form',
        publicToken: ticketToken,
        responseDueAt: responseDueAt(now, 'normal'),
        lastActivityAt: now,
      })
      .returning({ id: tickets.id });
    if (!created) throw new AppError('INTERNAL', 'Your request could not be saved.');
    await tx.insert(ticketMessages).values({
      tenantId: form.tenantId,
      ticketId: created.id,
      authorUserId: null,
      authorName: input.requesterName,
      body: input.description,
    });
    await tx.insert(auditLogs).values({
      tenantId: form.tenantId,
      actorUserId: null,
      actorType: 'system',
      action: 'create',
      entityType: 'ticket',
      entityId: created.id,
      context: { source: 'web_form' },
    });
    return next;
  });
  return { number, ticketToken };
}

async function ticketByToken(token: string) {
  if (!TOKEN.test(token)) return null;
  const [row] = await adminDb()
    .select({
      id: tickets.id,
      tenantId: tickets.tenantId,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      requesterName: tickets.requesterName,
      businessName: tenants.name,
    })
    .from(tickets)
    .innerJoin(tenants, eq(tenants.id, tickets.tenantId))
    .where(
      and(
        eq(tickets.publicToken, token),
        isNull(tickets.deletedAt),
        ne(tenants.status, 'suspended'),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type PublicTicket = {
  number: number;
  subject: string;
  status: string;
  businessName: string;
  messages: { id: string; fromStaff: boolean; authorName: string; body: string; createdAt: Date }[];
};

/** What the customer sees of their own ticket: never private notes, never staff identities beyond a name. */
export async function getPublicTicket(token: string): Promise<PublicTicket | null> {
  const ticket = await ticketByToken(token);
  if (!ticket) return null;
  const messages = await adminDb()
    .select({
      id: ticketMessages.id,
      authorUserId: ticketMessages.authorUserId,
      authorName: ticketMessages.authorName,
      body: ticketMessages.body,
      createdAt: ticketMessages.createdAt,
    })
    .from(ticketMessages)
    .where(
      and(
        eq(ticketMessages.tenantId, ticket.tenantId),
        eq(ticketMessages.ticketId, ticket.id),
        eq(ticketMessages.isInternal, false),
      ),
    )
    .orderBy(asc(ticketMessages.createdAt));
  return {
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    businessName: ticket.businessName,
    messages: messages.map((message, index) => ({
      id: message.id,
      // The opening message is the customer's own words even when staff logged it for them.
      fromStaff: index > 0 && message.authorUserId !== null,
      authorName: index === 0 ? ticket.requesterName : message.authorName,
      body: message.body,
      createdAt: message.createdAt,
    })),
  };
}

/** The customer writes back. Their reply reopens the ticket so it returns to the queue. */
export async function replyAsCustomer(token: string, body: string): Promise<void> {
  const ticket = await ticketByToken(token);
  if (!ticket) throw new AppError('NOT_FOUND', 'This request was not found.');
  if (ticket.status === 'closed') {
    throw new AppError('CONFLICT', 'This request is closed. Please send a new one.');
  }
  const db = adminDb();
  const [recent] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(ticketMessages)
    .where(
      and(
        eq(ticketMessages.tenantId, ticket.tenantId),
        eq(ticketMessages.ticketId, ticket.id),
        isNull(ticketMessages.authorUserId),
        gte(ticketMessages.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    );
  if ((recent?.total ?? 0) >= REPLY_HOURLY_LIMIT) {
    throw new AppError(
      'RATE_LIMITED',
      'That is a lot of messages. Please wait a little and try again.',
    );
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(ticketMessages).values({
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      authorUserId: null,
      authorName: ticket.requesterName,
      body,
    });
    await tx
      .update(tickets)
      .set({ status: 'open', solvedAt: null, lastActivityAt: now })
      .where(and(eq(tickets.tenantId, ticket.tenantId), eq(tickets.id, ticket.id)));
  });
}
