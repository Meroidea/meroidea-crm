import { callbackSignature, editorSettings, sessionKey } from '@/modules/files/editor';
import { saveEditedVersion } from '@/modules/files/editor-save';
import { MAX_DOCUMENT_BYTES } from '@/modules/files/formats';
import { sameSignature, verifyJwt } from '@/server/jwt';

/** The editing server expects exactly this body; anything else makes it retry or warn the user. */
const reply = (error: 0 | 1) => Response.json({ error });

/**
 * Receives "this document is ready to save" from the editing server and stores the edited file
 * as a new version. Two things must both be right before anything is written: the link's own
 * signature, and a token signed by the editing server with the shared secret. The file is then
 * fetched only from the editing server's own address, never from a URL of the caller's choosing.
 */
export async function POST(request: Request) {
  const settings = editorSettings();
  const query = new URL(request.url).searchParams;
  const documentId = query.get('id') ?? '';
  if (
    !settings ||
    !/^[0-9a-f-]{36}$/i.test(documentId) ||
    !sameSignature(query.get('sig') ?? '', callbackSignature(settings, documentId))
  ) {
    return new Response('Not found', { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  // The token arrives in the header (wrapping the body under "payload") or inside the body.
  const fromHeader = bearer ? verifyJwt(bearer, settings.secret) : null;
  const fromBody = typeof body?.token === 'string' ? verifyJwt(body.token, settings.secret) : null;
  const signed = (fromHeader?.payload as Record<string, unknown> | undefined) ?? fromBody;
  if (!signed) return new Response('Forbidden', { status: 403 });

  // 2 = everyone has closed the document and it is ready to save. Other statuses (someone is
  // editing, closed without changes, and so on) need no action.
  if (signed.status !== 2) return reply(0);

  const key = typeof signed.key === 'string' ? signed.key : '';
  const fromVersion = Number(key.slice(documentId.length + 1));
  const url = typeof signed.url === 'string' ? signed.url : '';
  if (!key.startsWith(`${documentId}-`) || key !== sessionKey(documentId, fromVersion) || !url) {
    return reply(1);
  }

  let source: URL;
  try {
    source = new URL(url);
  } catch {
    return reply(1);
  }
  const allowed = [settings.publicUrl, settings.internalUrl].map(
    (address) => new URL(address).origin,
  );
  if (!allowed.includes(source.origin)) return reply(1);
  // Fetch over the address this app uses to reach the editing server, keeping only the path.
  const download = await fetch(`${settings.internalUrl}${source.pathname}${source.search}`, {
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  }).catch(() => null);
  if (!download?.ok) return reply(1);
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.length > MAX_DOCUMENT_BYTES * 2) return reply(1);

  const users = Array.isArray(signed.users) ? signed.users : [];
  const outcome = await saveEditedVersion({
    documentId,
    fromVersion,
    bytes,
    userId: typeof users[0] === 'string' ? users[0] : null,
  });
  // A save that was already applied counts as success, so the editing server stops retrying.
  return reply(outcome === 'saved' || outcome === 'stale' ? 0 : 1);
}
