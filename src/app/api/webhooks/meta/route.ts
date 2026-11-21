import { timingSafeEqual } from 'node:crypto';

import {
  parseMetaReceipts,
  parseMetaWebhook,
  verifyMetaSignature,
} from '@/modules/social/providers/meta-webhook';
import { parseWhatsAppWebhook } from '@/modules/social/providers/whatsapp-webhook';
import {
  applyMetaReceipts,
  ingestMetaEvents,
  ingestWhatsAppWebhook,
} from '@/modules/social/webhooks';
import { serverEnv } from '@/server/env';
import { PayloadTooLargeError, readBodyWithLimit } from '@/server/request';

/**
 * A message notification is a few kilobytes, but WhatsApp sends a connected WhatsApp Business
 * app's chat history in batches of up to 3 MB (ADR-066); far larger is not Meta.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const maxDuration = 60;

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Meta checks the webhook address when it is added in the App Dashboard: it sends the verify
 * token the platform owner typed there and expects the challenge back (ADR-064).
 */
export function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const expected = serverEnv().META_WEBHOOK_VERIFY_TOKEN;
  const token = query.get('hub.verify_token') ?? '';
  const challenge = query.get('hub.challenge') ?? '';
  if (
    !expected ||
    query.get('hub.mode') !== 'subscribe' ||
    !sameText(token, expected) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(challenge)
  ) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
}

/**
 * Messages for connected Facebook Pages, Instagram accounts and WhatsApp numbers. Nothing is
 * read or stored until the body's signature is checked against the app secret. Meta retries
 * anything but a 200, so a failure to store is answered with a 500 to have it sent again; events
 * are stored idempotently.
 */
export async function POST(request: Request) {
  const secret = serverEnv().META_APP_SECRET;
  if (!secret) return new Response('Not found', { status: 404 });
  let raw: Uint8Array;
  try {
    raw = await readBodyWithLimit(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return new Response('Too large', { status: 413 });
    throw error;
  }
  if (!verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), secret)) {
    return new Response('Forbidden', { status: 403 });
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  try {
    await ingestMetaEvents(parseMetaWebhook(body));
    await applyMetaReceipts(parseMetaReceipts(body));
    await ingestWhatsAppWebhook(parseWhatsAppWebhook(body));
  } catch (error) {
    // Never the payload: it holds customers' messages.
    console.error(
      '[social] meta webhook not stored',
      error instanceof Error ? error.name : typeof error,
    );
    return new Response('Try again', { status: 500 });
  }
  return new Response('OK', { status: 200 });
}
