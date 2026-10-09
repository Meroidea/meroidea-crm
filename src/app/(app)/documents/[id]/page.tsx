import { PenLine } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { DownloadButton, ManageDocument } from '@/modules/files/components/files-tools';
import { DOCUMENT_FORMATS, formatBytes } from '@/modules/files/formats';
import { getDocument, listFolders } from '@/modules/files/queries';
import { documentIdSchema } from '@/modules/files/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Document' };

export default async function DocumentPage({ params }: PageProps<'/documents/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'files.view');
  const parsed = documentIdSchema.safeParse(await params);
  const document = parsed.success ? await getDocument(ctx, parsed.data.id) : null;
  if (!document) notFound();
  const canManage = hasPermission(ctx, 'files.manage');
  const folders = canManage ? await listFolders(ctx) : [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div>
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/documents" className="underline-offset-4 hover:underline">
            Documents
          </Link>{' '}
          / {document.folder ? `${document.folder} / ` : ''}
          {document.name}
        </nav>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{document.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {DOCUMENT_FORMATS[document.extension].label} · {formatBytes(document.sizeBytes)} ·
              version {document.version}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <ManageDocument
                id={document.id}
                name={document.name}
                folder={document.folder}
                folders={folders}
              />
            )}
            <DownloadButton id={document.id} />
            <Button asChild>
              <Link href={`/documents/${document.id}/edit`}>
                <PenLine aria-hidden /> Open
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <section aria-label="Version history" className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b bg-muted/40 px-4 py-2.5">
          <h2 className="text-sm font-medium">Version history</h2>
        </header>
        <ul className="divide-y">
          {document.versions.map((version) => (
            <li
              key={version.version}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
            >
              <span className="w-24 font-medium">
                Version {version.version}
                {version.version === document.version && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">current</span>
                )}
              </span>
              <span className="min-w-0 flex-1 text-muted-foreground">
                {version.version === 1 ? 'Uploaded' : 'Edited'}{' '}
                {formatDateTime(ctx, version.createdAt)}
                {version.createdByName ? ` by ${version.createdByName}` : ''} ·{' '}
                {formatBytes(version.sizeBytes)}
              </span>
              <DownloadButton id={document.id} version={version.version} compact />
            </li>
          ))}
        </ul>
      </section>
      <p className="text-xs text-muted-foreground">
        A new version is saved a few seconds after the last person editing closes the document.
      </p>
    </div>
  );
}
