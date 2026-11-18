import { parseTikTokWebhook } from '@/modules/social/providers/tiktok';
import { ingestTikTokNotification } from '@/modules/social/webhooks';
import { serverEnv } from '@/server/env';
import { readJsonBody } from '@/server/request';

/** TikTok's notifications are small JSON documents. */
const MAX_BODY_BYTES = 64 * 1024;

export const maxDuration = 30;

/**
 * TikTok Business Messaging notifications. They carry no signature this app can check, so the
 * body is never stored: it only names the account and conversation, whose latest messages are
 * then read from TikTok's API with that account's own token (ADR-064). Unknown apps, accounts
 * and events are acknowledged and ignored, so nothing here tells a caller what exists.
 */
export async function POST(request: Request) {
  if (!serverEnv().TIKTOK_APP_ID) return new Response('Not found', { status: 404 });
  const body = await readJsonBody(request, MAX_BODY_BYTES).catch(() => null);
  const notification = body ? parseTikTokWebhook(body) : null;
  if (!notification) return new Response('OK', { status: 200 });
  try {
    await ingestTikTokNotification(notification);
  } catch (error) {
    console.error(
      '[social] tiktok webhook not stored',
      error instanceof Error ? error.name : typeof error,
    );
    return new Response('Try again', { status: 500 });
  }
  return new Response('OK', { status: 200 });
}
