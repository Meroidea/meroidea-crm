import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { checkOAuthState, OAUTH_COOKIE } from '@/modules/social/oauth-state';
import { OAUTH_PROVIDERS, type OAuthProvider } from '@/modules/social/oauth-state-keys';
import { connectAccounts } from '@/modules/social/service';
import { ProviderError } from '@/modules/social/providers/types';
import { getTenantContext, hasPermission, workspaceClosedReason } from '@/server/context';
import { serverEnv } from '@/server/env';

export const maxDuration = 60;

/**
 * Where Meta or TikTok send the browser back after the business logged in (ADR-064). It runs
 * as the signed-in person, under their permissions and row-level security like any action:
 * the state must match the cookie set when they started, for the same person and business.
 * The code in the address is single use and is never logged or put in a redirect.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<'/api/social/oauth/[provider]'>,
) {
  const { provider: raw } = await params;
  const appUrl = serverEnv().APP_URL;
  const back = (query: string) => {
    const response = NextResponse.redirect(new URL(`/social/accounts?${query}`, appUrl));
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.cookies.delete({ name: OAUTH_COOKIE, path: `/api/social/oauth/${raw}` });
    return response;
  };
  if (!(OAUTH_PROVIDERS as readonly string[]).includes(raw)) return back('error=unknown');
  const provider = raw as OAuthProvider;

  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.redirect(new URL('/login', appUrl));
  if (workspaceClosedReason(ctx) || !hasPermission(ctx, 'social.manage')) {
    return back('error=forbidden');
  }
  const query = new URL(request.url).searchParams;
  const cookie = (await cookies()).get(OAUTH_COOKIE)?.value;
  if (
    !checkOAuthState(cookie, query.get('state'), {
      provider,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    })
  ) {
    return back('error=expired');
  }
  if (query.get('error')) return back('error=cancelled');
  const code = query.get('code') ?? query.get('auth_code');
  if (!code || code.length > 2048) return back('error=cancelled');

  try {
    const result = await connectAccounts(
      ctx,
      provider,
      code,
      `${appUrl}/api/social/oauth/${provider}`,
    );
    return back(
      new URLSearchParams({
        connected: String(result.connected),
        skipped: String(result.skipped),
        failed: String(result.failed),
      }).toString(),
    );
  } catch (error) {
    if (error instanceof ProviderError) return back('error=provider');
    console.error('[social] connect failed', error instanceof Error ? error.name : typeof error);
    return back('error=internal');
  }
}
