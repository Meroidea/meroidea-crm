import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/env.public';
import { serverEnv } from '@/server/env';

/**
 * Service-role client: bypasses RLS and can administer auth users. Only for provisioning,
 * seeds, cron and verified webhooks — never in a path acting on behalf of a signed-in user.
 */
export function createSupabaseAdminClient() {
  return createClient(publicEnv.supabaseUrl, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
