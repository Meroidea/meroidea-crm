import 'server-only';

import { NextResponse } from 'next/server';

import { getTenantContext, hasPermission, workspaceClosedReason } from '@/server/context';
import { socialMediaUrl } from '@/server/storage';

/**
 * Serves a saved file to a person who may read the conversation, by redirecting to a one-minute
 * signed link; the browser asks again whenever it needs the file, and is checked again each
 * time. Anything not allowed or not there is simply not found.
 */
export async function serveSocialMedia(
  find: (ctx: NonNullable<Awaited<ReturnType<typeof getTenantContext>>>) => Promise<string | null>,
): Promise<Response> {
  const ctx = await getTenantContext();
  if (!ctx || workspaceClosedReason(ctx) || !hasPermission(ctx, 'social.view')) {
    return new Response('Not found', { status: 404 });
  }
  const path = await find(ctx).catch(() => null);
  if (!path) return new Response('Not found', { status: 404 });
  const response = NextResponse.redirect(await socialMediaUrl(path), 302);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
