import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import {
  auditLogs,
  libraryDocuments,
  libraryDocumentVersions,
  tenantMemberships,
} from '@/db/schema';
import { adminDb } from '@/server/db/admin';
import { readObject, removeObject, writeObject } from '@/server/storage';

import { MAX_DOCUMENT_BYTES, matchesFormat, type DocumentExtension } from './formats';

/*
 * The server side of the editing link. These run for the document editing server, not for a
 * signed-in person, so there is no session for RLS to match: they use the privileged connection
 * and are only reached after the caller's signature has been verified (a verified webhook, as
 * .claude/CLAUDE.md allows). Each one is scoped to the single document it was called for.
 */

/** The stored bytes of one version, for the editing server to open. */
export async function readVersionForEditor(
  documentId: string,
  version: number,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const [row] = await adminDb()
    .select({
      storagePath: libraryDocumentVersions.storagePath,
      mimeType: libraryDocuments.mimeType,
    })
    .from(libraryDocumentVersions)
    .innerJoin(
      libraryDocuments,
      and(
        eq(libraryDocuments.tenantId, libraryDocumentVersions.tenantId),
        eq(libraryDocuments.id, libraryDocumentVersions.documentId),
      ),
    )
    .where(
      and(
        eq(libraryDocumentVersions.documentId, documentId),
        eq(libraryDocumentVersions.version, version),
        isNull(libraryDocuments.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const bytes = await readObject(row.storagePath);
  return bytes ? { bytes, mimeType: row.mimeType } : null;
}

export type SaveOutcome = 'saved' | 'stale' | 'rejected' | 'not_found';

/**
 * Stores an edited file as the next version. `fromVersion` is the version the editing session
 * was opened on: if the document has moved past it, this save has already been applied (the
 * editing server retries) and is ignored rather than stored twice.
 */
export async function saveEditedVersion(input: {
  documentId: string;
  fromVersion: number;
  bytes: Buffer;
  /** The person named by the editing server as having made the change, if any. */
  userId: string | null;
}): Promise<SaveOutcome> {
  const db = adminDb();
  const [current] = await db
    .select()
    .from(libraryDocuments)
    .where(and(eq(libraryDocuments.id, input.documentId), isNull(libraryDocuments.deletedAt)))
    .limit(1);
  if (!current) return 'not_found';
  if (current.version !== input.fromVersion) return 'stale';

  const extension = current.extension as DocumentExtension;
  if (
    input.bytes.length === 0 ||
    input.bytes.length > MAX_DOCUMENT_BYTES * 2 ||
    !matchesFormat(extension, input.bytes)
  ) {
    return 'rejected';
  }

  // Only credit a person who really belongs to this business.
  let editor: string | null = null;
  if (input.userId && /^[0-9a-f-]{36}$/i.test(input.userId)) {
    const [member] = await db
      .select({ userId: tenantMemberships.userId })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, current.tenantId),
          eq(tenantMemberships.userId, input.userId),
        ),
      )
      .limit(1);
    editor = member?.userId ?? null;
  }

  const nextVersion = current.version + 1;
  const path = `${current.tenantId}/library/${randomUUID()}.${extension}`;
  await writeObject(path, input.bytes, current.mimeType);
  try {
    const applied = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(libraryDocuments)
        .set({
          version: nextVersion,
          storagePath: path,
          sizeBytes: input.bytes.length,
          updatedBy: editor,
        })
        .where(
          and(eq(libraryDocuments.id, current.id), eq(libraryDocuments.version, current.version)),
        )
        .returning({ id: libraryDocuments.id });
      // Another save got there first between the read above and this write.
      if (!updated) return false;
      await tx.insert(libraryDocumentVersions).values({
        tenantId: current.tenantId,
        documentId: current.id,
        version: nextVersion,
        storagePath: path,
        sizeBytes: input.bytes.length,
        createdBy: editor,
      });
      await tx.insert(auditLogs).values({
        tenantId: current.tenantId,
        actorUserId: editor,
        actorType: 'document_editor',
        action: 'update',
        entityType: 'library_document',
        entityId: current.id,
        context: { version: nextVersion },
      });
      return true;
    });
    if (!applied) {
      await removeObject(path);
      return 'stale';
    }
    return 'saved';
  } catch (error) {
    await removeObject(path);
    throw error;
  }
}
