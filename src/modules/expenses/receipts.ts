/** What a receipt may be: a photo or a PDF. Checked by extension, then by the file's first bytes. */
export const RECEIPT_FORMATS = {
  pdf: { mimeType: 'application/pdf', magic: [[0x25, 0x50, 0x44, 0x46]] },
  jpg: { mimeType: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mimeType: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  png: { mimeType: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  webp: { mimeType: 'image/webp', magic: [[0x52, 0x49, 0x46, 0x46]] },
} as const;

export type ReceiptExtension = keyof typeof RECEIPT_FORMATS;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const RECEIPT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';

export function receiptExtension(fileName: string): ReceiptExtension | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return extension in RECEIPT_FORMATS ? (extension as ReceiptExtension) : null;
}

export function matchesReceipt(extension: ReceiptExtension, head: Uint8Array): boolean {
  const starts = RECEIPT_FORMATS[extension].magic.some((magic) =>
    magic.every((byte, index) => head[index] === byte),
  );
  if (extension !== 'webp') return starts;
  // RIFF....WEBP
  return starts && [0x57, 0x45, 0x42, 0x50].every((byte, index) => head[8 + index] === byte);
}
