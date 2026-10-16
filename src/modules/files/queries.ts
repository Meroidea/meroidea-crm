import 'server-only';

import { and, asc, desc, eq, ilike, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { libraryDocuments, libraryDocumentVersions, users } from '@/db/schema';
import { likePattern } from '@/lib/cursor';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { DocumentExtension } from './formats';
import type { DocumentFilters } from './schemas';
import type { DocumentDetail, DocumentRow } from './types';

const columns = {
  id: libraryDocuments.id,
  name: libraryDocuments.name,
  extension: libraryDocuments.extension,
  sizeBytes: libraryDocuments.sizeBytes,
  folder: libraryDocuments.folder,
  version: libraryDocuments.version,
  updatedAt: libraryDocuments.updatedAt,
  updatedByName: users.fullName,
};

const live = (ctx: TenantContext) =>
  and(eq(libraryDocuments.tenantId, ctx.tenantId), isNull(libraryDocuments.deletedAt));

const typed = <T extends { extension: string }>(row: T) => ({
  ...row,
  extension: row.extension as DocumentExtension,
});

export const DOCUMENT_PAGE_SIZE = 100;

const cursorSchema = z.object({ u: z.boolean(), f: z.string(), n: z.string(), id: z.uuid() });
type DocumentCursor = z.infer<typeof cursorSchema>;

const encodeDocumentCursor = (row: DocumentRow) =>
  Buffer.from(
    JSON.stringify({
      u: row.folder === null,
      f: row.folder ?? '',
      n: row.name,
      id: row.id,
    } satisfies DocumentCursor),
  ).toString('base64url');

function decodeDocumentCursor(raw: string | undefined): DocumentCursor | null {
  if (!raw) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** By folder then name, a page at a time, so no document is silently out of reach. */
export async function listDocuments(
  ctx: TenantContext,
  filters: DocumentFilters,
): Promise<{ items: DocumentRow[]; nextCursor: string | null }> {
  requirePermission(ctx, 'files.view');
  const where: (SQL | undefined)[] = [live(ctx)];
  if (filters.q) where.push(ilike(libraryDocuments.name, likePattern(filters.q)));
  if (filters.type) where.push(eq(libraryDocuments.extension, filters.type));
  if (filters.folder) where.push(eq(libraryDocuments.folder, filters.folder));
  // Documents outside a folder come last, as they did before paging.
  const unfiled = sql`(${libraryDocuments.folder} is null)`;
  const folder = sql`coalesce(${libraryDocuments.folder}, '')`;
  const cursor = decodeDocumentCursor(filters.cursor);
  if (cursor) {
    where.push(
      sql`(${unfiled}, ${folder}, ${libraryDocuments.name}, ${libraryDocuments.id})
        > (${cursor.u}, ${cursor.f}, ${cursor.n}, ${cursor.id}::uuid)`,
    );
  }
  const rows = await withRls(ctx, (tx) =>
    tx
      .select(columns)
      .from(libraryDocuments)
      .leftJoin(users, eq(users.id, libraryDocuments.updatedBy))
      .where(and(...where))
      .orderBy(asc(unfiled), asc(folder), asc(libraryDocuments.name), asc(libraryDocuments.id))
      .limit(DOCUMENT_PAGE_SIZE + 1),
  );
  const items = rows.slice(0, DOCUMENT_PAGE_SIZE).map(typed);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > DOCUMENT_PAGE_SIZE && last ? encodeDocumentCursor(last) : null,
  };
}

export async function listFolders(ctx: TenantContext): Promise<string[]> {
  requirePermission(ctx, 'files.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .selectDistinct({ folder: libraryDocuments.folder })
      .from(libraryDocuments)
      .where(and(live(ctx), isNotNull(libraryDocuments.folder)))
      .orderBy(asc(libraryDocuments.folder)),
  );
  return rows.flatMap((row) => (row.folder ? [row.folder] : []));
}

export async function getDocument(ctx: TenantContext, id: string): Promise<DocumentDetail | null> {
  requirePermission(ctx, 'files.view');
  return withRls(ctx, async (tx) => {
    const [row] = await tx
      .select(columns)
      .from(libraryDocuments)
      .leftJoin(users, eq(users.id, libraryDocuments.updatedBy))
      .where(and(live(ctx), eq(libraryDocuments.id, id)))
      .limit(1);
    if (!row) return null;
    const versions = await tx
      .select({
        version: libraryDocumentVersions.version,
        sizeBytes: libraryDocumentVersions.sizeBytes,
        createdAt: libraryDocumentVersions.createdAt,
        createdByName: users.fullName,
      })
      .from(libraryDocumentVersions)
      .leftJoin(users, eq(users.id, libraryDocumentVersions.createdBy))
      .where(
        and(
          eq(libraryDocumentVersions.tenantId, ctx.tenantId),
          eq(libraryDocumentVersions.documentId, id),
        ),
      )
      .orderBy(desc(libraryDocumentVersions.version));
    return { ...typed(row), versions };
  });
}
