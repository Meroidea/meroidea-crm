import 'server-only';

import { createHash } from 'node:crypto';

import {
  degrees,
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';

import { AppError } from '@/lib/errors';

import { pointInBox, toPdfBox, type Box, type FieldKind, type PageGeometry } from './geometry';

/**
 * Builds the signed file on the server (ADR-089). The browser only ever sends the values a signer
 * typed or drew; it never sends a PDF. The original is read from storage, checked against the
 * hash recorded when the request was sent, and every value is drawn onto it here. A completion
 * certificate is appended, and the finished file's hash is what /verify checks.
 */

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The width and height from a PNG's header, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return null;
  }
  // The first chunk must be IHDR: length 13, then the type, then width and height.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = String.fromCharCode(...bytes.subarray(12, 16));
  if (view.getUint32(8) !== 13 || type !== 'IHDR') return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

export type PdfInfo = { pageCount: number; pages: PageGeometry[] };

/**
 * Reads a PDF the way stamping will, so a file that cannot be signed is refused before anyone is
 * asked to sign it: encrypted, damaged, or without pages.
 */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInfo> {
  let pages: PageGeometry[];
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    // pdf-lib accepts some damaged files at load and only fails on reaching their page tree.
    pages = pdf.getPages().map(geometryOf);
  } catch (error) {
    const encrypted = error instanceof Error && /encrypt/i.test(error.message);
    throw new AppError(
      'VALIDATION',
      encrypted
        ? 'This PDF is password-protected or encrypted. Save an unprotected copy and upload that.'
        : 'This PDF could not be read. Save it again from the program that made it and upload that.',
    );
  }
  if (pages.length === 0) throw new AppError('VALIDATION', 'This PDF has no pages.');
  return { pageCount: pages.length, pages };
}

function geometryOf(page: PDFPage): PageGeometry {
  const crop = page.getCropBox();
  return {
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    rotation: page.getRotation().angle,
  };
}

export type StampField = {
  kind: FieldKind;
  page: number;
  box: Box;
  /** Text for name, date and text; 'true' for a ticked checkbox. */
  value: string | null;
  /** PNG bytes for signature and initials. */
  image: Uint8Array | null;
};

export type CertificateSigner = {
  name: string;
  email: string;
  verifiedByCode: boolean;
  signedAt: Date;
  ip: string | null;
  userAgent: string | null;
  signature: Uint8Array | null;
};

export type CertificateEvent = { at: Date; text: string };

export type Certificate = {
  requestId: string;
  title: string;
  businessName: string;
  senderName: string;
  timezone: string;
  sentAt: Date;
  completedAt: Date;
  signers: CertificateSigner[];
  events: CertificateEvent[];
  verifyUrl: string;
};

const INK = rgb(0.07, 0.1, 0.2);
const MUTED = rgb(0.38, 0.42, 0.5);
const RULE = rgb(0.85, 0.87, 0.91);

/**
 * Helvetica covers Western European text only (WinAnsi). Anything else in a typed value is shown
 * as "?" rather than failing the whole signature; drawn and typed signatures are images, so they
 * keep any script.
 */
function printable(font: PDFFont, text: string): string {
  const known = new Set(font.getCharacterSet());
  return Array.from(text.replace(/[\r\n\t]+/g, ' '))
    .map((char) => (known.has(char.codePointAt(0) ?? -1) ? char : '?'))
    .join('');
}

function fitText(font: PDFFont, text: string, width: number, height: number) {
  let size = Math.min(height * 0.72, 14);
  while (size > 5 && font.widthOfTextAtSize(text, size) > width - 4) size -= 0.5;
  if (font.widthOfTextAtSize(text, size) <= width - 4) return { text, size };
  // Still too long at the smallest size: cut it and say so, rather than spill past the box.
  let shown = text;
  while (shown.length > 1 && font.widthOfTextAtSize(`${shown}...`, size) > width - 4) {
    shown = shown.slice(0, -1);
  }
  return { text: `${shown}...`, size };
}

async function drawField(
  pdf: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  field: StampField,
): Promise<void> {
  const box = toPdfBox(geometryOf(page), field.box);
  const rotate = degrees(box.rotate);

  if (field.kind === 'signature' || field.kind === 'initials') {
    if (!field.image) return;
    const image = await pdf.embedPng(field.image);
    const scale = Math.min(box.width / image.width, box.height / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const at = pointInBox(box, (box.width - width) / 2, (box.height - height) / 2);
    page.drawImage(image, { x: at.x, y: at.y, width, height, rotate });
    return;
  }

  if (field.kind === 'checkbox') {
    if (field.value !== 'true') return;
    const side = Math.min(box.width, box.height);
    const inset = side * 0.18;
    const ox = (box.width - side) / 2;
    const oy = (box.height - side) / 2;
    const corner = (dx: number, dy: number) => pointInBox(box, ox + dx, oy + dy);
    const thickness = Math.max(side * 0.1, 0.8);
    page.drawLine({
      start: corner(inset, inset),
      end: corner(side - inset, side - inset),
      thickness,
      color: INK,
    });
    page.drawLine({
      start: corner(inset, side - inset),
      end: corner(side - inset, inset),
      thickness,
      color: INK,
    });
    return;
  }

  const value = field.value ? printable(font, field.value) : '';
  if (!value) return;
  const fitted = fitText(font, value, box.width, box.height);
  const at = pointInBox(box, 2, (box.height - fitted.size) / 2 + fitted.size * 0.22);
  page.drawText(fitted.text, { x: at.x, y: at.y, size: fitted.size, font, color: INK, rotate });
}

function formatInZone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

/** Lays out certificate pages top to bottom, adding a page whenever the current one fills. */
class Writer {
  private page!: PDFPage;
  private y = 0;
  private readonly margin = 48;
  private readonly width = 595.28;
  private readonly height = 841.89;

  constructor(
    private readonly pdf: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.newPage();
  }

  private newPage() {
    this.page = this.pdf.addPage([this.width, this.height]);
    this.y = this.height - this.margin;
  }

  private ensure(space: number) {
    if (this.y - space < this.margin) this.newPage();
  }

  get contentWidth() {
    return this.width - this.margin * 2;
  }

  gap(points: number) {
    this.y -= points;
  }

  text(
    value: string,
    options: { size?: number; bold?: boolean; color?: typeof INK; indent?: number } = {},
  ) {
    const size = options.size ?? 9.5;
    const font = options.bold ? this.bold : this.regular;
    const indent = options.indent ?? 0;
    for (const line of this.wrap(printable(font, value), font, size, this.contentWidth - indent)) {
      this.ensure(size + 4);
      this.y -= size + 3;
      this.page.drawText(line, {
        x: this.margin + indent,
        y: this.y,
        size,
        font,
        color: options.color ?? INK,
      });
    }
  }

  /** Width a label needs at row size, so a column can be made wide enough for all of them. */
  labelWidthOf(label: string): number {
    return this.regular.widthOfTextAtSize(printable(this.regular, label), 9.5);
  }

  row(label: string, value: string, labelWidth = 120) {
    const size = 9.5;
    const lines = this.wrap(
      printable(this.regular, value),
      this.regular,
      size,
      this.contentWidth - labelWidth,
    );
    this.ensure((size + 3) * lines.length + 2);
    lines.forEach((line, index) => {
      this.y -= size + 3;
      if (index === 0) {
        this.page.drawText(printable(this.regular, label), {
          x: this.margin,
          y: this.y,
          size,
          font: this.regular,
          color: MUTED,
        });
      }
      this.page.drawText(line, {
        x: this.margin + labelWidth,
        y: this.y,
        size,
        font: this.regular,
        color: INK,
      });
    });
  }

  rule() {
    this.ensure(14);
    this.y -= 8;
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.width - this.margin, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.y -= 6;
  }

  image(image: PDFImage, maxWidth: number, maxHeight: number, indent = 0) {
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    // Clear of the text above it: its frame starts below the previous line's descenders.
    this.ensure(height + 18);
    this.y -= height + 12;
    this.page.drawRectangle({
      x: this.margin + indent - 4,
      y: this.y - 4,
      width: width + 8,
      height: height + 8,
      borderColor: RULE,
      borderWidth: 0.6,
    });
    this.page.drawImage(image, { x: this.margin + indent, y: this.y, width, height });
    this.y -= 6;
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the column (a hash, a long address) is broken by characters.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }
}

async function addCertificate(
  pdf: PDFDocument,
  certificate: Certificate,
  originalSha256: string,
  pageCount: number,
) {
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const when = (date: Date) => formatInZone(date, certificate.timezone);
  const writer = new Writer(pdf, regular, bold);

  writer.text('Certificate of completion', { size: 18, bold: true });
  writer.gap(2);
  writer.text(`Signed electronically through Meroidea for ${certificate.businessName}.`, {
    color: MUTED,
  });
  writer.rule();

  writer.row('Document', certificate.title);
  writer.row('Request', certificate.requestId);
  writer.row('Sent by', `${certificate.senderName}, ${certificate.businessName}`);
  writer.row('Sent', when(certificate.sentAt));
  writer.row('Completed', when(certificate.completedAt));
  writer.row('Pages', `${pageCount} signed, plus this certificate`);
  writer.row('Original SHA-256', originalSha256);
  writer.rule();

  writer.text('Signers', { size: 12, bold: true });
  for (const [index, signer] of certificate.signers.entries()) {
    writer.gap(4);
    writer.text(`${index + 1}. ${signer.name} <${signer.email}>`, { bold: true });
    writer.row(
      'Identity check',
      signer.verifiedByCode
        ? 'Opened a personal link and entered a one-time code emailed to this address'
        : 'Opened a personal link emailed to this address',
    );
    writer.row('Signed', when(signer.signedAt));
    writer.row('IP address', signer.ip ?? 'Not recorded');
    if (signer.userAgent) writer.row('Device', signer.userAgent.slice(0, 200));
    writer.row('Consent', 'Agreed to sign electronically and to be bound by this signature');
    if (signer.signature) {
      writer.image(await pdf.embedPng(signer.signature), 180, 54, 120);
    }
  }
  writer.rule();

  writer.text('History', { size: 12, bold: true });
  writer.gap(2);
  const times = certificate.events.map((event) => when(event.at));
  const timeColumn = Math.min(
    Math.max(120, ...times.map((time) => writer.labelWidthOf(time) + 14)),
    writer.contentWidth / 2,
  );
  certificate.events.forEach((event, index) => {
    writer.row(times[index] ?? '', event.text, timeColumn);
  });
  writer.rule();

  writer.text(
    'Meroidea added this certificate when the last person signed, then recorded a SHA-256 ' +
      'fingerprint of the whole file. Any change to the file afterwards changes that fingerprint. ' +
      `To check a copy, open ${certificate.verifyUrl} and choose the file.`,
    { size: 8.5, color: MUTED },
  );
}

/**
 * The finished file: every value drawn onto the original, form fields flattened, and the
 * certificate appended. Refuses if the original is not the file that was sent.
 */
export async function stampSignedPdf(input: {
  original: Uint8Array;
  expectedSha256: string;
  fields: StampField[];
  certificate: Certificate;
}): Promise<{ bytes: Uint8Array; sha256: string }> {
  const originalSha256 = sha256Hex(input.original);
  if (originalSha256 !== input.expectedSha256) {
    throw new AppError(
      'CONFLICT',
      'The stored document no longer matches the one that was sent, so it cannot be signed.',
    );
  }
  const pdf = await PDFDocument.load(input.original, { updateMetadata: false });
  const pages = pdf.getPages();
  const pageCount = pages.length;

  // Form fields left editable could be changed after signing without breaking the look of the
  // page; flattening makes them part of the page. A malformed form is left as it is.
  try {
    const form = pdf.getForm();
    if (form.getFields().length > 0) form.flatten();
  } catch {
    // Drawing the signers' values does not depend on the form.
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const field of input.fields) {
    const page = pages[field.page - 1];
    if (!page) throw new AppError('INTERNAL', 'A field points at a page the document lacks.');
    await drawField(pdf, page, font, field);
  }

  await addCertificate(pdf, input.certificate, originalSha256, pageCount);
  pdf.setProducer('Meroidea e-sign');
  pdf.setModificationDate(input.certificate.completedAt);

  const bytes = await pdf.save();
  return { bytes, sha256: sha256Hex(bytes) };
}
