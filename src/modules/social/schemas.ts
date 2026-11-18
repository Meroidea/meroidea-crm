import { z } from 'zod';

import { OAUTH_PROVIDERS } from './oauth-state-keys';
import { SOCIAL_PLATFORMS } from './providers/types';

export const INBOX_VIEWS = ['open', 'unread', 'done', 'all'] as const;

export const inboxFiltersSchema = z.object({
  view: z.enum(INBOX_VIEWS).optional().catch(undefined),
  platform: z.enum(SOCIAL_PLATFORMS).optional().catch(undefined),
  cursor: z.string().max(300).optional().catch(undefined),
});
export type InboxFilters = z.output<typeof inboxFiltersSchema>;

export const startConnectSchema = z.object({ provider: z.enum(OAUTH_PROVIDERS) });

export const accountIdSchema = z.object({ accountId: z.uuid() });

export const conversationIdSchema = z.object({ conversationId: z.uuid() });

/** The longest any provider accepts (TikTok); each platform's own limit is checked when sending. */
export const replySchema = z.object({
  conversationId: z.uuid(),
  body: z.string().trim().min(1, 'Write a reply first').max(6000, 'That reply is too long'),
});
export type ReplyInput = z.output<typeof replySchema>;

export const messageIdSchema = z.object({ messageId: z.uuid() });

export const linkContactSchema = z.object({
  conversationId: z.uuid(),
  contactId: z.uuid().nullable(),
});

export const conversationStatusSchema = z.object({
  conversationId: z.uuid(),
  status: z.enum(['open', 'done']),
});
