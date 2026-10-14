import 'server-only';

import { and, eq, gt } from 'drizzle-orm';

import { auditLogs, serviceAgreements, tenantAgreements, tenants } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { hashLinkToken } from '@/server/crypto';
import { adminDb } from '@/server/db/admin';

import type { AcceptAgreementInput } from './schemas';

/*
 * The business admin's side of the service agreement (ADR-047). They cannot sign in until they
 * accept, so there is no session for RLS to match: this file uses the privileged connection and
 * the one-time link is the only credential. Every function starts from the link's hash and
 * touches only the one request it names. Nothing here takes a tenant or record id from the caller.
 */

const GONE = 'This link is no longer valid. Ask Meroidea to send you a new one.';

type Db = ReturnType<typeof adminDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type PublicAgreement = {
  businessName: string;
  recipientName: string;
  title: string;
  version: number;
  body: string;
};

function findOpen(db: Db | Tx, token: string) {
  return db
    .select({
      id: tenantAgreements.id,
      tenantId: tenantAgreements.tenantId,
      recipientUserId: tenantAgreements.recipientUserId,
      recipientName: tenantAgreements.recipientName,
      recipientEmail: tenantAgreements.recipientEmail,
      agreementId: tenantAgreements.agreementId,
      businessName: tenants.name,
      title: serviceAgreements.title,
      version: serviceAgreements.version,
      body: serviceAgreements.body,
    })
    .from(tenantAgreements)
    .innerJoin(tenants, eq(tenants.id, tenantAgreements.tenantId))
    .innerJoin(serviceAgreements, eq(serviceAgreements.id, tenantAgreements.agreementId))
    .where(
      and(
        eq(tenantAgreements.tokenHash, hashLinkToken(token)),
        gt(tenantAgreements.tokenExpiresAt, new Date()),
      ),
    )
    .limit(1);
}

/** The agreement a valid, unexpired, unused link asks its holder to accept; otherwise null. */
export async function getAgreementByToken(token: string): Promise<PublicAgreement | null> {
  const [row] = await findOpen(adminDb(), token);
  if (!row) return null;
  return {
    businessName: row.businessName,
    recipientName: row.recipientName,
    title: row.title,
    version: row.version,
    body: row.body,
  };
}

const sameName = (typed: string, expected: string) =>
  typed.trim().replace(/\s+/g, ' ').toLowerCase() ===
  expected.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Records the admin's acceptance (typed name, time, network address and browser, against the
 * exact version shown), spends the link, and opens a business that was waiting for it. Returns
 * the admin's email so the caller can issue their one-time link to choose a password.
 */
export async function acceptAgreement(
  input: AcceptAgreementInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ email: string }> {
  return adminDb().transaction(async (tx) => {
    const [row] = await findOpen(tx, input.token).for('update', { of: tenantAgreements });
    if (!row) throw new AppError('NOT_FOUND', GONE);
    if (!sameName(input.fullName, row.recipientName)) {
      throw new AppError('VALIDATION', 'The name does not match.', {
        fullName: [`Type your name as Meroidea recorded it: ${row.recipientName}`],
      });
    }

    await tx
      .update(tenantAgreements)
      .set({
        acceptedAt: new Date(),
        acceptedName: input.fullName.trim(),
        acceptedIp: meta.ip,
        acceptedUserAgent: meta.userAgent?.slice(0, 300) ?? null,
        // Spent: the same link can never sign anyone in again.
        tokenHash: null,
        tokenExpiresAt: null,
      })
      .where(eq(tenantAgreements.id, row.id));
    // A business suspended in the meantime stays suspended; reactivating it opens it.
    await tx
      .update(tenants)
      .set({ status: 'active' })
      .where(and(eq(tenants.id, row.tenantId), eq(tenants.status, 'awaiting_agreement')));
    await tx.insert(auditLogs).values({
      tenantId: row.tenantId,
      actorUserId: row.recipientUserId,
      actorType: 'agreement_link',
      action: 'accept',
      entityType: 'tenant_agreement',
      entityId: row.id,
      context: { agreementVersion: row.version },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { email: row.recipientEmail };
  });
}
