import 'server-only';

import { sql } from 'drizzle-orm';

type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * The next ticket number for a business. Taken under a lock held until the transaction ends,
 * so two tickets created at the same moment never get the same number.
 */
export async function nextTicketNumber(tx: Executor, tenantId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ticket-number:' || ${tenantId}))`);
  const rows = (await tx.execute(
    sql`select coalesce(max(number), 0) + 1 as next from tickets where tenant_id = ${tenantId}`,
  )) as unknown as { next: number }[];
  return Number(rows[0]?.next ?? 1);
}
