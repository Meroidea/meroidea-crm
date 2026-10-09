/** A résumé may be a PDF or a Word document. Checked by extension, then by its first bytes. */
export const RESUME_FORMATS = {
  pdf: { mimeType: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },
  docx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
} as const;

export type ResumeExtension = keyof typeof RESUME_FORMATS;
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const RESUME_ACCEPT = '.pdf,.docx';

export function resumeExtension(fileName: string): ResumeExtension | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return extension in RESUME_FORMATS ? (extension as ResumeExtension) : null;
}

export function matchesResume(extension: ResumeExtension, head: Uint8Array): boolean {
  return RESUME_FORMATS[extension].magic.every((byte, index) => head[index] === byte);
}
