import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env.public';
import { chatFramePolicy } from '@/modules/social/livechat-frame';

/**
 * Refreshes the Supabase session cookie on every navigation. Authorization itself happens in
 * pages and actions via getTenantContext() — proxy checks are optimistic only (Next.js docs).
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();

  // A live chat widget's page may be framed only by the sites its business listed (ADR-072).
  const chat = /^\/chat\/([^/]+)\/?$/.exec(request.nextUrl.pathname);
  if (chat?.[1]) {
    response.headers.set('Content-Security-Policy', await chatFramePolicy(chat[1]));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logos/|widget/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
