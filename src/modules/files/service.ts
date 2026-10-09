import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { libraryDocuments, libraryDocumentVersions } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { createDownloadUrl, createUploadTicket, readObject, removeObject } from '@/server/storage';

import { DOCUMENT_FORMATS, MAX_DOCUMENT_BYTES, matchesFormat, splitFileName } from './formats';

/**
 * Step one of an upload: checks the file is one we accept and hands back a one-time ticket to
 * put it at a path the server chose. The browser then sends the bytes straight to storage, so
 * large files never pass through a server action.
 */
export async function startUpload(
  ctx: TenantContext,
  input: { fileName: string; sizeBytes: number },
): Promise<{ path: string; token: string }> {
  requirePermission(ctx, 'files.manage');
  const parts = splitFileName(input.fileName);
  if (!parts) {
    throw new AppError('VALIDATION', 'Only Word, Excel, PowerPoint and PDF files can be added.', {
      fileName: ['Use a .docx, .xlsx, .pptx or .pdf file'],
    });
  }
  return createUploadTicket(`${ctx.tenantId}/library/${randomUUID()}.${parts.extension}`);
}

/**
 * Step two: confirms what arrived really is the kind of file it claims to be and is within the
 * size limit, then records it. Anything that fails is removed from storage again.
 */
export async function finishUpload(
  ctx: TenantContext,
  input: { path: string; fileName: string; folder: string | null },
): Promise<{ id: string }> {
  requirePermission(ctx, 'files.manage');
  const parts = splitFileName(input.fileName);
  // The path came back from the browser, so it is checked rather than trusted.
  if (
    !parts ||
    !input.path.startsWith(`${ctx.tenantId}/library/`) ||
    !input.path.endsWith(`.${parts.extension}`)
  ) {
    throw new AppError('VALIDATION', 'That upload could not be matched to a file.');
  }
  const bytes = await readObject(input.path);
  if (!bytes) throw new AppError('NOT_FOUND', 'The upload did not arrive. Try again.');
  if (
    bytes.length === 0 ||
    bytes.length > MAX_DOCUMENT_BYTES ||
    !matchesFormat(parts.extension, bytes)
  ) {
    await removeObject(input.path);
    throw new AppError(
      'VALIDATION',
      bytes.length > MAX_DOCUMENT_BYTES
        ? 'Files can be up to 15 MB.'
        : `That file is not a valid ${DOCUMENT_FORMATS[parts.extension].label}.`,
    );
  }

  return withRls(ctx, async (tx) => {
    const [created] = await tx
      .insert(libraryDocuments)
      .values({
        tenantId: ctx.tenantId,
        name: parts.name,
        extension: parts.extension,
        mimeType: DOCUMENT_FORMATS[parts.extension].mimeType,
        sizeBytes: bytes.length,
        folder: input.folder,
        storagePath: input.path,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: libraryDocuments.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the document.');
    await tx.insert(libraryDocumentVersions).values({
      tenantId: ctx.tenantId,
      documentId: created.id,
      version: 1,
      storagePath: input.path,
      sizeBytes: bytes.length,
      createdBy: ctx.userId,
    });
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'library_document',
      entityId: created.id,
    });
    return created;
  });
}

export async function renameDocument(
  ctx: TenantContext,
  input: { id: string; name: string; folder: string | null },
): Promise<{ id: string }> {
  requirePermission(ctx, 'files.manage');
  return withRls(ctx, async (tx) => {
    const [updated] = await tx
      .update(libraryDocuments)
      .set({ name: input.name, folder: input.folder, updatedBy: ctx.userId })
      .where(
        and(
          eq(libraryDocuments.tenantId, ctx.tenantId),
          eq(libraryDocuments.id, input.id),
          isNull(libraryDocuments.deletedAt),
        ),
      )
      .returning({ id: libraryDocuments.id });
    if (!updated) throw new AppError('NOT_FOUND', 'That document was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'library_document',
      entityId: updated.id,
    });
    return updated;
  });
}

/** Takes a document out of the library. Its stored versions are kept, so it can be recovered. */
export async function deleteDocument(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'files.manage');
  return withRls(ctx, async (tx) => {
    const [removed] = await tx
      .update(libraryDocuments)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(libraryDocuments.tenantId, ctx.tenantId),
          eq(libraryDocuments.id, id),
          isNull(libraryDocuments.deletedAt),
        ),
      )
      .returning({ id: libraryDocuments.id });
    if (!removed) throw new AppError('NOT_FOUND', 'That document was not found.');
    await audit(tx, ctx, { action: 'delete', entityType: 'library_document', entityId: id });
    return removed;
  });
}

/** A one-minute download link for the current version, or an earlier one. Every download is audited. */
export async function getDownloadUrl(
  ctx: TenantContext,
  input: { id: string; version?: number },
): Promise<{ url: string }> {
  requirePermission(ctx, 'files.view');
  const file = await withRls(ctx, async (tx) => {
    const [document] = await tx
      .select({
        name: libraryDocuments.name,
        extension: libraryDocuments.extension,
        version: libraryDocuments.version,
      })
      .from(libraryDocuments)
      .where(
        and(
          eq(libraryDocuments.tenantId, ctx.tenantId),
          eq(libraryDocuments.id, input.id),
          isNull(libraryDocuments.deletedAt),
        ),
      )
      .limit(1);
    if (!document) throw new AppError('NOT_FOUND', 'That document was not found.');
    const version = input.version ?? document.version;
    const [stored] = await tx
      .select({ storagePath: libraryDocumentVersions.storagePath })
      .from(libraryDocumentVersions)
      .where(
        and(
          eq(libraryDocumentVersions.tenantId, ctx.tenantId),
          eq(libraryDocumentVersions.documentId, input.id),
          eq(libraryDocumentVersions.version, version),
        ),
      )
      .limit(1);
    if (!stored) throw new AppError('NOT_FOUND', 'That version was not found.');
    await audit(tx, ctx, {
      action: 'download',
      entityType: 'library_document',
      entityId: input.id,
      context: { version },
    });
    const suffix = version === document.version ? '' : ` (version ${version})`;
    return {
      path: stored.storagePath,
      fileName: `${document.name}${suffix}.${document.extension}`,
    };
  });
  return { url: await createDownloadUrl(file.path, file.fileName) };
}
