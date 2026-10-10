import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';

loadEnvConfig(process.cwd());

/** The platform owner the browser tests sign in as. Synthetic, local only (.claude/CLAUDE.md). */
export const PLATFORM_OWNER = {
  email: process.env.E2E_PLATFORM_EMAIL ?? 'platform-owner@example.com',
  password: process.env.E2E_PLATFORM_PASSWORD ?? 'correct-horse-staple-42',
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Browser tests need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Creates the platform owner's login, or resets its password if it already exists. */
export async function ensurePlatformOwner(): Promise<void> {
  const supabase = adminClient();
  const { error } = await supabase.auth.admin.createUser({
    email: PLATFORM_OWNER.email,
    password: PLATFORM_OWNER.password,
    email_confirm: true,
    user_metadata: { full_name: 'Platform Owner' },
  });
  if (!error) return;
  // Already there from an earlier run: find it and make sure the password is the known one.
  for (let page = 1; ; page++) {
    const { data, error: listError } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (listError) throw listError;
    const user = data.users.find((candidate) => candidate.email === PLATFORM_OWNER.email);
    if (user) {
      const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
        password: PLATFORM_OWNER.password,
        email_confirm: true,
      });
      if (updateError) throw updateError;
      return;
    }
    if (data.users.length < 200) throw error;
  }
}
