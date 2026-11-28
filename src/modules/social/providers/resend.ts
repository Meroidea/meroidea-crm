import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { providerError } from '@/server/email';
import { serverEnv } from '@/server/env';

import { ProviderError } from './types';

/*
 * Resend for the email inbox (ADR-070), through its HTTP API (docs read 22 November 2026):
 * - Received mail is announced by an `email.received` webhook carrying only metadata; the words,
 *   headers and sender authentication come from GET /emails/receiving/{id}, and attachments'
 *   short-lived download links from GET /emails/receiving/{id}/attachments.
 * - Webhooks are signed the Svix way: base64 HMAC-SHA256 of `id.timestamp.body` with the
 *   secret after `whsec_`, in a space-separated `svix-signature` list of `v1,<signature>`.
 * - Replies go out with POST /emails, which returns the email's id; its RFC Message-ID arrives
 *   with the `email.sent` and later events.
 */

const API = 'https://api.resend.com';
/** Svix's libraries allow five minutes; so do we. */
const TOLERANCE_SECONDS = 5 * 60;

export function inboxDomain(): string | null {
  return serverEnv().INBOX_EMAIL_DOMAIN ?? null;
}

/** Whether the platform owner has set up the email inbox (docs/email-inbox.md). */
export function emailInboxConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.RESEND_API_KEY && env.INBOX_EMAIL_DOMAIN && env.RESEND_WEBHOOK_SECRET);
}

/**
 * Checks a Resend webhook's Svix signature over the raw body, and that it is recent. Any one
 * valid `v1` signature in the header is enough (secrets can be rotated with two live).
 */
export function verifyResendSignature(
  raw: Uint8Array,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  if (!secret.startsWith('whsec_')) return false;
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  if (key.length === 0) return false;
  const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), Buffer.from(raw)]);
  const expected = Buffer.from(createHmac('sha256', key).update(signed).digest('base64'));
  return signature
    .split(' ')
    .filter((entry) => entry.startsWith('v1,'))
    .some((entry) => {
      const given = Buffer.from(entry.slice(3));
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

const addressList = z
  .union([z.array(z.string()), z.string(), z.null()])
  .optional()
  .transform((value) => (value == null ? [] : Array.isArray(value) ? value : [value]));

/** The webhook's envelope; only what is used is read. */
export const resendEventSchema = z.object({
  type: z.string().max(64),
  created_at: z.string().optional(),
  data: z
    .object({
      email_id: z.string().max(100).optional(),
      message_id: z.string().max(1000).nullish(),
      from: z.string().max(1000).nullish(),
      to: addressList,
      cc: addressList,
      received_for: addressList,
      created_at: z.string().optional(),
      attachments: z.array(z.object({ id: z.string() }).loose()).optional(),
      bounce: z
        .object({ message: z.string().max(1000).optional() })
        .loose()
        .optional(),
    })
    .loose(),
});
export type ResendEvent = z.output<typeof resendEventSchema>;

const authResult = z
  .enum(['pass', 'fail', 'gray', 'processing_failed', 'unknown'])
  .catch('unknown');

const receivedSchema = z
  .object({
    id: z.string(),
    from: z.string().nullish(),
    to: addressList,
    cc: addressList,
    subject: z.string().nullish(),
    text: z.string().nullish(),
    html: z.string().nullish(),
    message_id: z.string().nullish(),
    created_at: z.string().nullish(),
    headers: z
      .record(z.string(), z.unknown())
      .nullish()
      .transform((value) =>
        Object.fromEntries(
          Object.entries(value ?? {}).map(([key, item]) => [
            key.toLowerCase(),
            Array.isArray(item) ? item.map(String).join(' ') : String(item ?? ''),
          ]),
        ),
      ),
    authentication: z
      .object({
        spf: authResult.optional(),
        dkim: authResult.optional(),
        dmarc: authResult.optional(),
      })
      .nullish(),
  })
  .loose();
export type ReceivedEmail = z.output<typeof receivedSchema>;

const attachmentsSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        filename: z.string().nullish(),
        content_type: z.string().nullish(),
        content_disposition: z.string().nullish(),
        size: z.number().nullish(),
        download_url: z.string(),
      })
      .loose(),
  ),
});
export type ReceivedAttachment = z.output<typeof attachmentsSchema>['data'][number];

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const key = serverEnv().RESEND_API_KEY;
  if (!key) throw new ProviderError('email', 'Email is not set up on this platform.');
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ProviderError('email', 'Could not reach the email service. Try again.');
  }
  if (response.status === 429) {
    throw new ProviderError('email', 'The email service is limiting requests.', {
      rateLimited: true,
      retryAfterMinutes: 1,
    });
  }
  if (!response.ok) {
    // Resend's reason is about the request (an address, a domain), never a message's words;
    // addresses in it are blanked. Its error name ("restricted_api_key") becomes the code, so
    // a refusal can be told apart from an outage in the logs.
    const { error, detail } = await providerError(response);
    throw new ProviderError(
      'email',
      detail ? `The email service refused it: ${detail}` : 'The email service refused it.',
      { code: error ?? response.status },
    );
  }
  return response.json();
}

/** A received email's words, headers and sender authentication. */
export async function fetchReceivedEmail(id: string): Promise<ReceivedEmail> {
  const parsed = receivedSchema.safeParse(
    await call(`/emails/receiving/${encodeURIComponent(id)}`),
  );
  if (!parsed.success) {
    throw new ProviderError('email', 'The email service sent something unexpected.', {
      code: 'unexpected_response',
    });
  }
  return parsed.data;
}

/** A received email's attachments, each with a short-lived download link. */
export async function listReceivedAttachments(id: string): Promise<ReceivedAttachment[]> {
  const parsed = attachmentsSchema.safeParse(
    await call(`/emails/receiving/${encodeURIComponent(id)}/attachments?limit=20`),
  );
  return parsed.success ? parsed.data.data : [];
}

export type OutgoingEmail = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string;
  replyTo: string;
  /** In-Reply-To and References, so the customer's mail program threads the reply. */
  headers: Record<string, string>;
  /** Files by a short-lived link Resend fetches while sending. */
  attachments: { filename: string; path: string; content_type: string }[];
  /** Makes a retried send go once (Resend keeps the key 24 hours). */
  idempotencyKey: string;
};

/** Sends one reply; returns Resend's email id. */
export async function sendResendEmail(email: OutgoingEmail): Promise<string> {
  const body = await call('/emails', {
    method: 'POST',
    headers: { 'Idempotency-Key': email.idempotencyKey },
    body: JSON.stringify({
      from: email.from,
      to: email.to,
      ...(email.cc.length > 0 ? { cc: email.cc } : {}),
      ...(email.bcc.length > 0 ? { bcc: email.bcc } : {}),
      subject: email.subject,
      text: email.text,
      html: email.html,
      reply_to: email.replyTo,
      headers: email.headers,
      ...(email.attachments.length > 0 ? { attachments: email.attachments } : {}),
    }),
  });
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !id) {
    throw new ProviderError('email', 'The email service did not confirm the message.');
  }
  return id;
}
