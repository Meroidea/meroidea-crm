import { z } from 'zod';

import { LEAD_TYPES } from '@/modules/contacts/schemas';

/** Contact fields a column can map to. The business's own fields join as `custom.<key>`. */
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
  { key: 'jobTitle', label: 'Job title', hints: ['job title', 'title', 'position', 'role'] },
  {
    key: 'companyName',
    label: 'Company',
    hints: ['company', 'company name', 'organisation', 'organization', 'business', 'account'],
  },
  { key: 'companyWebsite', label: 'Company website', hints: ['website', 'web', 'url', 'domain'] },
  {
    key: 'companySize',
    label: 'Company size',
    hints: ['company size', 'size', 'employees', 'headcount'],
  },
  { key: 'industry', label: 'Industry', hints: ['industry', 'sector'] },
  { key: 'linkedinUrl', label: 'LinkedIn', hints: ['linkedin', 'linkedin url'] },
  { key: 'language', label: 'Language', hints: ['language', 'preferred language'] },
  {
    key: 'interest',
    label: 'Interest',
    hints: ['interest', 'product', 'service', 'interested in'],
  },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]['key'];
/** A column's target: a contact field, or one of the business's own fields. */
export type ImportTarget = ImportFieldKey | `custom.${string}`;

export const IMPORT_CHUNK_SIZE = 200;
export const IMPORT_MAX_ROWS = 10_000;

/** skip: leave the existing record alone. merge: fill its blanks. create: add a second record. */
export const IMPORT_DUPLICATE_STRATEGIES = ['skip', 'merge', 'create'] as const;
export type ImportDuplicateStrategy = (typeof IMPORT_DUPLICATE_STRATEGIES)[number];

/** me: the importer. auto: the routing rules, row by row. queue: unassigned. */
export const IMPORT_ASSIGNMENTS = ['me', 'auto', 'queue'] as const;

const optionalId = z
  .union([z.literal(''), z.uuid()])
  .optional()
  .transform((value) => value || null);

/** Opens an upload batch: what every row shares, chosen once and kept on the server. */
export const startImportSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  rowCount: z.number().int().min(1).max(IMPORT_MAX_ROWS),
  asLeads: z.boolean().default(false),
  leadType: z
    .union([z.literal(''), z.enum(LEAD_TYPES)])
    .optional()
    .transform((value) => value || null),
  sourceId: optionalId,
  subSourceId: optionalId,
  campaignName: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value || null),
  duplicates: z.enum(IMPORT_DUPLICATE_STRATEGIES).default('skip'),
  assignment: z.enum(IMPORT_ASSIGNMENTS).default('me'),
});

export type StartImportInput = z.output<typeof startImportSchema>;

export const importChunkSchema = z.object({
  rows: z
    .array(z.record(z.string().max(80), z.string().max(500)))
    .min(1)
    .max(IMPORT_CHUNK_SIZE),
  /** Row numbers in the original file, for the report. */
  firstRowNumber: z.number().int().min(1),
  /** The batch from startImport; its settings apply to every row. */
  batchId: z.uuid().optional(),
  // Without a batch (older callers), these two apply.
  sourceId: optionalId,
  duplicates: z.enum(IMPORT_DUPLICATE_STRATEGIES).default('skip'),
});

export type ImportChunkInput = z.output<typeof importChunkSchema>;

export const finishImportSchema = z.object({ batchId: z.uuid() });

export type ImportRowOutcome = 'created' | 'merged' | 'skipped' | 'duplicate_created' | 'error';

export type ImportReportRow = {
  row: number;
  outcome: ImportRowOutcome;
  reason?: string;
  contactId?: string;
};

export type ImportChunkResult = {
  created: number;
  merged: number;
  skippedDuplicates: number;
  duplicatesCreated: number;
  invalid: { row: number; reason: string }[];
};

export const IMPORT_OUTCOME_LABELS: Record<ImportRowOutcome, string> = {
  created: 'Created',
  merged: 'Merged into existing',
  skipped: 'Skipped (duplicate)',
  duplicate_created: 'Created despite a duplicate',
  error: 'Not imported',
};
