import { crc32, deflateSync } from 'node:zlib';

import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

import {
  clampBox,
  displayedPointToPdf,
  displayedSize,
  normalizeRotation,
  pointInBox,
  toPdfBox,
  type PageGeometry,
} from '@/modules/esign/geometry';
import {
  maskEmail,
  resolveFieldValues,
  sendProblems,
  signersWhoseTurnItIs,
  waitingOn,
} from '@/modules/esign/rules';
import { inspectPdf, pngSize, sha256Hex, stampSignedPdf } from '@/modules/esign/stamp';
import { AppError } from '@/lib/errors';

/** A real PNG: width × height, solid dark pixels. */
function png(width: number, height: number): Uint8Array {
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
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 0x20)]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

const ROTATIONS = [0, 90, 180, 270] as const;

describe('field geometry', () => {
  it('normalises any rotation to a quarter turn', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
  });

  it('swaps width and height for pages turned a quarter', () => {
    const page = { x: 0, y: 0, width: 600, height: 800, rotation: 90 };
    expect(displayedSize(page)).toEqual({ width: 800, height: 600 });
    expect(displayedSize({ ...page, rotation: 180 })).toEqual({ width: 600, height: 800 });
  });

  it.each(ROTATIONS)(
    'maps displayed points exactly as pdf.js shows a page rotated %i°',
    async (r) => {
      // A real file with an offset crop box, read back by pdf.js: the same geometry the browser
      // uses to draw the page the fields are placed on.
      const source = await PDFDocument.create();
      const sourcePage = source.addPage([600, 800]);
      sourcePage.setCropBox(20, 35, 500, 700);
      sourcePage.setRotation(degrees(r));
      const bytes = await source.save();
      const page = (await inspectPdf(bytes)).pages[0]!;
      const loaded = await getDocument({ data: bytes, isEvalSupported: false }).promise;
      const viewport = (await loaded.getPage(1)).getViewport({ scale: 1 });
      expect(displayedSize(page).width).toBeCloseTo(viewport.width, 6);
      expect(displayedSize(page).height).toBeCloseTo(viewport.height, 6);
      for (const [u, v] of [
        [0, 0],
        [37, 101],
        [viewport.width, viewport.height],
        [viewport.width / 3, viewport.height - 5],
      ] as const) {
        const [ex, ey] = viewport.convertToPdfPoint(u, v) as [number, number];
        const got = displayedPointToPdf(page, u, v);
        expect(got.x).toBeCloseTo(ex, 6);
        expect(got.y).toBeCloseTo(ey, 6);
      }
      await loaded.destroy();
    },
  );

  it.each(ROTATIONS)('keeps a box’s far corner where the reader sees it at %i°', (r) => {
    const page: PageGeometry = { x: 0, y: 0, width: 612, height: 792, rotation: r };
    const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.05 };
    const pdfBox = toPdfBox(page, box);
    const shown = displayedSize(page);
    // The displayed top-right corner, reached from the anchor in the box's own frame.
    const corner = pointInBox(pdfBox, pdfBox.width, pdfBox.height);
    const expected = displayedPointToPdf(
      page,
      (box.x + box.width) * shown.width,
      box.y * shown.height,
    );
    expect(corner.x).toBeCloseTo(expected.x, 6);
    expect(corner.y).toBeCloseTo(expected.y, 6);
    expect(pdfBox.rotate).toBe(r);
  });

  it('keeps boxes on the page', () => {
    expect(clampBox({ x: 0.95, y: -0.2, width: 0.2, height: 0.1 })).toEqual({
      x: 0.8,
      y: 0,
      width: 0.2,
      height: 0.1,
    });
    expect(clampBox({ x: 0.5, y: 0.5, width: 0, height: 3 }).width).toBe(0.01);
  });
});

describe('PNG check', () => {
  it('reads the size of a real PNG', () => {
    expect(pngSize(png(40, 12))).toEqual({ width: 40, height: 12 });
  });

  it('refuses bytes that are not a PNG', () => {
    expect(pngSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)]))).toBeNull();
    expect(pngSize(new Uint8Array(10))).toBeNull();
  });
});

async function samplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]).setRotation(degrees(90));
  const form = pdf.getForm();
  form.createTextField('ref').addToPage(pdf.getPage(0), { x: 50, y: 700, width: 200, height: 20 });
  return pdf.save();
}

const certificate = {
  requestId: '00000000-0000-4000-8000-000000000001',
  title: 'Service agreement',
  businessName: 'Example Cafe',
  senderName: 'Sam Example',
  timezone: 'Australia/Sydney',
  sentAt: new Date('2026-11-01T00:00:00Z'),
  completedAt: new Date('2026-11-02T03:04:05Z'),
  signers: [
    {
      name: 'Ana Signer',
      email: 'ana@example.com',
      verifiedByCode: true,
      signedAt: new Date('2026-11-02T03:04:05Z'),
      ip: '203.0.113.9',
      userAgent: 'Test browser',
      signature: png(120, 40),
    },
  ],
  events: [
    { at: new Date('2026-11-01T00:00:00Z'), text: 'Sent to Ana Signer' },
    { at: new Date('2026-11-02T03:04:05Z'), text: 'Signed by Ana Signer' },
  ],
  verifyUrl: 'https://app.example.com/verify',
};

describe('stamping a signed PDF', () => {
  it('reports pages and refuses files that are not PDFs', async () => {
    const info = await inspectPdf(await samplePdf());
    expect(info.pageCount).toBe(2);
    expect(info.pages[1]?.rotation).toBe(90);
    await expect(inspectPdf(new TextEncoder().encode('%PDF-1.7 not really'))).rejects.toThrow(
      AppError,
    );
  });

  it('draws values on the original, flattens its form and appends the certificate', async () => {
    const original = await samplePdf();
    const result = await stampSignedPdf({
      original,
      expectedSha256: sha256Hex(original),
      fields: [
        {
          kind: 'signature',
          page: 1,
          box: { x: 0.1, y: 0.7, width: 0.3, height: 0.06 },
          value: null,
          image: png(120, 40),
        },
        {
          kind: 'name',
          page: 2,
          box: { x: 0.1, y: 0.1, width: 0.3, height: 0.04 },
          // Outside WinAnsi: must not fail the signing.
          value: 'Ana Signer 李',
          image: null,
        },
        {
          kind: 'checkbox',
          page: 2,
          box: { x: 0.5, y: 0.5, width: 0.03, height: 0.03 },
          value: 'true',
          image: null,
        },
      ],
      certificate,
    });

    expect(result.sha256).toBe(sha256Hex(result.bytes));
    const signed = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(signed.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(signed.getForm().getFields()).toHaveLength(0);
    expect(signed.getProducer()).toBe('Meroidea e-sign');
  });

  it('refuses to stamp a file that is not the one that was sent', async () => {
    const original = await samplePdf();
    const error = await stampSignedPdf({
      original,
      expectedSha256: 'a'.repeat(64),
      fields: [],
      certificate,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
  });

  it('runs the certificate onto more pages when there are many events', async () => {
    const original = await samplePdf();
    const events = Array.from({ length: 120 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 10, 1, 0, index)),
      text: `Event number ${index} with a long description that wraps across the column`,
    }));
    const result = await stampSignedPdf({
      original,
      expectedSha256: sha256Hex(original),
      fields: [],
      certificate: { ...certificate, events },
    });
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBeGreaterThan(3);
  });
});

describe('signing rules', () => {
  const signers = [
    { id: 'a', position: 1, status: 'signed' },
    { id: 'b', position: 2, status: 'pending' },
    { id: 'c', position: 3, status: 'pending' },
  ];

  it('in order, only the first person still to sign may sign', () => {
    expect(signersWhoseTurnItIs(signers, 'sequential').map((s) => s.id)).toEqual(['b']);
    expect(waitingOn(signers, 'c', 'sequential')?.id).toBe('b');
    expect(waitingOn(signers, 'b', 'sequential')).toBeNull();
  });

  it('at once, everyone still to sign may sign', () => {
    expect(signersWhoseTurnItIs(signers, 'parallel').map((s) => s.id)).toEqual(['b', 'c']);
    expect(waitingOn(signers, 'c', 'parallel')).toBeNull();
  });

  it('nobody signs after someone declined in order', () => {
    const declined = [
      { id: 'a', position: 1, status: 'declined' },
      { id: 'b', position: 2, status: 'pending' },
    ];
    expect(signersWhoseTurnItIs(declined, 'sequential')).toEqual([]);
  });

  it('needs a signature field for every signer before sending', () => {
    expect(
      sendProblems({
        signers: [
          { id: 'a', name: 'Ana' },
          { id: 'b', name: 'Ben' },
        ],
        fields: [{ signerId: 'a', kind: 'signature', page: 1 }],
        pageCount: 1,
      }).map((problem) => problem.message),
    ).toEqual(['Place a signature field for Ben.']);
  });

  const fields = [
    { id: 's', kind: 'signature' as const, required: true },
    { id: 'd', kind: 'date' as const, required: true },
    { id: 'n', kind: 'name' as const, required: true },
    { id: 'c', kind: 'checkbox' as const, required: true },
  ];
  const context = { signedOn: '27 Nov 2026', signaturePath: 'sig.png', initialsPath: null };

  it('takes the date from the server, so a signer cannot backdate it', () => {
    const result = resolveFieldValues(
      fields,
      [
        { fieldId: 'd', value: '1 Jan 2001' },
        { fieldId: 'n', value: '  Ana   Signer ' },
        { fieldId: 'c', value: 'true' },
      ],
      context,
    );
    expect('values' in result && Object.fromEntries(result.values)).toEqual({
      s: 'sig.png',
      d: '27 Nov 2026',
      n: 'Ana Signer',
      c: 'true',
    });
  });

  it('refuses a required checkbox left empty and a field that is not theirs', () => {
    expect(resolveFieldValues(fields, [{ fieldId: 'n', value: 'Ana' }], context)).toEqual({
      error: 'Tick every required checkbox.',
    });
    expect(
      'error' in resolveFieldValues(fields, [{ fieldId: 'someone-else', value: 'x' }], context),
    ).toBe(true);
  });

  it('masks an address enough to recognise, not to harvest', () => {
    expect(maskEmail('jordan@example.com')).toBe('j•••@example.com');
  });
});
