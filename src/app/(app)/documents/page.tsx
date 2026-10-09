import {
  FileSpreadsheet,
  FileText,
  FileType,
  Files,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { FilterBar } from '@/components/data/filter-bar';
import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { DownloadButton, UploadButton } from '@/modules/files/components/files-tools';
import { editorSettings } from '@/modules/files/editor';
import { DOCUMENT_FORMATS, formatBytes, type DocumentExtension } from '@/modules/files/formats';
import { listDocuments, listFolders } from '@/modules/files/queries';
import { documentFiltersSchema } from '@/modules/files/schemas';
import type { DocumentRow } from '@/modules/files/types';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Documents' };

const ICONS: Record<DocumentExtension, { icon: LucideIcon; className: string }> = {
  docx: { icon: FileText, className: 'bg-chart-3/15 text-chart-1' },
  xlsx: { icon: FileSpreadsheet, className: 'bg-chart-2/25 text-chart-1' },
  pptx: { icon: Presentation, className: 'bg-chart-5/15 text-destructive-text' },
  pdf: { icon: FileType, className: 'bg-muted text-foreground' },
};

export default async function DocumentsPage({ searchParams }: PageProps<'/documents'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'files.view');
  const filters = documentFiltersSchema.parse(await searchParams);
  const [documents, folders] = await Promise.all([listDocuments(ctx, filters), listFolders(ctx)]);
  const canManage = hasPermission(ctx, 'files.manage');
  const filtering = Boolean(filters.q || filters.type || filters.folder);

  const groups = new Map<string, DocumentRow[]>();
  for (const document of documents) {
    const key = document.folder ?? '';
    groups.set(key, [...(groups.get(key) ?? []), document]);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Documents"
        description="Your business’s shared files. Open one to edit it here, together, without downloading."
        actions={canManage && <UploadButton folders={folders} />}
      />
      {!editorSettings() && (
        <p className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text">
          The document editing service is not connected yet, so files can be stored and downloaded
          but not opened for editing in the browser.
        </p>
      )}
      <FilterBar
        filters={{ q: filters.q, type: filters.type, folder: filters.folder }}
        searchLabel="Search documents"
        selects={[
          {
            name: 'type',
            label: 'Type',
            allLabel: 'All types',
            options: Object.entries(DOCUMENT_FORMATS).map(([value, format]) => ({
              value,
              label: format.label,
            })),
          },
          {
            name: 'folder',
            label: 'Folder',
            allLabel: 'All folders',
            options: folders.map((folder) => ({ value: folder, label: folder })),
          },
        ]}
      />

      {documents.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Files}
              title={filtering ? 'Nothing matches' : 'No documents yet'}
              description={
                filtering
                  ? 'Try a different search, type or folder.'
                  : canManage
                    ? 'Upload Word, Excel, PowerPoint or PDF files to share them with your team.'
                    : 'Documents appear here once someone adds them.'
              }
            />
          </CardContent>
        </Card>
      ) : (
        [...groups].map(([folder, rows]) => (
          <section
            key={folder}
            aria-label={folder || 'Documents'}
            className="overflow-hidden rounded-xl border bg-card"
          >
            <header className="flex items-center gap-2.5 border-b bg-muted/40 px-4 py-2.5">
              <h2 className="text-sm font-medium">{folder || 'No folder'}</h2>
              <span className="text-sm text-muted-foreground tabular-nums">{rows.length}</span>
            </header>
            <ul className="divide-y">
              {rows.map((document) => {
                const { icon: Icon, className } = ICONS[document.extension];
                return (
                  <li
                    key={document.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                  >
                    <Link
                      href={`/documents/${document.id}/edit`}
                      className="group flex min-w-0 flex-1 basis-56 items-center gap-3 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <span
                        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${className}`}
                      >
                        <Icon aria-hidden className="size-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium underline-offset-4 group-hover:underline">
                          {document.name}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {DOCUMENT_FORMATS[document.extension].label} ·{' '}
                          {formatBytes(document.sizeBytes)} · version {document.version} ·{' '}
                          {formatDate(ctx, document.updatedAt)}
                          {document.updatedByName ? ` by ${document.updatedByName}` : ''}
                        </span>
                      </span>
                    </Link>
                    <Link
                      href={`/documents/${document.id}`}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Details
                    </Link>
                    <DownloadButton id={document.id} compact />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
