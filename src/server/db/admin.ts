import 'server-only';

import { getDatabase, type Database } from './client';

/**
 * Connects as `postgres` and bypasses RLS. Only for migrations, seeds, cron, verified webhooks
 * and workspace provisioning (which has to write a tenant before any membership exists).
 */
export function adminDb(): Database {
  return getDatabase();
}
