import { z } from 'zod';

import { FIELD_KINDS } from './geometry';

/** Limits that keep one request reasonable to sign and to stamp. */
export const MAX_SIGNERS = 10;
export const MAX_FIELDS = 300;
/** A drawn or typed signature arrives as a PNG; 300 KB is far more than a clean one needs. */
export const MAX_SIGNATURE_BYTES = 300 * 1024;
export const MAX_TEXT_VALUE = 500;

const fraction = z.number().min(0).max(1);

export const requestIdSchema = z.object({ id: z.uuid() });
export const createSignRequestSchema = z.object({ documentId: z.uuid() });

export const draftSignerSchema = z.object({
  /** The signer's id once saved, or a temporary key the browser made up for a new one. */
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1, 'Enter the signer’s name').max(120),
  email: z
    .email('Enter a valid email address')
    .trim()
    .toLowerCase()
    .max(254, 'That email address is too long'),
});

export const draftFieldSchema = z
  .object({
    signerKey: z.string().trim().min(1).max(40),
    kind: z.enum(FIELD_KINDS),
    page: z.number().int().min(1).max(5000),
    x: fraction,
    y: fraction,
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
    required: z.boolean(),
    label: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((value) => value || null),
  })
  .refine((field) => field.x + field.width <= 1.0001 && field.y + field.height <= 1.0001, {
    message: 'A field must sit inside its page',
  });

export const saveDraftSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1, 'Give the request a title').max(200),
    message: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .transform((value) => value || null),
    signingOrder: z.enum(['parallel', 'sequential']),
    verifyEmail: z.boolean(),
    expiryDays: z.number().int().min(1).max(365).nullable(),
    signers: z.array(draftSignerSchema).max(MAX_SIGNERS, `Up to ${MAX_SIGNERS} signers`),
    fields: z.array(draftFieldSchema).max(MAX_FIELDS, `Up to ${MAX_FIELDS} fields`),
  })
  .superRefine((draft, issue) => {
    const keys = new Set<string>();
    const emails = new Set<string>();
    draft.signers.forEach((signer, index) => {
      if (keys.has(signer.key)) {
        issue.addIssue({ code: 'custom', path: ['signers', index, 'key'], message: 'Repeated' });
      }
      if (emails.has(signer.email)) {
        issue.addIssue({
          code: 'custom',
          path: ['signers', index, 'email'],
          message: 'Each signer needs their own email address',
        });
      }
      keys.add(signer.key);
      emails.add(signer.email);
    });
    draft.fields.forEach((field, index) => {
      if (!keys.has(field.signerKey)) {
        issue.addIssue({
          code: 'custom',
          path: ['fields', index, 'signerKey'],
          message: 'This field belongs to a signer who was removed',
        });
      }
    });
  });

export const voidRequestSchema = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(1, 'Say why, so the signers know').max(500),
});

export const remindSignerSchema = z.object({ id: z.uuid(), signerId: z.uuid() });
export const downloadSignedSchema = z.object({ id: z.uuid() });

export const requestFiltersSchema = z.object({
  status: z.enum(['draft', 'sent', 'completed', 'declined', 'voided']).optional().catch(undefined),
  cursor: z.string().max(500).optional().catch(undefined),
});

// Signer side: the link's secret is the credential (ADR-089).
const linkToken = z.string().regex(/^[A-Za-z0-9_-]{40,50}$/);

export const signerTokenSchema = z.object({ token: linkToken });
export const verifyCodeSchema = z.object({
  token: linkToken,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from the email'),
});

export const submitSignatureSchema = z.object({
  token: linkToken,
  /** Their agreement to sign electronically; nothing is recorded without it. */
  consent: z.literal(true, { error: 'Tick the box to agree to sign electronically' }),
  /** PNG as base64, without a data: prefix. */
  signature: z.string().max(Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 4),
  initials: z
    .string()
    .max(Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 4)
    .nullable(),
  values: z
    .array(z.object({ fieldId: z.uuid(), value: z.string().max(MAX_TEXT_VALUE) }))
    .max(MAX_FIELDS),
});

export const declineSchema = z.object({
  token: linkToken,
  reason: z.string().trim().min(1, 'Say why you are declining').max(500),
});

export const verifyDocumentSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type SaveDraftInput = z.output<typeof saveDraftSchema>;
export type SubmitSignatureInput = z.output<typeof submitSignatureSchema>;
export type RequestFilters = z.output<typeof requestFiltersSchema>;
