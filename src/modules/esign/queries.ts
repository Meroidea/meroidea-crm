import 'server-only';

import { alias } from 'drizzle-orm/pg-core';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import {
  libraryDocuments,
  signRequestEvents,
  signRequestFields,
  signRequests,
  signRequestSigners,
  users,
} from '@/db/schema';
import { decodeCursor, encodeCursor } from '@/lib/cursor';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { FieldKind } from './geometry';
import type { RequestFilters } from './schemas';
import type {
  SignerStatus,
  SigningOrder,
  SignRequestDetail,
  SignRequestRow,
  SignRequestStatus,
} from './types';

export const REQUEST_PAGE_SIZE = 50;

const isExpired = (status: string, expiresAt: Date | null) =>
  status === 'sent' && expiresAt !== null && expiresAt.getTime() <= Date.now();

export async function listSignRequests(
  ctx: TenantContext,
  filters: RequestFilters,
  documentId?: string,
): Promise<{ items: SignRequestRow[]; nextCursor: string | null }> {
  requirePermission(ctx, 'files.request_signatures');
  const where: (SQL | undefined)[] = [
    eq(signRequests.tenantId, ctx.tenantId),
    isNull(signRequests.deletedAt),
  ];
  if (filters.status) where.push(eq(signRequests.status, filters.status));
  if (documentId) where.push(eq(signRequests.documentId, documentId));
  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    where.push(
      sql`(${signRequests.createdAt}, ${signRequests.id}) < (${cursor.createdAt}, ${cursor.id}::uuid)`,
    );
  }

  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: signRequests.id,
        title: signRequests.title,
        status: signRequests.status,
        expiresAt: signRequests.expiresAt,
        documentName: libraryDocuments.name,
        createdAt: signRequests.createdAt,
        sentAt: signRequests.sentAt,
        completedAt: signRequests.completedAt,
        signerCount: sql<number>`(select count(*)::int from ${signRequestSigners} s
          where s.tenant_id = ${signRequests.tenantId} and s.request_id = ${signRequests.id})`,
        signedCount: sql<number>`(select count(*)::int from ${signRequestSigners} s
          where s.tenant_id = ${signRequests.tenantId} and s.request_id = ${signRequests.id}
            and s.status = 'signed')`,
      })
      .from(signRequests)
      .innerJoin(
        libraryDocuments,
        and(
          eq(libraryDocuments.tenantId, signRequests.tenantId),
          eq(libraryDocuments.id, signRequests.documentId),
        ),
      )
      .where(and(...where))
      .orderBy(desc(signRequests.createdAt), desc(signRequests.id))
      .limit(REQUEST_PAGE_SIZE + 1),
  );

  const page = rows.slice(0, REQUEST_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map(({ expiresAt, ...row }) => ({
      ...row,
      status: row.status as SignRequestStatus,
      expired: isExpired(row.status, expiresAt),
    })),
    nextCursor: rows.length > REQUEST_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

export async function getSignRequest(
  ctx: TenantContext,
  id: string,
): Promise<SignRequestDetail | null> {
  requirePermission(ctx, 'files.request_signatures');
  const sender = alias(users, 'sender');
  const actor = alias(users, 'actor');

  return withRls(ctx, async (tx) => {
    const [request] = await tx
      .select({
        request: signRequests,
        documentName: libraryDocuments.name,
        sentByName: sender.fullName,
      })
      .from(signRequests)
      .innerJoin(
        libraryDocuments,
        and(
          eq(libraryDocuments.tenantId, signRequests.tenantId),
          eq(libraryDocuments.id, signRequests.documentId),
        ),
      )
      .leftJoin(sender, eq(sender.id, signRequests.sentBy))
      .where(
        and(
          eq(signRequests.tenantId, ctx.tenantId),
          eq(signRequests.id, id),
          isNull(signRequests.deletedAt),
        ),
      )
      .limit(1);
    if (!request) return null;

    // Column by column: the credential columns are not granted to signed-in people at all.
    const signers = await tx
      .select({
        id: signRequestSigners.id,
        position: signRequestSigners.position,
        name: signRequestSigners.name,
        email: signRequestSigners.email,
        status: signRequestSigners.status,
        invitedAt: signRequestSigners.invitedAt,
        verifiedAt: signRequestSigners.verifiedAt,
        viewedAt: signRequestSigners.viewedAt,
        signedAt: signRequestSigners.signedAt,
        declinedAt: signRequestSigners.declinedAt,
        declineReason: signRequestSigners.declineReason,
      })
      .from(signRequestSigners)
      .where(
        and(eq(signRequestSigners.tenantId, ctx.tenantId), eq(signRequestSigners.requestId, id)),
      )
      .orderBy(asc(signRequestSigners.position));

    const fields = await tx
      .select({
        id: signRequestFields.id,
        signerId: signRequestFields.signerId,
        kind: signRequestFields.kind,
        page: signRequestFields.page,
        x: signRequestFields.x,
        y: signRequestFields.y,
        width: signRequestFields.width,
        height: signRequestFields.height,
        required: signRequestFields.required,
        label: signRequestFields.label,
        filledAt: signRequestFields.filledAt,
      })
      .from(signRequestFields)
      .where(and(eq(signRequestFields.tenantId, ctx.tenantId), eq(signRequestFields.requestId, id)))
      .orderBy(asc(signRequestFields.page), asc(signRequestFields.y), asc(signRequestFields.x));

    const events = await tx
      .select({
        id: signRequestEvents.id,
        event: signRequestEvents.event,
        signerName: signRequestSigners.name,
        actorName: actor.fullName,
        createdAt: signRequestEvents.createdAt,
      })
      .from(signRequestEvents)
      .leftJoin(
        signRequestSigners,
        and(
          eq(signRequestSigners.tenantId, signRequestEvents.tenantId),
          eq(signRequestSigners.id, signRequestEvents.signerId),
        ),
      )
      .leftJoin(actor, eq(actor.id, signRequestEvents.actorUserId))
      .where(and(eq(signRequestEvents.tenantId, ctx.tenantId), eq(signRequestEvents.requestId, id)))
      .orderBy(asc(signRequestEvents.createdAt));

    const r = request.request;
    return {
      id: r.id,
      documentId: r.documentId,
      documentName: request.documentName,
      documentVersion: r.documentVersion,
      title: r.title,
      message: r.message,
      status: r.status as SignRequestStatus,
      expired: isExpired(r.status, r.expiresAt),
      signingOrder: r.signingOrder as SigningOrder,
      verifyEmail: r.verifyEmail,
      expiryDays: r.expiryDays,
      expiresAt: r.expiresAt,
      pageCount: r.pageCount,
      originalSha256: r.originalSha256,
      signedSha256: r.signedSha256,
      sentAt: r.sentAt,
      sentByName: request.sentByName,
      completedAt: r.completedAt,
      voidedAt: r.voidedAt,
      voidReason: r.voidReason,
      createdAt: r.createdAt,
      signers: signers.map((signer) => ({ ...signer, status: signer.status as SignerStatus })),
      fields: fields.map(({ filledAt, ...field }) => ({
        ...field,
        kind: field.kind as FieldKind,
        filled: filledAt !== null,
      })),
      events,
    };
  });
}
