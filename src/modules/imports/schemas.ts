import { z } from 'zod';

/** Contact fields a column can map to. Custom fields join this list with milestone 12. */
export const IMPORT_FIELDS = [
  {
    key: 'firstName',
    label: 'First name',
    hints: ['first name', 'firstname', 'given name', 'first'],
  },
  {
    key: 'lastName',
    label: 'Last name',
    hints: ['last name', 'lastname', 'surname', 'family name', 'last'],
  },
  {
    key: 'fullName',
    label: 'Full name (split automatically)',
    hints: ['name', 'full name', 'contact name'],
  },
  { key: 'email', label: 'Email', hints: ['email', 'e-mail', 'email address'] },
  { key: 'phone', label: 'Phone', hints: ['phone', 'mobile', 'phone number', 'cell', 'telephone'] },
  { key: 'city', label: 'City', hints: ['city', 'town', 'suburb'] },
  { key: 'region', label: 'State / region', hints: ['state', 'region', 'province'] },
  { key: 'country', label: 'Country code', hints: ['country', 'country code'] },
  { key: 'gender', label: 'Gender', hints: ['gender', 'sex'] },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]['key'];

export const IMPORT_CHUNK_SIZE = 200;

export const importChunkSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.string().max(500)))
    .min(1)
    .max(IMPORT_CHUNK_SIZE),
  /** Row numbers in the original file, for error messages. */
  firstRowNumber: z.number().int().min(1),
  sourceId: z
    .union([z.literal(''), z.uuid()])
    .optional()
    .transform((value) => value || null),
  duplicates: z.enum(['skip', 'create']).default('skip'),
});

export type ImportChunkInput = z.output<typeof importChunkSchema>;

export type ImportChunkResult = {
  created: number;
  skippedDuplicates: number;
  invalid: { row: number; reason: string }[];
};
