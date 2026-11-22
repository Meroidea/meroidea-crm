import 'server-only';

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';

import {
  livechatVisitors,
  socialAccountCredentials,
  socialConversations,
  socialMessages,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { adminDb } from '@/server/db/admin';
import { enforceRateLimit } from '@/server/rate-limit';

import { openCredentials } from './credentials';
import { afterInboundMessage, recordMessage } from './ingest';
import type { ChatSessionInput } from './livechat-schemas';
import { findChatWidget, type ChatWidget } from './livechat-widget';

/*
 * The visitor's side of live chat (ADR-072): the only live chat code that uses the privileged
 * connection. Everything starts from the widget's public key and goes no further than a widget
 * that is connected, whose business is open and has live chat switched on. A visitor is known
 * only by a random token (its hash is stored); no business, conversation or visitor id is ever
 * taken from the browser, and a visitor sees only their own conversation's messages, never a
 * private note.
 */

/** New chats one address may start on a widget an hour. */
const SESSIONS_HOURLY = 20;
/** New chats a widget accepts an hour, from everyone. */
const WIDGET_SESSIONS_HOURLY = 2000;
/** Messages one visitor may send in ten minutes. */
const MESSAGES_PER_TEN_MINUTES = 40;
/** Messages a widget accepts an hour, from everyone. */
const WIDGET_MESSAGES_HOURLY = 3000;
/** Messages one poll returns at most. */
const POLL_LIMIT = 100;
/** How far before its cursor a poll looks again, for messages committed late. */
const OVERLAP_SECONDS = 30;

export type ChatVisitor = { name: string | null; email: string | null; verified: boolean };

export type ChatMessage = {
  id: string;
  from: 'visitor' | 'business';
  body: string | null;
  /** ISO time. */
  at: string;
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

async function requireWidget(key: string): Promise<ChatWidget> {
  const widget = await findChatWidget(key);
  if (!widget) throw new AppError('NOT_FOUND', 'This chat is not available.');
  return widget;
}

/** The HMAC-SHA256 a business's server makes of a signed-in visitor's email address. */
export function identitySignature(secret: string, email: string): string {
  return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex');
}

/**
 * Whether the business's own site vouched for this visitor's email: its server signed the address
 * with the widget's identity secret, which never leaves the business's server or Meroidea.
 */
async function verifiedIdentity(
  widget: ChatWidget,
  identity: NonNullable<ChatSessionInput['identity']>,
): Promise<boolean> {
  const [sealed] = await adminDb()
    .select({
      access_token_ciphertext: socialAccountCredentials.accessTokenCiphertext,
      access_expires_at: socialAccountCredentials.accessExpiresAt,
      refresh_token_ciphertext: socialAccountCredentials.refreshTokenCiphertext,
      refresh_expires_at: socialAccountCredentials.refreshExpiresAt,
    })
    .from(socialAccountCredentials)
    .where(
      and(
        eq(socialAccountCredentials.tenantId, widget.tenantId),
        eq(socialAccountCredentials.accountId, widget.accountId),
      ),
    )
    .limit(1);
  if (!sealed) return false;
  let secret: string;
  try {
    secret = openCredentials(widget.tenantId, widget.accountId, sealed).accessToken;
  } catch {
    return false;
  }
  const expected = Buffer.from(identitySignature(secret, identity.email), 'hex');
  const given = Buffer.from(identity.signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type VisitorRow = typeof livechatVisitors.$inferSelect;

async function visitorByToken(widget: ChatWidget, token: string): Promise<VisitorRow | null> {
  const [visitor] = await adminDb()
    .select()
    .from(livechatVisitors)
    .where(
      and(
        eq(livechatVisitors.tenantId, widget.tenantId),
        eq(livechatVisitors.accountId, widget.accountId),
        eq(livechatVisitors.tokenHash, hashToken(token)),
      ),
    )
    .limit(1);
  return visitor ?? null;
}

const visitorView = (visitor: VisitorRow): ChatVisitor => ({
  name: visitor.name,
  email: visitor.email,
  verified: visitor.emailVerified,
});

/**
 * Starts a visitor's chat, or resumes it with their token. A visitor the business's site vouches
 * for (a valid identity signature) gets that email marked verified, which lets their messages
 * link to the matching contact; a token whose verified email differs belongs to someone else on
 * the same browser, so a new chat starts. Anyone else may give a name and email until their first
 * message; after that they are kept, so a conversation cannot change hands.
 */
export async function startChatSession(
  key: string,
  input: ChatSessionInput,
  address: string | null,
): Promise<{ token: string; visitor: ChatVisitor }> {
  const widget = await requireWidget(key);
  const vouched =
    input.identity && (await verifiedIdentity(widget, input.identity)) ? input.identity : null;
  if (input.identity && !vouched) {
    // The business's set-up is wrong (or someone is guessing): carry on without the identity.
    console.warn('[livechat] identity signature did not verify', { accountId: widget.accountId });
  }

  const existing = input.token ? await visitorByToken(widget, input.token) : null;
  if (existing && input.token) {
    const otherPerson = vouched && existing.emailVerified && existing.email !== vouched.email;
    if (!otherPerson) {
      const changes: Partial<VisitorRow> = { lastSeenAt: new Date() };
      if (vouched) {
        changes.email = vouched.email;
        changes.emailVerified = true;
        changes.name = vouched.name ?? existing.name;
      } else if (!existing.conversationId && !existing.emailVerified) {
        changes.name = input.name ?? existing.name;
        changes.email = input.email ?? existing.email;
      }
      const [updated] = await adminDb()
        .update(livechatVisitors)
        .set(changes)
        .where(
          and(eq(livechatVisitors.tenantId, widget.tenantId), eq(livechatVisitors.id, existing.id)),
        )
        .returning();
      if (vouched && existing.conversationId) {
        await adminDb()
          .update(socialConversations)
          .set({
            participantEmail: vouched.email,
            participantName: sql`coalesce(${vouched.name ?? null}, ${socialConversations.participantName})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(socialConversations.tenantId, widget.tenantId),
              eq(socialConversations.id, existing.conversationId),
            ),
          );
      }
      return { token: input.token, visitor: visitorView(updated ?? existing) };
    }
  }

  await enforceRateLimit(
    {
      bucket: `livechat-session:${widget.accountId}`,
      subject: address,
      limit: SESSIONS_HOURLY,
      windowSeconds: 3600,
    },
    'Too many chats started from here. Try again later.',
  );
  await enforceRateLimit(
    {
      bucket: `livechat-session-all:${widget.accountId}`,
      subject: null,
      limit: WIDGET_SESSIONS_HOURLY,
      windowSeconds: 3600,
    },
    'This chat is busy right now. Try again soon.',
  );
  const token = randomBytes(24).toString('base64url');
  const [created] = await adminDb()
    .insert(livechatVisitors)
    .values({
      tenantId: widget.tenantId,
      accountId: widget.accountId,
      tokenHash: hashToken(token),
      name: vouched?.name ?? input.name ?? null,
      email: vouched?.email ?? input.email ?? null,
      emailVerified: Boolean(vouched),
    })
    .returning();
  if (!created) throw new AppError('INTERNAL', 'The chat could not be started.');
  return { token, visitor: visitorView(created) };
}

async function requireVisitor(widget: ChatWidget, token: string): Promise<VisitorRow> {
  const visitor = await visitorByToken(widget, token);
  if (!visitor) {
    throw new AppError('NOT_FOUND', 'This chat has ended. Start a new one.');
  }
  return visitor;
}

/**
 * A visitor's message. Their conversation is made with their first one, and each message is
 * stored once however often the widget retries it. It then sets off what any customer's message
 * does: finding their contact (only a verified email links one), and the helpdesk ticket.
 */
export async function postVisitorMessage(
  key: string,
  input: { token: string; clientId: string; body: string },
  address: string | null,
): Promise<{ message: ChatMessage }> {
  const widget = await requireWidget(key);
  const visitor = await requireVisitor(widget, input.token);
  if (widget.requireEmail && !visitor.email) {
    throw new AppError('VALIDATION', 'Add your email address first.', {
      email: ['Add your email address first.'],
    });
  }
  await enforceRateLimit(
    {
      bucket: `livechat-message:${visitor.id}`,
      subject: address,
      limit: MESSAGES_PER_TEN_MINUTES,
      windowSeconds: 600,
    },
    'You are sending messages too quickly. Wait a moment.',
  );
  await enforceRateLimit(
    {
      bucket: `livechat-message-all:${widget.accountId}`,
      subject: null,
      limit: WIDGET_MESSAGES_HOURLY,
      windowSeconds: 3600,
    },
    'This chat is busy right now. Try again soon.',
  );

  const scope = { tenantId: widget.tenantId, accountId: widget.accountId };
  const externalId = `chat:${visitor.id}:${input.clientId}`;
  const sentAt = new Date();
  return adminDb().transaction(async (tx) => {
    let conversationId = visitor.conversationId;
    if (!conversationId) {
      const [conversation] = await tx
        .insert(socialConversations)
        .values({
          ...scope,
          participantId: `visitor:${visitor.id}`,
          participantName: visitor.name,
          participantEmail: visitor.email,
        })
        .onConflictDoUpdate({
          target: [socialConversations.accountId, socialConversations.participantId],
          set: { updatedAt: sentAt },
        })
        .returning({ id: socialConversations.id });
      conversationId = conversation!.id;
      await tx
        .update(livechatVisitors)
        .set({ conversationId, lastSeenAt: sentAt })
        .where(
          and(eq(livechatVisitors.tenantId, widget.tenantId), eq(livechatVisitors.id, visitor.id)),
        );
    }
    const stored = await recordMessage(
      tx,
      { ...scope, conversationId },
      { externalId, direction: 'inbound', body: input.body, attachments: [], sentAt },
      { countUnread: true },
    );
    if (stored) {
      await afterInboundMessage(
        tx,
        { ...scope, conversationId },
        {
          trusted: visitor.emailVerified,
          automated: false,
          // Like a website enquiry: only a visitor who left an email address becomes a lead.
          leadWhenUnverified: Boolean(visitor.email),
        },
      );
      return {
        message: { id: stored.id, from: 'visitor', body: input.body, at: sentAt.toISOString() },
      };
    }
    // A retry of a message already stored: answer with that one.
    const [already] = await tx
      .select({
        id: socialMessages.id,
        body: socialMessages.body,
        createdAt: socialMessages.createdAt,
      })
      .from(socialMessages)
      .where(
        and(
          eq(socialMessages.tenantId, widget.tenantId),
          eq(socialMessages.accountId, widget.accountId),
          eq(socialMessages.externalId, externalId),
        ),
      )
      .limit(1);
    if (!already) throw new AppError('INTERNAL', 'The message could not be sent.');
    return {
      message: {
        id: already.id,
        from: 'visitor',
        body: already.body,
        at: already.createdAt.toISOString(),
      },
    };
  });
}

/**
 * The visitor's conversation since `after`, oldest first: what they wrote and what the business
 * replied. Never a note, and never a reply still being sent or that failed. Messages are found by
 * when they were stored, looking back a little before the cursor, because a transaction that
 * began earlier can commit after a later one; the widget drops the ones it already shows.
 */
export async function listVisitorMessages(
  key: string,
  input: { token: string; after?: string },
): Promise<{ messages: ChatMessage[]; cursor: string | null; visitor: ChatVisitor }> {
  const widget = await requireWidget(key);
  const visitor = await requireVisitor(widget, input.token);
  const now = new Date();
  if (now.getTime() - visitor.lastSeenAt.getTime() > 60_000) {
    await adminDb()
      .update(livechatVisitors)
      .set({ lastSeenAt: now })
      .where(
        and(
          eq(livechatVisitors.tenantId, widget.tenantId),
          eq(livechatVisitors.id, visitor.id),
          lt(livechatVisitors.lastSeenAt, new Date(now.getTime() - 60_000)),
        ),
      );
  }
  if (!visitor.conversationId) {
    return { messages: [], cursor: input.after ?? null, visitor: visitorView(visitor) };
  }
  const rows = await adminDb()
    .select({
      id: socialMessages.id,
      direction: socialMessages.direction,
      body: socialMessages.body,
      sentAt: socialMessages.sentAt,
      stored: sql<string>`to_char(${socialMessages.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(socialMessages)
    .where(
      and(
        eq(socialMessages.tenantId, widget.tenantId),
        eq(socialMessages.accountId, widget.accountId),
        eq(socialMessages.conversationId, visitor.conversationId),
        inArray(socialMessages.direction, ['inbound', 'outbound']),
        ne(socialMessages.status, 'failed'),
        ne(socialMessages.status, 'sending'),
        input.after
          ? gt(
              socialMessages.createdAt,
              sql`${input.after}::timestamptz - make_interval(secs => ${OVERLAP_SECONDS})`,
            )
          : undefined,
      ),
    )
    // The first load shows the latest messages; later polls go forward from the cursor.
    .orderBy(
      input.after ? asc(socialMessages.createdAt) : desc(socialMessages.createdAt),
      input.after ? asc(socialMessages.id) : desc(socialMessages.id),
    )
    .limit(POLL_LIMIT);
  if (!input.after) rows.reverse();
  const last = rows.at(-1);
  const advanced =
    last && (!input.after || new Date(last.stored).getTime() > new Date(input.after).getTime());
  return {
    messages: rows.map((row) => ({
      id: row.id,
      from: row.direction === 'inbound' ? 'visitor' : 'business',
      body: row.body,
      at: row.sentAt.toISOString(),
    })),
    cursor: advanced ? last.stored : (input.after ?? null),
    visitor: visitorView(visitor),
  };
}
