import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

loadEnvConfig(process.cwd());

/** The platform owner the browser tests sign in as. Synthetic, local only (.claude/CLAUDE.md). */
export const PLATFORM_OWNER = {
  email: process.env.E2E_PLATFORM_EMAIL ?? 'platform-owner@example.com',
  password: process.env.E2E_PLATFORM_PASSWORD ?? 'correct-horse-staple-42',
};

/**
 * The platform owner's signed-in session, saved once by global-setup.ts. Tests start from it
 * rather than signing in again. Nothing may sign this session out: signing out ends every
 * session the account has, including the one other tests are using.
 */
export const PLATFORM_OWNER_STATE = 'playwright/.auth/platform-owner.json';

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

/**
 * Makes sure a service agreement is published, since onboarding a business needs one (ADR-047).
 * Written straight to the local test database: the console's publish form is not what these
 * tests are about.
 */
export async function ensureServiceAgreement(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Browser tests need DATABASE_URL.');
  const sql = postgres(url, { max: 1 });
  try {
    await sql`
      insert into service_agreements (version, title, body, published_by)
      select 1, 'Test service agreement',
        ${'These are the test terms between Meroidea and the business, for browser tests only. '.repeat(4)},
        gen_random_uuid()
      where not exists (select 1 from service_agreements)`;
  } finally {
    await sql.end();
  }
}
