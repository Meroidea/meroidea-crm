import { z } from 'zod';

import { WIDGET_ORIGIN } from './settings';

/*
 * Live chat's inputs (ADR-072): what a visitor's widget sends, and what an admin sets up. The
 * visitor's token travels in a request body or header, never in an address.
 */

export const WIDGET_KEY = /^[A-Za-z0-9_-]{24}$/;
const visitorToken = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

const optionalName = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => value || undefined);
const optionalEmail = z
  .union([z.email('Enter a valid email address').max(200), z.literal('')])
  .optional()
  .transform((value) => value?.toLowerCase() || undefined);

/** Starting or resuming a visitor's chat: their token when they have one, and who they are. */
export const chatSessionSchema = z.object({
  token: visitorToken.optional(),
  name: optionalName,
  email: optionalEmail,
  /**
   * Who the business's own site says the visitor is: the email and an HMAC-SHA256 (hex) of it
   * with the widget's identity secret, made on the business's server.
   */
  identity: z
    .object({
      email: z
        .email()
        .max(200)
        .transform((value) => value.toLowerCase()),
      name: optionalName,
      signature: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
});
/** What the session service takes: the schema's output, with left-out fields optional. */
export type ChatSessionInput = {
  token?: string;
  name?: string;
  email?: string;
  identity?: { email: string; name?: string; signature: string };
};

export const chatMessageSchema = z.object({
  token: visitorToken,
  /** Made by the widget per message, so a retried send is stored once. */
  clientId: z.uuid(),
  body: z.string().trim().min(1, 'Write a message').max(2000, 'That message is too long'),
});

export const chatPollSchema = z.object({
  token: visitorToken,
  after: z.iso.datetime({ offset: true }).optional(),
});

/** A widget's set-up, by an admin with social.manage. */
export const chatWidgetSchema = z.object({
  accountId: z.uuid().optional(),
  name: z.string().trim().min(2, 'Give it a name').max(80, 'Keep the name under 80 characters'),
  allowedOrigins: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .transform((value) => value.replace(/\/+$/, ''))
        .pipe(z.string().regex(WIDGET_ORIGIN, 'Use a site address like https://www.example.com')),
    )
    .max(10, 'At most 10 sites'),
  // Nullable too: the form parses before sending, and the action parses that output again.
  greeting: z
    .string()
    .trim()
    .max(300, 'Keep the greeting under 300 characters')
    .nullish()
    .transform((value) => value || null),
  requireEmail: z.boolean(),
});
export type ChatWidgetInput = z.output<typeof chatWidgetSchema>;
