import { z } from 'zod';

import { MAX_DOCUMENT_BYTES } from './formats';

const folder = z
  .string()
  .trim()
  .max(80)
  .nullish()
  .transform((value) => value || null);

export const startUploadSchema = z.object({
  fileName: z.string().trim().min(3).max(260),
  sizeBytes: z
    .number()
    .int()
    .positive('That file is empty')
    .max(MAX_DOCUMENT_BYTES, 'Files can be up to 15 MB'),
});

export const finishUploadSchema = z.object({
  /** The path handed out by startUpload; checked again against the caller's business. */
  path: z.string().regex(/^[0-9a-f-]{36}\/library\/[0-9a-f-]{36}\.(docx|xlsx|pptx|pdf)$/),
  fileName: z.string().trim().min(3).max(260),
  folder,
});

export const renameDocumentSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, 'Give the document a name').max(200),
  folder,
});

export const documentIdSchema = z.object({ id: z.uuid() });
export const downloadSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive().optional(),
});

export const documentFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  type: z.enum(['docx', 'xlsx', 'pptx', 'pdf']).optional().catch(undefined),
  folder: z.string().trim().max(80).optional().catch(undefined),
});

export type DocumentFilters = z.output<typeof documentFiltersSchema>;
