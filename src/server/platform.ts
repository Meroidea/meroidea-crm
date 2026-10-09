import 'server-only';

import { notFound, redirect } from 'next/navigation';

import { AppError } from '@/lib/errors';
import { serverEnv } from '@/server/env';
import { createSupabaseServerClient } from '@/server/supabase/server';

export type PlatformAdmin = { userId: string; email: string };

/** The platform owners' emails, from the server environment only. */
function ownerEmails(): string[] {
  return (serverEnv().PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The signed-in person, if they are a platform owner: someone who runs Meroidea itself and may
 * see and manage every business on it (ADR-029). Identity comes from the auth server, never
 * from a cookie's contents, and the list of owners never reaches the browser.
 */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!user || !email || !user.email_confirmed_at) return null;
  return ownerEmails().includes(email) ? { userId: user.id, email } : null;
}

/** For platform pages: sign-in for strangers, and "not found" for everyone who is not an owner. */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const admin = await getPlatformAdmin();
  // Not found rather than forbidden: a business's staff should not learn this area exists.
  if (!admin) notFound();
  return admin;
}

/** For platform actions, which are public endpoints like any other action. */
export async function assertPlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await getPlatformAdmin();
  if (!admin) throw new AppError('NOT_FOUND', 'Not found.');
  return admin;
}
