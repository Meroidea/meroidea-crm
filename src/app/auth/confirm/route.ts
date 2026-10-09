import { NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/server/supabase/server';

/**
 * Where a set-your-password link lands. The one-time token in the link is exchanged with the
 * auth server for a session, then the person is sent to choose their password. A used or
 * expired token goes to the sign-in page with a plain explanation.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (tokenHash && (type === 'recovery' || type === 'invite')) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL('/set-password', url.origin));
  }
  return NextResponse.redirect(new URL('/login?link=expired', url.origin));
}
