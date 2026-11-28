import { crc32, deflateSync } from 'node:zlib';

import { sql } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const outbox: { to: string; subject: string; text: string }[] = [];
let emailUp = true;
vi.mock('@/server/email', () => ({
  isEmailConfigured: () => emailUp,
  sendEmail: async (message: { to: string; subject: string; text: string }) => {
    if (!emailUp) return { sent: false, reason: 'not_configured' };
    outbox.push(message);
    return { sent: true };
  },
}));

import { AppError } from '@/lib/errors';
import {
  declineSigning,
  getSigningView,
  readSignerDocument,
  sendSigningCode,
  submitSignature,
  verifySignedDocument,
  verifySigningCode,
} from '@/modules/esign/public';
import { getSignRequest, listSignRequests } from '@/modules/esign/queries';
import {
  createSignRequest,
  getSignedDownloadUrl,
  remindSigner,
  saveDraft,
  sendSignRequest,
  voidSignRequest,
} from '@/modules/esign/service';
import { sha256Hex } from '@/modules/esign/stamp';
import { finishUpload, startUpload } from '@/modules/files/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';
import { readObject, removeObject, writeObject } from '@/server/storage';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
// A fresh documentation address per run, so per-sender limits never carry over between runs.
const meta = { ip: `198.51.100.${(stamp % 250) + 1}`, userAgent: 'vitest' };

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let member: TenantContext;
let betaOwner: TenantContext;
let pdfId: string;
const stored: string[] = [];

/** A real PNG, as the signature pad sends it (base64, no prefix). */
function pngBase64(width = 60, height = 20): string {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 0x30)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

async function samplePdf(pages = 2, text = 'agreement'): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(text);
  for (let index = 0; index < pages; index += 1) pdf.addPage([595, 842]);
  return Buffer.from(await pdf.save());
}

async function upload(ctx: TenantContext, fileName: string, bytes: Buffer): Promise<string> {
  const ticket = await startUpload(ctx, { fileName, sizeBytes: bytes.length });
  await writeObject(ticket.path, bytes, 'application/pdf');
  stored.push(ticket.path);
  return (await finishUpload(ctx, { path: ticket.path, fileName, folder: null })).id;
}

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

/** A database refusal, read from Postgres's own message under the query wrapper. */
async function expectRefused(run: () => Promise<unknown>, pattern: RegExp) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as { cause?: { message?: string } }).cause;
  expect(`${(error as Error).message} ${cause?.message ?? ''}`).toMatch(pattern);
}

/** A browser: its own cookie jar, used by the signer functions to read the session. */
function browser() {
  const jar = new Map<string, string>();
  return { jar, read: (name: string) => jar.get(name) };
}

const tokenFrom = (text: string) => {
  const match = /\/sign\/([A-Za-z0-9_-]{40,50})/.exec(text);
  if (!match?.[1]) throw new Error('no signing link in the email');
  return match[1];
};
const lastMailTo = (to: string) => [...outbox].reverse().find((message) => message.to === to);

type DraftSigner = { key: string; name: string; email: string };

/** A sent request: one signature field and one name field per signer, on page 1. */
async function sentRequest(options: {
  signers: DraftSigner[];
  signingOrder?: 'parallel' | 'sequential';
  verifyEmail?: boolean;
  extraFields?: Parameters<typeof saveDraft>[1]['fields'];
}) {
  const { id } = await createSignRequest(owner, { documentId: pdfId });
  await saveDraft(owner, {
    id,
    title: `Agreement ${id.slice(0, 6)}`,
    message: 'Please sign',
    signingOrder: options.signingOrder ?? 'parallel',
    verifyEmail: options.verifyEmail ?? false,
    expiryDays: 30,
    signers: options.signers,
    fields: [
      ...options.signers.flatMap((signer, index) => [
        {
          signerKey: signer.key,
          kind: 'signature' as const,
          page: 1,
          x: 0.1,
          y: 0.1 + index * 0.15,
          width: 0.3,
          height: 0.06,
          required: true,
          label: null,
        },
        {
          signerKey: signer.key,
          kind: 'name' as const,
          page: 1,
          x: 0.5,
          y: 0.1 + index * 0.15,
          width: 0.3,
          height: 0.03,
          required: true,
          label: null,
        },
      ]),
      ...(options.extraFields ?? []),
    ],
  });
  const sent = await sendSignRequest(owner, id);
  return { id, invitations: sent.invitations };
}

async function fieldsFor(token: string, reader: (name: string) => string | undefined) {
  const view = await getSigningView(token, reader, meta);
  if (!view) throw new Error('link not valid');
  return view;
}

async function sign(token: string, reader: (name: string) => string | undefined, name: string) {
  const view = await fieldsFor(token, reader);
  return submitSignature(
    {
      token,
      consent: true,
      signature: pngBase64(),
      initials: null,
      values: view.fields
        .filter((field) => field.kind === 'name' || field.kind === 'text')
        .map((field) => ({ fieldId: field.id, value: name })),
    },
    reader,
    meta,
  );
}

beforeAll(async () => {
  const alpha = await createWorkspace('Esign Alpha', mail('alpha-owner'));
  const beta = await createWorkspace('Esign Beta', mail('beta-owner'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  const memberId = await addMember(alphaTenant, mail('alpha-member'), 'Alpha Member', 'member');
  alphaUsers = [alpha.ownerId, memberId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  member = await contextFor(memberId, alphaTenant);
  betaOwner = await contextFor(beta.ownerId, betaTenant);
  pdfId = await upload(owner, 'Service agreement.pdf', await samplePdf());
});

beforeEach(() => {
  emailUp = true;
  outbox.length = 0;
});

afterAll(async () => {
  const objects = (await adminDb().execute(sql`
    select name from storage.objects
    where bucket_id = 'documents' and (name like ${`${alphaTenant}/%`} or name like ${`${betaTenant}/%`})`)) as unknown as {
    name: string;
  }[];
  for (const path of [...stored, ...objects.map((object) => object.name)]) {
    await removeObject(path).catch(() => undefined);
  }
  await destroyWorkspace(alphaTenant, alphaUsers);
  await destroyWorkspace(betaTenant, betaUsers);
});

describe('who may send for signature', () => {
  it('staff without the permission cannot start or list signature requests', async () => {
    expect(member.grants.has('files.request_signatures')).toBe(false);
    await expectCode(() => createSignRequest(member, { documentId: pdfId }), 'FORBIDDEN');
    await expectCode(() => listSignRequests(member, {}), 'FORBIDDEN');
  });

  it('another business cannot read a request, even through the database directly', async () => {
    const { id } = await createSignRequest(owner, { documentId: pdfId });
    expect(await getSignRequest(betaOwner, id)).toBeNull();
    const rows = await withRls(betaOwner, (tx) =>
      tx.execute(sql`select id from sign_requests where id = ${id}`),
    );
    expect(rows).toHaveLength(0);
    // Nor can it start one from the other business's document.
    await expectCode(() => createSignRequest(betaOwner, { documentId: pdfId }), 'NOT_FOUND');
  });

  it('only PDFs can be sent for signature', async () => {
    const ticket = await startUpload(owner, { fileName: 'Letter.docx', sizeBytes: 10 });
    await writeObject(
      ticket.path,
      Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('docx')]),
      'application/octet-stream',
    );
    stored.push(ticket.path);
    const { id } = await finishUpload(owner, {
      path: ticket.path,
      fileName: 'Letter.docx',
      folder: null,
    });
    await expectCode(() => createSignRequest(owner, { documentId: id }), 'VALIDATION');
  });

  it('a request cannot go out until every signer has a signature field', async () => {
    const { id } = await createSignRequest(owner, { documentId: pdfId });
    await saveDraft(owner, {
      id,
      title: 'No signature field',
      message: null,
      signingOrder: 'parallel',
      verifyEmail: false,
      expiryDays: null,
      signers: [{ key: 'a', name: 'Ana Signer', email: mail('ana-nofield') }],
      fields: [
        {
          signerKey: 'a',
          kind: 'name',
          page: 1,
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.03,
          required: true,
          label: null,
        },
      ],
    });
    await expectCode(() => sendSignRequest(owner, id), 'VALIDATION');
  });

  it('a request that checks signers by email code cannot go out without email', async () => {
    emailUp = false;
    await expectCode(
      () =>
        sentRequest({
          signers: [{ key: 'a', name: 'Ana', email: mail('ana-noemail') }],
          verifyEmail: true,
        }),
      'VALIDATION',
    );
  });
});

describe('what signed-in people can never touch', () => {
  it('cannot read signers’ link, code or session hashes', async () => {
    await expectRefused(
      () =>
        withRls(owner, (tx) =>
          tx.execute(sql`select token_hash from sign_request_signers limit 1`),
        ),
      /permission denied/,
    );
    await expectRefused(
      () =>
        withRls(owner, (tx) =>
          tx.execute(sql`select otp_hash, session_hash from sign_request_signers limit 1`),
        ),
      /permission denied/,
    );
  });

  it('cannot plant a link hash, a filled value or a staff-made signer event', async () => {
    const { id } = await createSignRequest(owner, { documentId: pdfId });
    // A known hash would let the sender open the signer's link themselves.
    await expectRefused(
      () =>
        withRls(owner, (tx) =>
          tx.execute(sql`insert into sign_request_signers (tenant_id, request_id, position, name, email, token_hash)
            values (${alphaTenant}, ${id}, 1, 'Planted', ${mail('planted')}, ${'b'.repeat(64)})`),
        ),
      /row-level security/,
    );
    await saveDraft(owner, {
      id,
      title: 'Planting',
      message: null,
      signingOrder: 'parallel',
      verifyEmail: false,
      expiryDays: null,
      signers: [{ key: 'p', name: 'Pat', email: mail('pat') }],
      fields: [],
    });
    const [signer] = (await adminDb().execute(
      sql`select id from sign_request_signers where request_id = ${id}`,
    )) as unknown as { id: string }[];
    await expectRefused(
      () =>
        withRls(owner, (tx) =>
          tx.execute(sql`insert into sign_request_fields (tenant_id, request_id, signer_id, kind, page, x, y, width, height, value)
            values (${alphaTenant}, ${id}, ${signer!.id}, 'name', 1, 0.1, 0.1, 0.2, 0.03, 'Pre-filled')`),
        ),
      /row-level security/,
    );
    await expectRefused(
      () =>
        withRls(owner, (tx) =>
          tx.execute(sql`insert into sign_request_events (tenant_id, request_id, signer_id, actor_user_id, event)
            values (${alphaTenant}, ${id}, ${signer!.id}, ${owner.userId}, 'signed')`),
        ),
      /row-level security/,
    );
  });

  it('cannot mark a request completed or forge its signed fingerprint', async () => {
    const { id } = await sentRequest({
      signers: [{ key: 'a', name: 'Ana', email: mail('ana-forge') }],
    });
    await expectRefused(
      () =>
        withRls(owner, (tx) =>
          tx.execute(sql`update sign_requests set status = 'completed' where id = ${id}`),
        ),
      /not allowed/,
    );
    await expectRefused(
      () =>
        withRls(owner, (tx) =>
          tx.execute(
            sql`update sign_requests set signed_sha256 = ${'a'.repeat(64)} where id = ${id}`,
          ),
        ),
      /permission denied/,
    );
    await expectRefused(
      () =>
        withRls(owner, (tx) =>
          tx.execute(sql`update sign_request_fields set value = 'forged' where request_id = ${id}`),
        ),
      /permission denied/,
    );
    // What was sent is fixed: the title cannot change after sending.
    await expectRefused(
      () =>
        withRls(owner, (tx) =>
          tx.execute(sql`update sign_requests set title = 'Other' where id = ${id}`),
        ),
      /can only be voided/,
    );
  });
});

describe('signing with an emailed code', () => {
  it('runs from invitation to a verified, signed file', async () => {
    const ana = { key: 'a', name: 'Ana Signer', email: mail('ana') };
    const ben = { key: 'b', name: 'Ben Signer', email: mail('ben') };
    const { id, invitations } = await sentRequest({ signers: [ana, ben], verifyEmail: true });

    // Links are emailed, never handed back to the sender.
    expect(invitations.every((invitation) => invitation.emailed && invitation.link === null)).toBe(
      true,
    );
    const anaToken = tokenFrom(lastMailTo(ana.email)?.text ?? '');
    const benToken = tokenFrom(lastMailTo(ben.email)?.text ?? '');

    // Without the code: the page asks for it, and neither the file nor signing is available.
    const anaBrowser = browser();
    const gate = await fieldsFor(anaToken, anaBrowser.read);
    expect(gate.needsCode).toBe(true);
    expect(gate.fields).toHaveLength(0);
    expect(await readSignerDocument(anaToken, anaBrowser.read)).toBeNull();
    await expectCode(() => sign(anaToken, anaBrowser.read, 'Ana Signer'), 'UNAUTHENTICATED');

    await sendSigningCode(anaToken, meta);
    const code = /(\d{6})$/.exec(lastMailTo(ana.email)?.subject ?? '')?.[1];
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    await expectCode(() => verifySigningCode(anaToken, wrong, meta), 'VALIDATION');
    const session = await verifySigningCode(anaToken, code!, meta);
    anaBrowser.jar.set(session.cookieName, session.secret);

    // Another browser holding the same link still needs its own code.
    expect((await fieldsFor(anaToken, browser().read)).needsCode).toBe(true);

    const anaView = await fieldsFor(anaToken, anaBrowser.read);
    expect(anaView.needsCode).toBe(false);
    expect(anaView.fields.map((field) => field.kind).sort()).toEqual(['name', 'signature']);
    expect(await readSignerDocument(anaToken, anaBrowser.read)).not.toBeNull();

    // A field that belongs to someone else is refused.
    const detail = await getSignRequest(owner, id);
    const benField = detail!.fields.find(
      (field) => field.kind === 'name' && field.signerId === detail!.signers[1]!.id,
    );
    await expectCode(
      () =>
        submitSignature(
          {
            token: anaToken,
            consent: true,
            signature: pngBase64(),
            initials: null,
            values: [{ fieldId: benField!.id, value: 'Not Ben' }],
          },
          anaBrowser.read,
          meta,
        ),
      'VALIDATION',
    );
    // So is an image that is not a PNG.
    await expectCode(
      () =>
        submitSignature(
          {
            token: anaToken,
            consent: true,
            signature: Buffer.from('<svg/>').toString('base64'),
            initials: null,
            values: [],
          },
          anaBrowser.read,
          meta,
        ),
      'VALIDATION',
    );

    expect(await sign(anaToken, anaBrowser.read, 'Ana Signer')).toEqual({ completed: false });
    await expectCode(() => sign(anaToken, anaBrowser.read, 'Ana Again'), 'CONFLICT');
    expect(
      outbox.some(
        (message) =>
          message.to === mail('alpha-owner') && /Ana Signer signed/.test(message.subject),
      ),
    ).toBe(true);

    const benBrowser = browser();
    await sendSigningCode(benToken, meta);
    const benCode = /(\d{6})$/.exec(lastMailTo(ben.email)?.subject ?? '')?.[1];
    const benSession = await verifySigningCode(benToken, benCode!, meta);
    benBrowser.jar.set(benSession.cookieName, benSession.secret);
    expect(await sign(benToken, benBrowser.read, 'Ben Signer')).toEqual({ completed: true });

    // The signed file is stored, and its fingerprint is what was recorded.
    const done = await getSignRequest(owner, id);
    expect(done?.status).toBe('completed');
    const [row] = (await adminDb().execute(
      sql`select signed_storage_path, signed_sha256 from sign_requests where id = ${id}`,
    )) as unknown as { signed_storage_path: string; signed_sha256: string }[];
    const signedBytes = await readObject(row!.signed_storage_path);
    expect(sha256Hex(signedBytes!)).toBe(row!.signed_sha256);
    const signedPdf = await PDFDocument.load(signedBytes!);
    expect(signedPdf.getPageCount()).toBeGreaterThan(2);

    // Anyone holding the exact file can check it; anything else is not found.
    const verified = await verifySignedDocument(row!.signed_sha256, meta);
    expect(verified?.title).toBe(done?.title);
    expect(verified?.signers.map((signer) => signer.name)).toEqual(['Ana Signer', 'Ben Signer']);
    expect(await verifySignedDocument(sha256Hex(Buffer.from('other')), meta)).toBeNull();

    // Everyone is sent their copy; the last signer keeps their link, the others get a new one.
    expect(lastMailTo(ana.email)?.subject).toMatch(/Signed by everyone/);
    const anaDownload = tokenFrom(lastMailTo(ana.email)?.text ?? '');
    expect(anaDownload).not.toBe(anaToken);
    expect(await getSigningView(anaToken, anaBrowser.read, meta)).toBeNull();
    const signedForBen = await readSignerDocument(benToken, benBrowser.read);
    expect(sha256Hex(signedForBen!.bytes)).toBe(row!.signed_sha256);

    // Staff downloads are audited.
    expect((await getSignedDownloadUrl(owner, id)).url).toMatch(/^http/);
    const audits = (await adminDb().execute(sql`
      select action, actor_type from audit_logs
      where tenant_id = ${alphaTenant} and entity_id = ${id} order by created_at`)) as unknown as {
      action: string;
      actor_type: string;
    }[];
    expect(
      audits.filter((entry) => entry.actor_type === 'signer_link').map((entry) => entry.action),
    ).toEqual(['sign', 'sign']);
    expect(audits.some((entry) => entry.action === 'download')).toBe(true);
  });

  it('five wrong codes use the code up', async () => {
    const cara = { key: 'c', name: 'Cara', email: mail('cara') };
    await sentRequest({ signers: [cara], verifyEmail: true });
    const token = tokenFrom(lastMailTo(cara.email)?.text ?? '');
    await sendSigningCode(token, meta);
    const code = /(\d{6})$/.exec(lastMailTo(cara.email)?.subject ?? '')?.[1] ?? '';
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expectCode(() => verifySigningCode(token, wrong, meta), 'VALIDATION');
    }
    await expect(verifySigningCode(token, wrong, meta)).rejects.toThrow(/Too many wrong codes/);
    // The right code no longer works either: a new one must be asked for.
    await expectCode(() => verifySigningCode(token, code, meta), 'VALIDATION');
  });
});

describe('signing rules', () => {
  it('in order, the next signer is invited only after the one before signs', async () => {
    const first = { key: '1', name: 'First Signer', email: mail('first') };
    const second = { key: '2', name: 'Second Signer', email: mail('second') };
    const { id } = await sentRequest({ signers: [first, second], signingOrder: 'sequential' });
    expect(lastMailTo(second.email)).toBeUndefined();
    const detail = await getSignRequest(owner, id);
    await expectCode(
      () => remindSigner(owner, { id, signerId: detail!.signers[1]!.id }),
      'CONFLICT',
    );

    const reader = browser().read;
    await sign(tokenFrom(lastMailTo(first.email)?.text ?? ''), reader, 'First Signer');
    const secondToken = tokenFrom(lastMailTo(second.email)?.text ?? '');
    expect((await fieldsFor(secondToken, reader)).waitingFor).toBeNull();
    expect(await sign(secondToken, reader, 'Second Signer')).toEqual({ completed: true });
  });

  it('a link that could not be emailed is shown once, to pass on by hand', async () => {
    emailUp = false;
    const { invitations } = await sentRequest({
      signers: [{ key: 'd', name: 'Dee', email: mail('dee') }],
    });
    expect(invitations[0]?.emailed).toBe(false);
    const token = tokenFrom(invitations[0]?.link ?? '');
    expect((await fieldsFor(token, browser().read)).fields).toHaveLength(2);
  });

  it('refuses to finish if the stored original was changed after sending, and keeps nothing', async () => {
    const eve = { key: 'e', name: 'Eve', email: mail('eve') };
    const { id } = await createSignRequest(owner, { documentId: pdfId });
    const [request] = (await adminDb().execute(
      sql`select original_storage_path from sign_requests where id = ${id}`,
    )) as unknown as { original_storage_path: string }[];
    const path = request!.original_storage_path;
    const original = await readObject(path);
    await saveDraft(owner, {
      id,
      title: 'Tamper test',
      message: null,
      signingOrder: 'parallel',
      verifyEmail: false,
      expiryDays: null,
      signers: [eve],
      fields: [
        {
          signerKey: 'e',
          kind: 'signature',
          page: 1,
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.06,
          required: true,
          label: null,
        },
      ],
    });
    await sendSignRequest(owner, id);
    const token = tokenFrom(lastMailTo(eve.email)?.text ?? '');

    // Someone swaps the stored file for a different one.
    await removeObject(path);
    await writeObject(path, await samplePdf(2, 'a different agreement'), 'application/pdf');
    try {
      await expectCode(() => sign(token, browser().read, 'Eve'), 'CONFLICT');
      const detail = await getSignRequest(owner, id);
      expect(detail?.status).toBe('sent');
      expect(detail?.signers[0]?.status).toBe('pending');
      const leftovers = (await adminDb().execute(sql`
        select name from storage.objects
        where bucket_id = 'documents' and name like ${`${alphaTenant}/esign/${id}/%`}`)) as unknown as unknown[];
      expect(leftovers).toHaveLength(0);
    } finally {
      await removeObject(path);
      await writeObject(path, original!, 'application/pdf');
    }
  });

  it('declining closes the request for everyone and tells the sender why', async () => {
    const fay = { key: 'f', name: 'Fay', email: mail('fay') };
    const gus = { key: 'g', name: 'Gus', email: mail('gus') };
    const { id } = await sentRequest({ signers: [fay, gus] });
    const reader = browser().read;
    await declineSigning(
      { token: tokenFrom(lastMailTo(fay.email)?.text ?? ''), reason: 'Wrong address on page 1' },
      reader,
      meta,
    );
    expect((await getSignRequest(owner, id))?.status).toBe('declined');
    expect(lastMailTo(mail('alpha-owner'))?.subject).toMatch(/Fay declined/);
    const gusToken = tokenFrom(lastMailTo(gus.email)?.text ?? '');
    expect((await fieldsFor(gusToken, reader)).requestStatus).toBe('declined');
    await expectCode(() => sign(gusToken, reader, 'Gus'), 'NOT_FOUND');
  });

  it('voiding stops every link at once and tells the invited signers', async () => {
    const hal = { key: 'h', name: 'Hal', email: mail('hal') };
    const { id } = await sentRequest({ signers: [hal] });
    const token = tokenFrom(lastMailTo(hal.email)?.text ?? '');
    await voidSignRequest(owner, { id, reason: 'Sent the wrong version' });
    expect(lastMailTo(hal.email)?.subject).toMatch(/no longer needs your signature/);
    const reader = browser().read;
    expect((await fieldsFor(token, reader)).requestStatus).toBe('voided');
    expect(await readSignerDocument(token, reader)).toBeNull();
    await expectCode(() => sign(token, reader, 'Hal'), 'NOT_FOUND');
  });

  it('switching the document library off closes signing links and the staff pages', async () => {
    const ivy = { key: 'i', name: 'Ivy', email: mail('ivy') };
    await sentRequest({ signers: [ivy] });
    const token = tokenFrom(lastMailTo(ivy.email)?.text ?? '');
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'files') where id = ${alphaTenant}`,
    );
    try {
      expect(await getSigningView(token, browser().read, meta)).toBeNull();
      const switchedOff = await contextFor(alphaUsers[0]!, alphaTenant);
      await expectCode(() => listSignRequests(switchedOff, {}), 'FORBIDDEN');
      const rows = await withRls(switchedOff, (tx) =>
        tx.execute(sql`select id from sign_requests`),
      ).catch(() => []);
      expect(rows).toHaveLength(0);
    } finally {
      await adminDb().execute(
        sql`update tenants set features = array_append(features, 'files') where id = ${alphaTenant}`,
      );
    }
  });
});
