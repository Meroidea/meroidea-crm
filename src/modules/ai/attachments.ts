/**
 * Files people attach for review (ADR-073). They go to the model and nowhere else: never stored,
 * never logged. The type is decided from the file's leading bytes, not from what the browser
 * claims, so a renamed file cannot pass as something it is not (rules/security.md §Files).
 */

/** Under Vercel's 4.5 MB request limit, which a Server Action body also has to fit. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export const ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.txt,.md,.csv';

export type AttachmentType =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif'
  | 'text/plain';

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** The file's real type from its first bytes, or null when it is not one we accept. */
export function sniffAttachmentType(bytes: Uint8Array, fileName: string): AttachmentType | null {
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1', 'heif'].includes(brand)) return 'image/heif';
  }
  // Plain text has no signature: accept the usual extensions when the bytes decode as UTF-8 and
  // carry no NUL bytes (which no text file has, and every binary format does).
  if (/\.(txt|md|csv)$/i.test(fileName) && !bytes.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return 'text/plain';
    } catch {
      return null;
    }
  }
  return null;
}
