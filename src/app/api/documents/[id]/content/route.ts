import { editorSettings, isValidContentLink } from '@/modules/files/editor';
import { readVersionForEditor } from '@/modules/files/editor-save';

/**
 * Feeds one version of a document to the editing server. There is no signed-in person here: the
 * link itself is the credential. It is signed with the shared secret, names one document and one
 * version, and expires minutes after the editor page was opened.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const settings = editorSettings();
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const version = Number(query.get('v'));
  const valid =
    settings &&
    /^[0-9a-f-]{36}$/i.test(id) &&
    Number.isInteger(version) &&
    isValidContentLink(settings, {
      documentId: id,
      version,
      expires: Number(query.get('exp')),
      signature: query.get('sig') ?? '',
    });
  // The same answer for a bad signature and a missing file, so nothing can be probed.
  const file = valid ? await readVersionForEditor(id, version) : null;
  if (!file) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.bytes.length),
      'Cache-Control': 'private, no-store',
    },
  });
}
