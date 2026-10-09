import 'server-only';

import { sql } from 'drizzle-orm';

import { getDatabase, type Database } from './client';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type SessionClaims = { sub: string; role: 'authenticated'; email?: string };

/**
 * Runs `fn` as the `authenticated` role with the JWT claims and active tenant set, so every
 * RLS policy applies. Drizzle otherwise connects as `postgres`, which bypasses RLS (ADR-006).
 * `set_config(..., true)` and `set local` last only for this transaction, which is what the
 * Supabase transaction pooler supports.
 */
export async function withRls<T>(
  ctx: { claims: SessionClaims; tenantId: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(ctx.claims)}, true),
                 set_config('app.tenant_id', ${ctx.tenantId}, true)`,
    );
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

/** Same, before a tenant is known: used only to resolve which workspace the person belongs to. */
export async function withAuthedSession<T>(
  claims: SessionClaims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}
