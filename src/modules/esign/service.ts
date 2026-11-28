import 'server-only';

import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import {
  libraryDocuments,
  libraryDocumentVersions,
  signRequestEvents,
  signRequestFields,
  signRequests,
  signRequestSigners,
  users,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { createLinkToken } from '@/server/crypto';
import { withRls, type Tx } from '@/server/db/with-rls';
import { isEmailConfigured, sendEmail } from '@/server/email';
import { serverEnv } from '@/server/env';
import { createDownloadUrl, readObject } from '@/server/storage';

import { invitationEmail, voidedEmail } from './emails';
import type { FieldKind } from './geometry';
import { sendProblems, signersWhoseTurnItIs } from './rules';
import type { SaveDraftInput } from './schemas';
import { inspectPdf, sha256Hex } from './stamp';

/**
 * Staff side of signature requests (ADR-094): drafting, sending, reminding, voiding and
 * downloading. Everything runs as the signed-in person through RLS. What signers do is in
 * ./public.ts.
 */

/** A signer's link stays usable this long when the request itself has no expiry. */
export const OPEN_LINK_DAYS = 180;
const DAY = 86_400_000;
const NOT_FOUND = 'That signature request was not found.';

export type Invitation = { signerId: string; name: string; emailed: boolean; link: string | null };

const signingLink = (token: string) => `${serverEnv().APP_URL}/sign/${token}`;

async function lockRequest(tx: Tx, ctx: TenantContext, id: string) {
  const [request] = await tx
    .select()
    .from(signRequests)
    .where(
      and(
        eq(signRequests.tenantId, ctx.tenantId),
        eq(signRequests.id, id),
        isNull(signRequests.deletedAt),
      ),
    )
    .limit(1)
    .for('update');
  if (!request) throw new AppError('NOT_FOUND', NOT_FOUND);
  return request;
}

function event(
  tx: Tx,
  ctx: TenantContext,
  requestId: string,
  name: 'created' | 'sent' | 'invited' | 'voided',
  signerId: string | null = null,
) {
  return tx.insert(signRequestEvents).values({
    tenantId: ctx.tenantId,
    requestId,
    signerId,
    actorUserId: ctx.userId,
    event: name,
  });
}

async function myName(tx: Tx, ctx: TenantContext): Promise<string> {
  const [me] = await tx
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);
  return me?.fullName || ctx.email;
}

/**
 * Issues a fresh link: only its hash is stored, so the secret exists in this request's memory and
 * the email, nowhere else. A newer link replaces the older one.
 */
async function issueLink(
  tx: Tx,
  ctx: TenantContext,
  requestId: string,
  signerId: string,
  expiresAt: Date | null,
): Promise<string> {
  const { token, hash } = createLinkToken();
  const now = new Date();
  await tx
    .update(signRequestSigners)
    .set({
      tokenHash: hash,
      tokenExpiresAt: expiresAt ?? new Date(now.getTime() + OPEN_LINK_DAYS * DAY),
      invitedAt: now,
    })
    .where(and(eq(signRequestSigners.tenantId, ctx.tenantId), eq(signRequestSigners.id, signerId)));
  await event(tx, ctx, requestId, 'invited', signerId);
  return token;
}

async function deliverInvitations(
  ctx: TenantContext,
  details: { title: string; message: string | null; expiresAt: Date | null; senderName: string },
  links: { signerId: string; name: string; email: string; token: string }[],
): Promise<Invitation[]> {
  const invitations: Invitation[] = [];
  for (const link of links) {
    const result = await sendEmail({
      to: link.email,
      fromName: `${details.senderName} at ${ctx.tenant.name}`,
      replyTo: ctx.email,
      ...invitationEmail({
        business: { name: ctx.tenant.name, color: ctx.tenant.primaryColor },
        senderName: details.senderName,
        signerName: link.name,
        title: details.title,
        message: details.message,
        link: signingLink(link.token),
        expiresAt: details.expiresAt,
        timezone: ctx.tenant.timezone,
      }),
    });
    // Once a link is in the signer's inbox, the sender holding it too could sign in their name;
    // it is shown only when it could not be delivered.
    invitations.push({
      signerId: link.signerId,
      name: link.name,
      emailed: result.sent,
      link: result.sent ? null : signingLink(link.token),
    });
  }
  return invitations;
}

/** Starts a draft from the current version of a PDF in the library. */
export async function createSignRequest(
  ctx: TenantContext,
  input: { documentId: string },
): Promise<{ id: string }> {
  requirePermission(ctx, 'files.request_signatures');
  requirePermission(ctx, 'files.view');

  const document = await withRls(ctx, async (tx) => {
    const [row] = await tx
      .select({
        name: libraryDocuments.name,
        extension: libraryDocuments.extension,
        version: libraryDocuments.version,
        storagePath: libraryDocumentVersions.storagePath,
      })
      .from(libraryDocuments)
      .innerJoin(
        libraryDocumentVersions,
        and(
          eq(libraryDocumentVersions.tenantId, libraryDocuments.tenantId),
          eq(libraryDocumentVersions.documentId, libraryDocuments.id),
          eq(libraryDocumentVersions.version, libraryDocuments.version),
        ),
      )
      .where(
        and(
          eq(libraryDocuments.tenantId, ctx.tenantId),
          eq(libraryDocuments.id, input.documentId),
          isNull(libraryDocuments.deletedAt),
        ),
      )
      .limit(1);
    return row;
  });
  if (!document) throw new AppError('NOT_FOUND', 'That document was not found.');
  if (document.extension !== 'pdf') {
    throw new AppError('VALIDATION', 'Only PDF documents can be sent for signature.');
  }
  const bytes = await readObject(document.storagePath);
  if (!bytes) throw new AppError('NOT_FOUND', 'The document’s file could not be found.');
  const info = await inspectPdf(bytes);

  return withRls(ctx, async (tx) => {
    const [created] = await tx
      .insert(signRequests)
      .values({
        tenantId: ctx.tenantId,
        documentId: input.documentId,
        documentVersion: document.version,
        originalStoragePath: document.storagePath,
        title: document.name.slice(0, 200),
        pageCount: info.pageCount,
        expiryDays: 30,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: signRequests.id });
    if (!created) throw new AppError('INTERNAL', 'Could not start the request.');
    await event(tx, ctx, created.id, 'created');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'sign_request',
      entityId: created.id,
      context: { documentId: input.documentId, version: document.version },
    });
    return created;
  });
}

/**
 * Replaces a draft's settings, signers and fields with what the editor holds. Signers are saved
 * in the order given, which is the signing order when the request is sequential.
 */
export async function saveDraft(
  ctx: TenantContext,
  input: SaveDraftInput,
): Promise<{ signerIds: Record<string, string> }> {
  requirePermission(ctx, 'files.request_signatures');
  return withRls(ctx, async (tx) => {
    const request = await lockRequest(tx, ctx, input.id);
    if (request.status !== 'draft') {
      throw new AppError('CONFLICT', 'This request has been sent, so it can no longer be edited.');
    }
    const pageCount = request.pageCount ?? 0;
    if (input.fields.some((field) => field.page > pageCount)) {
      throw new AppError('VALIDATION', 'A field is on a page the document does not have.');
    }

    await tx
      .update(signRequests)
      .set({
        title: input.title,
        message: input.message,
        signingOrder: input.signingOrder,
        verifyEmail: input.verifyEmail,
        expiryDays: input.expiryDays,
        updatedBy: ctx.userId,
      })
      .where(and(eq(signRequests.tenantId, ctx.tenantId), eq(signRequests.id, input.id)));

    // Fields go with their signers (cascade).
    await tx
      .delete(signRequestSigners)
      .where(
        and(
          eq(signRequestSigners.tenantId, ctx.tenantId),
          eq(signRequestSigners.requestId, input.id),
        ),
      );

    const signerIds: Record<string, string> = {};
    if (input.signers.length > 0) {
      const inserted = await tx
        .insert(signRequestSigners)
        .values(
          input.signers.map((signer, index) => ({
            tenantId: ctx.tenantId,
            requestId: input.id,
            position: index + 1,
            name: signer.name,
            email: signer.email,
          })),
        )
        .returning({ id: signRequestSigners.id, position: signRequestSigners.position });
      for (const row of inserted) {
        const key = input.signers[row.position - 1]?.key;
        if (key) signerIds[key] = row.id;
      }
    }

    if (input.fields.length > 0) {
      await tx.insert(signRequestFields).values(
        input.fields.map((field) => ({
          tenantId: ctx.tenantId,
          requestId: input.id,
          signerId: signerIds[field.signerKey] ?? '',
          kind: field.kind,
          page: field.page,
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
          required: field.kind === 'signature' || field.kind === 'date' ? true : field.required,
          label: field.label,
        })),
      );
    }

    await audit(tx, ctx, { action: 'update', entityType: 'sign_request', entityId: input.id });
    return { signerIds };
  });
}

/**
 * Sends a draft. The original's fingerprint is recorded now, and stamping later refuses a file
 * that does not match it. In order, only the first signer is invited; each next one is invited
 * when the one before signs.
 */
export async function sendSignRequest(
  ctx: TenantContext,
  id: string,
): Promise<{ invitations: Invitation[] }> {
  requirePermission(ctx, 'files.request_signatures');

  const [pending] = await withRls(ctx, (tx) =>
    tx
      .select({ path: signRequests.originalStoragePath, status: signRequests.status })
      .from(signRequests)
      .where(
        and(
          eq(signRequests.tenantId, ctx.tenantId),
          eq(signRequests.id, id),
          isNull(signRequests.deletedAt),
        ),
      )
      .limit(1),
  );
  if (!pending) throw new AppError('NOT_FOUND', NOT_FOUND);
  if (pending.status !== 'draft') {
    throw new AppError('CONFLICT', 'This request has already been sent.');
  }
  const bytes = await readObject(pending.path);
  if (!bytes) throw new AppError('NOT_FOUND', 'The document’s file could not be found.');
  const info = await inspectPdf(bytes);
  const originalSha256 = sha256Hex(bytes);

  const sent = await withRls(ctx, async (tx) => {
    const request = await lockRequest(tx, ctx, id);
    if (request.status !== 'draft') {
      throw new AppError('CONFLICT', 'This request has already been sent.');
    }
    const signers = await tx
      .select({
        id: signRequestSigners.id,
        position: signRequestSigners.position,
        name: signRequestSigners.name,
        email: signRequestSigners.email,
        status: signRequestSigners.status,
      })
      .from(signRequestSigners)
      .where(
        and(eq(signRequestSigners.tenantId, ctx.tenantId), eq(signRequestSigners.requestId, id)),
      )
      .orderBy(asc(signRequestSigners.position));
    const fields = await tx
      .select({
        signerId: signRequestFields.signerId,
        kind: signRequestFields.kind,
        page: signRequestFields.page,
      })
      .from(signRequestFields)
      .where(
        and(eq(signRequestFields.tenantId, ctx.tenantId), eq(signRequestFields.requestId, id)),
      );

    const problems = sendProblems({
      signers,
      fields: fields.map((field) => ({ ...field, kind: field.kind as FieldKind })),
      pageCount: info.pageCount,
    });
    if (problems.length > 0) {
      throw new AppError('VALIDATION', problems.map((problem) => problem.message).join(' '));
    }
    if (request.verifyEmail && !isEmailConfigured()) {
      throw new AppError(
        'VALIDATION',
        'Email is not set up, so signers could not receive their one-time code. Turn off “Check signers with an emailed code”, or set up email first.',
      );
    }

    const now = new Date();
    const expiresAt = request.expiryDays
      ? new Date(now.getTime() + request.expiryDays * DAY)
      : null;
    await tx
      .update(signRequests)
      .set({
        status: 'sent',
        originalSha256,
        pageCount: info.pageCount,
        sentAt: now,
        sentBy: ctx.userId,
        expiresAt,
        updatedBy: ctx.userId,
      })
      .where(and(eq(signRequests.tenantId, ctx.tenantId), eq(signRequests.id, id)));
    await event(tx, ctx, id, 'sent');

    const links: { signerId: string; name: string; email: string; token: string }[] = [];
    for (const signer of signersWhoseTurnItIs(signers, request.signingOrder as 'parallel')) {
      const token = await issueLink(tx, ctx, id, signer.id, expiresAt);
      links.push({ signerId: signer.id, name: signer.name, email: signer.email, token });
    }
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'sign_request',
      entityId: id,
      changes: { status: ['draft', 'sent'] },
      context: { originalSha256, signers: signers.length },
    });
    return {
      links,
      details: {
        title: request.title,
        message: request.message,
        expiresAt,
        senderName: await myName(tx, ctx),
      },
    };
  });

  return { invitations: await deliverInvitations(ctx, sent.details, sent.links) };
}

/**
 * Sends someone still to sign a fresh link, replacing the one they had, for when the email went
 * astray or the link was lost.
 */
export async function remindSigner(
  ctx: TenantContext,
  input: { id: string; signerId: string },
): Promise<Invitation> {
  requirePermission(ctx, 'files.request_signatures');
  const reminded = await withRls(ctx, async (tx) => {
    const request = await lockRequest(tx, ctx, input.id);
    if (request.status !== 'sent') {
      throw new AppError('CONFLICT', 'Only a request that is out for signature can be resent.');
    }
    if (request.expiresAt && request.expiresAt <= new Date()) {
      throw new AppError('CONFLICT', 'This request has expired. Void it and send a new one.');
    }
    const signers = await tx
      .select({
        id: signRequestSigners.id,
        position: signRequestSigners.position,
        name: signRequestSigners.name,
        email: signRequestSigners.email,
        status: signRequestSigners.status,
      })
      .from(signRequestSigners)
      .where(
        and(
          eq(signRequestSigners.tenantId, ctx.tenantId),
          eq(signRequestSigners.requestId, input.id),
        ),
      );
    const signer = signers.find((candidate) => candidate.id === input.signerId);
    if (!signer) throw new AppError('NOT_FOUND', 'That signer was not found.');
    if (signer.status !== 'pending') {
      throw new AppError('CONFLICT', `${signer.name} has already answered this request.`);
    }
    const turn = signersWhoseTurnItIs(signers, request.signingOrder as 'parallel');
    if (!turn.some((candidate) => candidate.id === signer.id)) {
      throw new AppError(
        'CONFLICT',
        `${signer.name} signs later in the order and will be invited automatically.`,
      );
    }
    const token = await issueLink(tx, ctx, input.id, signer.id, request.expiresAt);
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'sign_request',
      entityId: input.id,
      context: { resentTo: signer.id },
    });
    return {
      link: { signerId: signer.id, name: signer.name, email: signer.email, token },
      details: {
        title: request.title,
        message: request.message,
        expiresAt: request.expiresAt,
        senderName: await myName(tx, ctx),
      },
    };
  });
  const [invitation] = await deliverInvitations(ctx, reminded.details, [reminded.link]);
  if (!invitation) throw new AppError('INTERNAL', 'Could not resend the link.');
  return invitation;
}

/** Withdraws a request that is out. Links stop working at once; invited signers are told. */
export async function voidSignRequest(
  ctx: TenantContext,
  input: { id: string; reason: string },
): Promise<{ id: string }> {
  requirePermission(ctx, 'files.request_signatures');
  const voided = await withRls(ctx, async (tx) => {
    const request = await lockRequest(tx, ctx, input.id);
    if (request.status !== 'sent') {
      throw new AppError('CONFLICT', 'Only a request that is out for signature can be voided.');
    }
    await tx
      .update(signRequests)
      .set({
        status: 'voided',
        voidedAt: new Date(),
        voidReason: input.reason,
        updatedBy: ctx.userId,
      })
      .where(and(eq(signRequests.tenantId, ctx.tenantId), eq(signRequests.id, input.id)));
    await event(tx, ctx, input.id, 'voided');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'sign_request',
      entityId: input.id,
      changes: { status: ['sent', 'voided'] },
    });
    const notify = await tx
      .select({ name: signRequestSigners.name, email: signRequestSigners.email })
      .from(signRequestSigners)
      .where(
        and(
          eq(signRequestSigners.tenantId, ctx.tenantId),
          eq(signRequestSigners.requestId, input.id),
          inArray(signRequestSigners.status, ['pending', 'signed']),
          isNotNull(signRequestSigners.invitedAt),
        ),
      );
    return { title: request.title, notify };
  });

  for (const signer of voided.notify) {
    await sendEmail({
      to: signer.email,
      ...voidedEmail({
        business: { name: ctx.tenant.name, color: ctx.tenant.primaryColor },
        signerName: signer.name,
        title: voided.title,
        reason: input.reason,
      }),
    });
  }
  return { id: input.id };
}

/** Removes a draft nobody was ever asked to sign. */
export async function deleteDraft(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'files.request_signatures');
  return withRls(ctx, async (tx) => {
    const request = await lockRequest(tx, ctx, id);
    if (request.status !== 'draft') {
      throw new AppError('CONFLICT', 'Only a draft can be deleted. Void a sent request instead.');
    }
    await tx
      .update(signRequests)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(signRequests.tenantId, ctx.tenantId), eq(signRequests.id, id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'sign_request', entityId: id });
    return { id };
  });
}

/** A one-minute link to the signed file, audited like every other document download. */
export async function getSignedDownloadUrl(
  ctx: TenantContext,
  id: string,
): Promise<{ url: string }> {
  requirePermission(ctx, 'files.request_signatures');
  const file = await withRls(ctx, async (tx) => {
    const [request] = await tx
      .select({
        title: signRequests.title,
        status: signRequests.status,
        path: signRequests.signedStoragePath,
      })
      .from(signRequests)
      .where(
        and(
          eq(signRequests.tenantId, ctx.tenantId),
          eq(signRequests.id, id),
          isNull(signRequests.deletedAt),
        ),
      )
      .limit(1);
    if (!request) throw new AppError('NOT_FOUND', NOT_FOUND);
    if (request.status !== 'completed' || !request.path) {
      throw new AppError('CONFLICT', 'The signed copy is ready once everyone has signed.');
    }
    await audit(tx, ctx, {
      action: 'download',
      entityType: 'sign_request',
      entityId: id,
      context: { file: 'signed' },
    });
    return request;
  });
  return { url: await createDownloadUrl(file.path!, `${file.title} (signed).pdf`) };
}

/**
 * The original PDF's bytes for the field editor and the request page. Handing a document's
 * content to a browser is audited as a download (as the library's editor does).
 */
export async function readRequestDocument(
  ctx: TenantContext,
  id: string,
): Promise<{ bytes: Buffer; fileName: string }> {
  requirePermission(ctx, 'files.request_signatures');
  requirePermission(ctx, 'files.view');
  const request = await withRls(ctx, async (tx) => {
    const [row] = await tx
      .select({
        title: signRequests.title,
        path: signRequests.originalStoragePath,
        documentId: signRequests.documentId,
        version: signRequests.documentVersion,
      })
      .from(signRequests)
      .where(
        and(
          eq(signRequests.tenantId, ctx.tenantId),
          eq(signRequests.id, id),
          isNull(signRequests.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('NOT_FOUND', NOT_FOUND);
    await audit(tx, ctx, {
      action: 'download',
      entityType: 'library_document',
      entityId: row.documentId,
      context: { version: row.version, via: 'esign', signRequestId: id },
    });
    return row;
  });
  const bytes = await readObject(request.path);
  if (!bytes) throw new AppError('NOT_FOUND', 'The document’s file could not be found.');
  return { bytes, fileName: `${request.title}.pdf` };
}
