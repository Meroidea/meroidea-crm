import { resendEventSchema, verifyResendSignature } from '@/modules/social/providers/resend';
import { applyResendDelivery, ingestReceivedEmail } from '@/modules/social/webhooks';
import { serverEnv } from '@/server/env';
import { PayloadTooLargeError, readBodyWithLimit } from '@/server/request';

/** Resend's events carry metadata only (ADR-070): a few kilobytes, far less than this. */
const MAX_BODY_BYTES = 256 * 1024;

export const maxDuration = 60;

const DELIVERY_EVENTS = new Set([
  'email.sent',
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
]);

/**
 * Received mail for the email inbox, and events about replies sent from it. Nothing is read or
 * stored until the Svix signature over the raw body checks out against the webhook's secret.
 * Resend retries anything but a 2xx, so a failure to store is answered with a 500; storing is
 * idempotent on Resend's email id.
 */
export async function POST(request: Request) {
  const secret = serverEnv().RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response('Not found', { status: 404 });
  let raw: Uint8Array;
  try {
    raw = await readBodyWithLimit(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return new Response('Too large', { status: 413 });
    throw error;
  }
  const signed = verifyResendSignature(
    raw,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    secret,
  );
  if (!signed) return new Response('Forbidden', { status: 403 });
  let event;
  try {
    const parsed = resendEventSchema.safeParse(JSON.parse(new TextDecoder().decode(raw)));
    if (!parsed.success) return new Response('Bad request', { status: 400 });
    event = parsed.data;
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  try {
    if (event.type === 'email.received') await ingestReceivedEmail(event);
    else if (DELIVERY_EVENTS.has(event.type)) await applyResendDelivery(event);
  } catch (error) {
    // Never the payload: it names people and addresses.
    console.error('[email] webhook not stored', error instanceof Error ? error.name : typeof error);
    return new Response('Try again', { status: 500 });
  }
  return new Response('OK', { status: 200 });
}
