import { parseTikTokWebhook, verifyTikTokSignature } from '@/modules/social/providers/tiktok';
import { ingestTikTokNotification } from '@/modules/social/webhooks';
import { serverEnv } from '@/server/env';
import { PayloadTooLargeError, readBodyWithLimit } from '@/server/request';

/** TikTok's notifications are small JSON documents. */
const MAX_BODY_BYTES = 64 * 1024;

export const maxDuration = 30;

/**
 * TikTok Business Messaging notifications (ADR-064, ADR-065). A message notification is never
 * stored as it stands: it names the account and conversation, whose latest messages are then read
 * from TikTok's API with that account's own token. A signed notification (`TikTok-Signature`) is
 * trusted further: it skips the throttle on reads and may carry a read receipt. Unknown apps,
 * accounts and events are acknowledged and ignored, so nothing here tells a caller what exists.
 */
export async function POST(request: Request) {
  const { TIKTOK_APP_ID: appId, TIKTOK_APP_SECRET: secret } = serverEnv();
  if (!appId || !secret) return new Response('Not found', { status: 404 });
  let raw: Uint8Array;
  try {
    raw = await readBodyWithLimit(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return new Response('Too large', { status: 413 });
    throw error;
  }
  let body: unknown = null;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new Response('OK', { status: 200 });
  }
  const notification = parseTikTokWebhook(body);
  if (!notification) return new Response('OK', { status: 200 });
  const verified = verifyTikTokSignature(raw, request.headers.get('tiktok-signature'), secret);
  try {
    await ingestTikTokNotification(notification, verified);
  } catch (error) {
    console.error(
      '[social] tiktok webhook not stored',
      error instanceof Error ? error.name : typeof error,
    );
    return new Response('Try again', { status: 500 });
  }
  return new Response('OK', { status: 200 });
}
