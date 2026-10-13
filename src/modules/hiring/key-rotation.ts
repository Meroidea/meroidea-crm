import 'server-only';

import { and, asc, eq, gt, isNotNull, not, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { auditLogs, employeePayrollDetails } from '@/db/schema';
import {
  currentKeyPrefix,
  encryptionKeyStatus,
  needsReencryption,
  reencryptField,
} from '@/server/crypto';
import { adminDb } from '@/server/db/admin';
import type { PlatformAdmin } from '@/server/platform';

import { payrollBinding } from './service';

/*
 * Moving stored tax, bank and super numbers onto a new encryption key (ADR-040). The work spans
 * every business, so it runs on the privileged connection and only for a verified platform
 * owner. Each row is re-sealed in its own short transaction, so a long run never holds locks
 * across the table and can be repeated safely: a row already on the current key is skipped.
 */

const SEALED = [
  { column: employeePayrollDetails.taxFileNumberCiphertext, field: 'tfn' },
  { column: employeePayrollDetails.bankBsbCiphertext, field: 'bsb' },
  { column: employeePayrollDetails.bankAccountCiphertext, field: 'account' },
  { column: employeePayrollDetails.superMemberCiphertext, field: 'super' },
] as const;

const BATCH = 100;

function staleUnder(prefix: string): SQL {
  const stale = (column: PgColumn) =>
    and(isNotNull(column), not(sql`starts_with(${column}, ${prefix})`));
  return or(...SEALED.map(({ column }) => stale(column))) ?? sql`false`;
}

export type PayrollKeyStatus = ReturnType<typeof encryptionKeyStatus> & {
  /** Rows holding at least one value not yet sealed with the current key. */
  pending: number;
};

export async function payrollKeyStatus(admin: PlatformAdmin): Promise<PayrollKeyStatus> {
  void admin;
  const status = encryptionKeyStatus();
  const prefix = currentKeyPrefix();
  if (!prefix) return { ...status, pending: 0 };
  const [row] = await adminDb()
    .select({ pending: sql<number>`count(*)::int` })
    .from(employeePayrollDetails)
    .where(staleUnder(prefix));
  return { ...status, pending: row?.pending ?? 0 };
}

/**
 * Re-seals every stored value that is not on the current key. Values no configured key can
 * open are counted as failed and left untouched, never overwritten.
 */
export async function reencryptPayrollDetails(
  admin: PlatformAdmin,
): Promise<{ reencrypted: number; failed: number }> {
  const prefix = currentKeyPrefix();
  if (!prefix) return { reencrypted: 0, failed: 0 };
  const keyId = encryptionKeyStatus().currentKeyId;
  const db = adminDb();
  const perTenant = new Map<string, number>();
  let failed = 0;
  let after: string | null = null;

  for (;;) {
    const batch: { id: string }[] = await db
      .select({ id: employeePayrollDetails.id })
      .from(employeePayrollDetails)
      .where(and(staleUnder(prefix), after ? gt(employeePayrollDetails.id, after) : undefined))
      .orderBy(asc(employeePayrollDetails.id))
      .limit(BATCH);
    if (batch.length === 0) break;
    after = batch[batch.length - 1]!.id;

    for (const { id } of batch) {
      try {
        const tenantId = await db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(employeePayrollDetails)
            .where(eq(employeePayrollDetails.id, id))
            .limit(1)
            .for('update');
          if (!row) return null;
          const reseal = (value: string | null, field: string) =>
            value && needsReencryption(value)
              ? reencryptField(value, payrollBinding(row.tenantId, row.employeeId, field))
              : value;
          await tx
            .update(employeePayrollDetails)
            .set({
              taxFileNumberCiphertext: reseal(row.taxFileNumberCiphertext, 'tfn'),
              bankBsbCiphertext: reseal(row.bankBsbCiphertext, 'bsb'),
              bankAccountCiphertext: reseal(row.bankAccountCiphertext, 'account'),
              superMemberCiphertext: reseal(row.superMemberCiphertext, 'super'),
            })
            .where(eq(employeePayrollDetails.id, id));
          return row.tenantId;
        });
        if (tenantId) perTenant.set(tenantId, (perTenant.get(tenantId) ?? 0) + 1);
      } catch {
        // No configured key opens this row. It is left exactly as it was and reported.
        failed += 1;
      }
    }
  }

  for (const [tenantId, count] of perTenant) {
    await db.insert(auditLogs).values({
      tenantId,
      actorUserId: admin.userId,
      actorType: 'platform',
      action: 'update',
      entityType: 'employee_payroll_details',
      entityId: null,
      context: { reencrypted: count, keyId },
    });
  }
  return { reencrypted: [...perTenant.values()].reduce((sum, count) => sum + count, 0), failed };
}
