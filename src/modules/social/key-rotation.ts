import 'server-only';

import { and, asc, eq, gt, isNotNull, not, or, sql, type SQL } from 'drizzle-orm';

import { auditLogs, socialAccountCredentials } from '@/db/schema';
import {
  currentKeyPrefix,
  encryptionKeyStatus,
  needsReencryption,
  reencryptField,
} from '@/server/crypto';
import { adminDb } from '@/server/db/admin';
import type { PlatformAdmin } from '@/server/platform';

import { credentialBinding } from './credentials';

/*
 * Social account tokens are sealed with the same key as staff payroll numbers, so a key rotation
 * (ADR-040) must move them too, or every connected account would stop working when the old key is
 * removed. Same rules: privileged connection, platform owners only, one short transaction per
 * row, a value no configured key opens is left untouched and counted.
 */

const BATCH = 100;

function staleUnder(prefix: string): SQL {
  const columns = [
    socialAccountCredentials.accessTokenCiphertext,
    socialAccountCredentials.refreshTokenCiphertext,
  ];
  return (
    or(
      ...columns.map((column) =>
        and(isNotNull(column), not(sql`starts_with(${column}, ${prefix})`)),
      ),
    ) ?? sql`false`
  );
}

/** Connected accounts whose tokens are not yet sealed with the current key. */
export async function socialCredentialsPending(admin: PlatformAdmin): Promise<number> {
  void admin;
  const prefix = currentKeyPrefix();
  if (!prefix) return 0;
  const [row] = await adminDb()
    .select({ pending: sql<number>`count(*)::int` })
    .from(socialAccountCredentials)
    .where(staleUnder(prefix));
  return row?.pending ?? 0;
}

export async function reencryptSocialCredentials(
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
      .select({ id: socialAccountCredentials.accountId })
      .from(socialAccountCredentials)
      .where(
        and(staleUnder(prefix), after ? gt(socialAccountCredentials.accountId, after) : undefined),
      )
      .orderBy(asc(socialAccountCredentials.accountId))
      .limit(BATCH);
    if (batch.length === 0) break;
    after = batch[batch.length - 1]!.id;

    for (const { id } of batch) {
      try {
        const tenantId = await db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(socialAccountCredentials)
            .where(eq(socialAccountCredentials.accountId, id))
            .limit(1)
            .for('update');
          if (!row) return null;
          const reseal = (value: string | null, part: 'access' | 'refresh') =>
            value && needsReencryption(value)
              ? reencryptField(value, credentialBinding(row.tenantId, row.accountId, part))
              : value;
          await tx
            .update(socialAccountCredentials)
            .set({
              accessTokenCiphertext: reseal(row.accessTokenCiphertext, 'access')!,
              refreshTokenCiphertext: reseal(row.refreshTokenCiphertext, 'refresh'),
            })
            .where(eq(socialAccountCredentials.accountId, id));
          return row.tenantId;
        });
        if (tenantId) perTenant.set(tenantId, (perTenant.get(tenantId) ?? 0) + 1);
      } catch {
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
      entityType: 'social_account_credentials',
      entityId: null,
      context: { reencrypted: count, keyId },
    });
  }
  return { reencrypted: [...perTenant.values()].reduce((sum, count) => sum + count, 0), failed };
}
