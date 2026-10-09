import 'server-only';

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';
import { serverEnv } from '@/server/env';

// This connection runs as `postgres`, which bypasses RLS. Only with-rls.ts and admin.ts may
// import it (enforced in eslint.config.mjs); everything else goes through withRls() or adminDb.

export type Database = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { meroideaSql?: postgres.Sql };

let database: Database | undefined;

export function getDatabase(): Database {
  if (!database) {
    // prepare: false — Supabase's transaction pooler cannot use prepared statements.
    const sql =
      globalForDb.meroideaSql ?? postgres(serverEnv().DATABASE_URL, { prepare: false, max: 5 });
    // Reuse one pool across dev hot reloads instead of leaking a pool per edit.
    if (process.env.NODE_ENV !== 'production') globalForDb.meroideaSql = sql;
    database = drizzle({ client: sql, schema, casing: 'snake_case' });
  }
  return database;
}
