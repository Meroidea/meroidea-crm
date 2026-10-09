import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DocumentEditor } from '@/modules/files/components/document-editor';
import { DownloadButton } from '@/modules/files/components/files-tools';
import { buildEditorConfig, editorSettings } from '@/modules/files/editor';
import { getDocument } from '@/modules/files/queries';
import { documentIdSchema } from '@/modules/files/schemas';
import { getMyName } from '@/modules/members/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Edit document' };
// The configuration is signed for this person and this moment; it must never be cached.
export const dynamic = 'force-dynamic';

export default async function EditDocumentPage({ params }: PageProps<'/documents/[id]/edit'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'files.view');
  const parsed = documentIdSchema.safeParse(await params);
  const document = parsed.success ? await getDocument(ctx, parsed.data.id) : null;
  if (!document) notFound();
  const settings = editorSettings();
  const editor = settings ? buildEditorConfig(ctx, document, await getMyName(ctx), settings) : null;

  return (
    // Fills the space under the app's header: the editor needs a fixed height to lay itself out.
    <div className="-m-4 flex h-[calc(100svh-3.5rem)] flex-col md:-m-6">
      <div className="flex items-center gap-3 border-b bg-card px-4 py-2">
        <Link
          href={`/documents/${document.id}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back
        </Link>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {document.name}.{document.extension}
          {!hasPermission(ctx, 'files.edit') && (
            <span className="ml-2 font-normal text-muted-foreground">View only</span>
          )}
        </p>
        <DownloadButton id={document.id} compact />
      </div>
      <div className="min-h-0 flex-1">
        {editor ? (
          <DocumentEditor scriptUrl={editor.scriptUrl} config={editor.config} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="max-w-md">
              <p className="font-medium">Editing in the browser is not set up yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The document editing service has not been connected to this system. You can still
                download this document, edit it on your computer, and upload the new copy.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
