import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Hoisted above the imports: the server environment is read once, when the first module loads.
vi.hoisted(() => {
  process.env.ONLYOFFICE_URL = 'http://editor.test:8080';
  process.env.ONLYOFFICE_JWT_SECRET = 'test-secret-test-secret-test-secret-0123';
  process.env.APP_INTERNAL_URL = 'http://app.test:3000';
  delete process.env.ONLYOFFICE_INTERNAL_URL;
});

import { GET as contentRoute } from '@/app/api/documents/[id]/content/route';
import { POST as callbackRoute } from '@/app/api/documents/callback/route';
import { AppError } from '@/lib/errors';
import {
  buildEditorConfig,
  callbackSignature,
  contentUrl,
  editorSettings,
  sessionKey,
} from '@/modules/files/editor';
import { saveEditedVersion } from '@/modules/files/editor-save';
import { formatBytes, matchesFormat, splitFileName } from '@/modules/files/formats';
import { getDocument, listDocuments, listFolders } from '@/modules/files/queries';
import {
  deleteDocument,
  finishUpload,
  getDownloadUrl,
  renameDocument,
  startUpload,
} from '@/modules/files/service';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { signJwt, verifyJwt } from '@/server/jwt';
import { readObject, removeObject, writeObject } from '@/server/storage';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Office files are zip archives; a PDF starts with its own marker.
const office = (text: string) =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(text)]);
const SECRET = process.env.ONLYOFFICE_JWT_SECRET ?? '';

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let member: TenantContext;
let outsider: TenantContext;
let documentId: string;
const stored: string[] = [];

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

/** Uploads as a browser would: ask for a ticket, put the bytes at that path, then confirm. */
async function upload(
  ctx: TenantContext,
  fileName: string,
  bytes: Buffer,
  folder: string | null = null,
) {
  const ticket = await startUpload(ctx, { fileName, sizeBytes: bytes.length });
  await writeObject(ticket.path, bytes, DOCX);
  stored.push(ticket.path);
  return {
    ...(await finishUpload(ctx, { path: ticket.path, fileName, folder })),
    path: ticket.path,
  };
}

beforeAll(async () => {
  const alpha = await createWorkspace('Files Alpha', mail('files-alpha'));
  const memberId = await addMember(alpha.tenantId, mail('files-mem'), 'Max Member', 'member');
  const beta = await createWorkspace('Files Beta', mail('files-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  alphaUsers = [alpha.ownerId, memberId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  member = await contextFor(memberId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);
  documentId = (await upload(owner, 'Staff Handbook.docx', office('version one'), 'Policies')).id;
}, 120_000);

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  const rows = (await withRls(owner, (tx) =>
    tx.execute(
      sql`select storage_path from library_document_versions where tenant_id = ${alphaTenant}`,
    ),
  )) as unknown as { storage_path: string }[];
  for (const path of new Set([...stored, ...rows.map((row) => row.storage_path)]))
    await removeObject(path);
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('the document library', () => {
  it('stores an upload under the business’s own path as version one', async () => {
    const document = await getDocument(owner, documentId);
    expect(document).toMatchObject({
      name: 'Staff Handbook',
      extension: 'docx',
      folder: 'Policies',
      version: 1,
    });
    expect(document?.versions).toHaveLength(1);
    expect(stored[0]).toMatch(new RegExp(`^${alphaTenant}/library/[0-9a-f-]{36}\\.docx$`));
    expect(await listFolders(owner)).toEqual(['Policies']);
  });

  it('lets a member read and download, but not add, rename or delete', async () => {
    expect((await listDocuments(member, {})).map((row) => row.name)).toEqual(['Staff Handbook']);
    expect((await getDownloadUrl(member, { id: documentId })).url).toContain(
      '/storage/v1/object/sign/documents/',
    );
    await expectCode(() => startUpload(member, { fileName: 'x.docx', sizeBytes: 10 }), 'FORBIDDEN');
    await expectCode(
      () => renameDocument(member, { id: documentId, name: 'Hacked', folder: null }),
      'FORBIDDEN',
    );
    await expectCode(() => deleteDocument(member, documentId), 'FORBIDDEN');
  });

  it('is refused by the database itself when a member writes past the service', async () => {
    await withRls(member, (tx) =>
      tx.execute(sql`update library_documents set name = 'Hacked' where id = ${documentId}`),
    );
    expect((await getDocument(owner, documentId))?.name).toBe('Staff Handbook');
  });

  it('never shows another business’s documents, or lets it claim their upload', async () => {
    expect(await getDocument(outsider, documentId)).toBeNull();
    expect(await listDocuments(outsider, {})).toEqual([]);
    await expectCode(() => getDownloadUrl(outsider, { id: documentId }), 'NOT_FOUND');
    await expectCode(
      () =>
        finishUpload(outsider, {
          path: stored[0] ?? '',
          fileName: 'Staff Handbook.docx',
          folder: null,
        }),
      'VALIDATION',
    );
  });

  it('refuses file types it does not handle, and a file that is not what its name says', async () => {
    await expectCode(
      () => startUpload(owner, { fileName: 'virus.exe', sizeBytes: 10 }),
      'VALIDATION',
    );
    const ticket = await startUpload(owner, { fileName: 'fake.docx', sizeBytes: 20 });
    await writeObject(ticket.path, Buffer.from('MZ this is not a document'), DOCX);
    await expectCode(
      () => finishUpload(owner, { path: ticket.path, fileName: 'fake.docx', folder: null }),
      'VALIDATION',
    );
    // The rejected upload is removed from storage, not left behind.
    expect(await readObject(ticket.path)).toBeNull();
  });

  it('audits every download', async () => {
    const rows = (await withRls(owner, (tx) =>
      tx.execute(sql`select count(*)::int as n from audit_logs
                     where tenant_id = ${alphaTenant} and action = 'download' and entity_id = ${documentId}`),
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it('renames, filters by search, type and folder, and hides a deleted document', async () => {
    const second = await upload(owner, 'Budget 2031.xlsx', office('numbers'));
    await renameDocument(owner, { id: second.id, name: 'Budget', folder: 'Finance' });
    expect((await listDocuments(owner, { type: 'xlsx' })).map((row) => row.name)).toEqual([
      'Budget',
    ]);
    expect((await listDocuments(owner, { folder: 'Policies' })).map((row) => row.name)).toEqual([
      'Staff Handbook',
    ]);
    expect((await listDocuments(owner, { q: 'hand' })).map((row) => row.name)).toEqual([
      'Staff Handbook',
    ]);
    await deleteDocument(owner, second.id);
    expect((await listDocuments(owner, {})).map((row) => row.name)).toEqual(['Staff Handbook']);
    expect(await getDocument(owner, second.id)).toBeNull();
  });
});

describe('saving from the editor', () => {
  it('stores an edit as the next version and keeps the earlier one', async () => {
    const outcome = await saveEditedVersion({
      documentId,
      fromVersion: 1,
      bytes: office('version two, edited'),
      userId: member.userId,
    });
    expect(outcome).toBe('saved');
    const document = await getDocument(owner, documentId);
    expect(document).toMatchObject({ version: 2, updatedByName: 'Max Member' });
    expect(document?.versions.map((version) => version.version)).toEqual([2, 1]);
    // Each version is its own stored object, so the earlier one has its own link.
    const earlier = (await getDownloadUrl(owner, { id: documentId, version: 1 })).url;
    const latest = (await getDownloadUrl(owner, { id: documentId })).url;
    expect(earlier.split('?')[0]).toContain(stored[0]);
    expect(latest.split('?')[0]).not.toBe(earlier.split('?')[0]);
    await expectCode(() => getDownloadUrl(owner, { id: documentId, version: 9 }), 'NOT_FOUND');
  });

  it('ignores a repeated save for a version already saved, and rejects a file of the wrong kind', async () => {
    expect(
      await saveEditedVersion({ documentId, fromVersion: 1, bytes: office('again'), userId: null }),
    ).toBe('stale');
    expect(
      await saveEditedVersion({
        documentId,
        fromVersion: 2,
        bytes: Buffer.from('not a document'),
        userId: null,
      }),
    ).toBe('rejected');
    expect((await getDocument(owner, documentId))?.version).toBe(2);
  });

  it('does not credit someone outside the business with an edit', async () => {
    await saveEditedVersion({
      documentId,
      fromVersion: 2,
      bytes: office('v3'),
      userId: outsider.userId,
    });
    expect((await getDocument(owner, documentId))?.updatedByName).toBeNull();
  });
});

describe('the link to the editing server', () => {
  const settings = () => {
    const value = editorSettings();
    if (!value) throw new Error('editor settings missing');
    return value;
  };

  it('signs the editor configuration, with edit rights only for those who hold them', async () => {
    const document = await getDocument(owner, documentId);
    if (!document) throw new Error('no document');
    const { scriptUrl, config } = buildEditorConfig(owner, document, 'Olive Owner', settings());
    expect(scriptUrl).toBe('http://editor.test:8080/web-apps/apps/api/documents/api.js');
    const claims = verifyJwt(String(config.token), SECRET) as Record<
      string,
      Record<string, unknown>
    >;
    expect(claims.document?.key).toBe(sessionKey(documentId, 3));
    expect(claims.editorConfig?.mode).toBe('edit');
    expect(String(claims.editorConfig?.callbackUrl)).toContain(
      'http://app.test:3000/api/documents/callback',
    );

    const viewer = {
      ...owner,
      grants: new Map([...owner.grants].filter(([key]) => key !== 'files.edit')),
    };
    const readOnly = buildEditorConfig(viewer, document, 'Vera Viewer', settings()).config;
    expect((readOnly.editorConfig as { mode: string }).mode).toBe('view');
  });

  it('serves the file only for a correctly signed, unexpired link', async () => {
    const good = await contentRoute(new Request(contentUrl(settings(), documentId, 3)), {
      params: Promise.resolve({ id: documentId }),
    });
    expect(good.status).toBe(200);
    expect(Buffer.from(await good.arrayBuffer()).toString()).toContain('v3');

    const tampered = contentUrl(settings(), documentId, 3).replace('v=3', 'v=1');
    const bad = await contentRoute(new Request(tampered), {
      params: Promise.resolve({ id: documentId }),
    });
    expect(bad.status).toBe(404);
    const unsigned = await contentRoute(
      new Request(`http://app.test:3000/api/documents/${documentId}/content?v=3`),
      {
        params: Promise.resolve({ id: documentId }),
      },
    );
    expect(unsigned.status).toBe(404);
  });

  const callback = (
    body: Record<string, unknown>,
    options: { sig?: string; token?: string | null } = {},
  ) =>
    callbackRoute(
      new Request(
        `http://app.test:3000/api/documents/callback?id=${documentId}&sig=${options.sig ?? callbackSignature(settings(), documentId)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.token === null
              ? {}
              : { Authorization: `Bearer ${options.token ?? signJwt({ payload: body }, SECRET)}` }),
          },
          body: JSON.stringify(body),
        },
      ),
    );

  it('refuses a save-back with a wrong link signature, no token, or a token signed by someone else', async () => {
    const body = {
      status: 2,
      key: sessionKey(documentId, 3),
      url: 'http://editor.test:8080/cache/out.docx',
    };
    expect((await callback(body, { sig: 'wrong' })).status).toBe(404);
    expect((await callback(body, { token: null })).status).toBe(403);
    expect(
      (
        await callback(body, {
          token: signJwt({ payload: body }, 'another-secret-entirely-000000000000'),
        })
      ).status,
    ).toBe(403);
    expect((await getDocument(owner, documentId))?.version).toBe(3);
  });

  it('will not fetch the edited file from anywhere but the editing server', async () => {
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    const response = await callback({
      status: 2,
      key: sessionKey(documentId, 3),
      url: 'http://169.254.169.254/latest/meta-data',
    });
    expect(await response.json()).toEqual({ error: 1 });
    expect(fetched).not.toHaveBeenCalled();
  });

  it('acknowledges "still editing" without saving, then saves when the document is closed', async () => {
    expect(await (await callback({ status: 1, key: sessionKey(documentId, 3) })).json()).toEqual({
      error: 0,
    });
    expect((await getDocument(owner, documentId))?.version).toBe(3);

    // Only the editing server is faked; storage still needs the real network.
    const realFetch = globalThis.fetch;
    const editorCalls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('http://editor.test:8080/')) return realFetch(input, init);
      editorCalls.push(url);
      return new Response(new Uint8Array(office('version four from the editor')));
    });
    const response = await callback({
      status: 2,
      key: sessionKey(documentId, 3),
      url: 'http://editor.test:8080/cache/out.docx?md5=abc',
      users: [owner.userId],
    });
    expect(await response.json()).toEqual({ error: 0 });
    expect(editorCalls).toEqual(['http://editor.test:8080/cache/out.docx?md5=abc']);
    const document = await getDocument(owner, documentId);
    expect(document?.version).toBe(4);
    expect(document?.versions[0]?.createdByName).toBe('Files Alpha Owner');
  });
});

describe('small helpers', () => {
  it('checks tokens: tampered, unsigned-algorithm and expired ones are refused', () => {
    const token = signJwt({ hello: 'world' }, SECRET);
    expect(verifyJwt(token, SECRET)).toEqual({ hello: 'world' });
    expect(verifyJwt(`${token.slice(0, -2)}xx`, SECRET)).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${token.split('.')[1]}.`;
    expect(verifyJwt(none, SECRET)).toBeNull();
    expect(
      verifyJwt(signJwt({ exp: Math.floor(Date.now() / 1000) - 5 }, SECRET), SECRET),
    ).toBeNull();
  });

  it('reads file names and recognises file contents', () => {
    expect(splitFileName('  Q3 Report.final.PPTX ')).toEqual({
      name: 'Q3 Report.final',
      extension: 'pptx',
    });
    expect(splitFileName('notes.txt')).toBeNull();
    expect(matchesFormat('pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    expect(matchesFormat('pdf', office('x'))).toBe(false);
    expect(matchesFormat('xlsx', office('x'))).toBe(true);
    expect(formatBytes(2_621_440)).toBe('2.5 MB');
  });
});
