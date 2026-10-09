/** The file types the document library accepts. Pure; shared by browser and server. */

export const DOCUMENT_FORMATS = {
  docx: {
    label: 'Word document',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    /** Which editor the document server opens it with. */
    editor: 'word',
  },
  xlsx: {
    label: 'Excel spreadsheet',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    editor: 'cell',
  },
  pptx: {
    label: 'PowerPoint presentation',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    editor: 'slide',
  },
  pdf: { label: 'PDF', mimeType: 'application/pdf', editor: 'pdf' },
} as const;

export type DocumentExtension = keyof typeof DOCUMENT_FORMATS;
export const DOCUMENT_EXTENSIONS = Object.keys(DOCUMENT_FORMATS) as DocumentExtension[];

/** 15 MB, the platform's upload limit (.claude/rules/security.md). */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export function splitFileName(
  fileName: string,
): { name: string; extension: DocumentExtension } | null {
  const match = /^(.*)\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  const extension = match?.[2]?.toLowerCase();
  const name = match?.[1]?.trim();
  if (!name || !extension || !(extension in DOCUMENT_FORMATS)) return null;
  return { name: name.slice(0, 200), extension: extension as DocumentExtension };
}

/**
 * Whether the bytes look like what the extension claims: a PDF starts with "%PDF", and the
 * Office formats are zip archives. A renamed executable fails this.
 */
export function matchesFormat(extension: DocumentExtension, head: Uint8Array): boolean {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte);
  return extension === 'pdf' ? starts(0x25, 0x50, 0x44, 0x46) : starts(0x50, 0x4b, 0x03, 0x04);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
