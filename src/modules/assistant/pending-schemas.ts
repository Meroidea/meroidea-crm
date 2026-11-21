import { z } from 'zod';

import { saveInvoiceSchema } from '@/modules/invoices/schemas';

/*
 * What a Meroidea AI proposal holds (ADR-064), shared by the server (which stores and executes it)
 * and the confirmation card (which shows and edits it). Ids are what approval acts on; the names
 * beside them are only for showing the person what they are approving, and are never trusted at
 * approval: each module service re-reads and re-checks everything itself.
 */

export const PENDING_KINDS = ['invoice', 'roster', 'staff_email', 'record_update'] as const;
export type PendingKind = (typeof PENDING_KINDS)[number];

export const PENDING_STATUSES = [
  'pending',
  'executing',
  'approved',
  'rejected',
  'failed',
  'expired',
] as const;
export type PendingStatus = (typeof PENDING_STATUSES)[number];

const isoDate = z.iso.date();

/** An AI proposal always creates a new draft, so any id is dropped. */
function withoutId<T extends { id?: string }>(value: T): Omit<T, 'id'> {
  const copy = { ...value };
  delete copy.id;
  return copy;
}
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30');

/** A draft invoice: exactly what saveInvoice accepts, without an id (always a new draft). */
export const invoicePayloadSchema = z.object({
  invoice: saveInvoiceSchema.transform(withoutId),
});

export const rosterPayloadSchema = z.object({
  startsOn: isoDate,
  span: z.enum(['week', 'fortnight']),
  shifts: z
    .array(
      z.object({
        userId: z.uuid(),
        personName: z.string().max(200),
        date: isoDate,
        startTime: clockTime,
        endTime: clockTime,
        note: z.string().trim().max(300).nullable(),
      }),
    )
    .min(1)
    .max(150),
});

export const staffEmailPayloadSchema = z.object({
  recipients: z
    .array(z.object({ userId: z.uuid(), name: z.string().max(200), email: z.string().max(200) }))
    .min(1)
    .max(200),
  subject: z.string().trim().min(1, 'Add a subject').max(150),
  body: z.string().trim().min(1, 'Write the message').max(5_000),
});

export const recordUpdatePayloadSchema = z.discriminatedUnion('change', [
  z.object({
    change: z.literal('move_stage'),
    opportunityId: z.uuid(),
    opportunityName: z.string().max(300),
    fromStageName: z.string().max(120),
    stageId: z.uuid(),
    stageName: z.string().max(120),
    lostReasonId: z.uuid().nullable(),
    lostReasonName: z.string().max(200).nullable(),
  }),
  z.object({
    change: z.literal('create_task'),
    title: z.string().trim().min(1, 'What needs doing?').max(200),
    taskType: z.enum(['follow_up', 'call', 'email', 'meeting', 'document', 'other']),
    priority: z.enum(['low', 'normal', 'high']),
    dueDate: isoDate.nullable(),
    assignedTo: z.uuid().nullable(),
    assigneeName: z.string().max(200).nullable(),
    contactId: z.uuid().nullable(),
    contactName: z.string().max(300).nullable(),
    opportunityId: z.uuid().nullable(),
    opportunityName: z.string().max(300).nullable(),
  }),
]);

export const PAYLOAD_SCHEMAS = {
  invoice: invoicePayloadSchema,
  roster: rosterPayloadSchema,
  staff_email: staffEmailPayloadSchema,
  record_update: recordUpdatePayloadSchema,
} as const;

export type InvoicePayload = z.output<typeof invoicePayloadSchema>;
export type RosterPayload = z.output<typeof rosterPayloadSchema>;
export type StaffEmailPayload = z.output<typeof staffEmailPayloadSchema>;
export type RecordUpdatePayload = z.output<typeof recordUpdatePayloadSchema>;

export type PendingPayload =
  | { kind: 'invoice'; payload: InvoicePayload }
  | { kind: 'roster'; payload: RosterPayload }
  | { kind: 'staff_email'; payload: StaffEmailPayload }
  | { kind: 'record_update'; payload: RecordUpdatePayload };

/** What the chat and the card receive: never the row itself, only what the person may see. */
export type PendingActionView = PendingPayload & {
  id: string;
  summary: string;
  status: PendingStatus;
  error: string | null;
  result: {
    entityType: string;
    entityId: string | null;
    href: string | null;
    note?: string;
  } | null;
  expiresAt: string;
};

/**
 * Edits the person may make on the card before approving. Narrower than the payload: they change
 * wording, amounts and times, and can drop recipients or shifts, but cannot point a proposal at
 * different records; for that they ask the assistant to revise it.
 */
export const pendingEditSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('invoice'),
    invoice: saveInvoiceSchema.transform(withoutId),
  }),
  z.object({
    kind: z.literal('staff_email'),
    subject: z.string().trim().min(1, 'Add a subject').max(150),
    body: z.string().trim().min(1, 'Write the message').max(5_000),
    userIds: z.array(z.uuid()).min(1, 'Keep at least one recipient').max(200),
  }),
  z.object({
    kind: z.literal('roster'),
    shifts: z
      .array(
        z.object({
          userId: z.uuid(),
          date: isoDate,
          startTime: clockTime,
          endTime: clockTime,
          note: z.string().trim().max(300).nullable(),
        }),
      )
      .min(1, 'Keep at least one shift')
      .max(150),
  }),
  z.object({
    kind: z.literal('record_update'),
    title: z.string().trim().min(1, 'What needs doing?').max(200),
    dueDate: isoDate.nullable(),
    priority: z.enum(['low', 'normal', 'high']),
  }),
]);

export type PendingEdit = z.input<typeof pendingEditSchema>;

// ── Money, in exact integer cents ──────────────────────────────────────────────────────────────

/** "12.5" → 1250n at `places` decimals. Inputs are already validated decimal strings. */
function toScaled(value: string, places: number): bigint {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return BigInt(whole + fraction.padEnd(places, '0').slice(0, places));
}

function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * The totals an invoice will get, for the preview only: the database works out the stored ones.
 * Same rounding as the database (half away from zero, on non-negative amounts here), with no
 * floating point anywhere (.claude/rules/coding-standards.md).
 */
export function invoiceTotals(invoice: {
  taxRate: string;
  lines: { quantity: string; unitPrice: string }[];
}): { lines: string[]; subtotal: string; tax: string; total: string } {
  const lineCents = invoice.lines.map(
    (line) => (toScaled(line.quantity, 3) * toScaled(line.unitPrice, 2) + 500n) / 1000n,
  );
  const subtotal = lineCents.reduce((sum, cents) => sum + cents, 0n);
  const tax = (subtotal * toScaled(invoice.taxRate, 2) + 5_000n) / 10_000n;
  return {
    lines: lineCents.map(formatCents),
    subtotal: formatCents(subtotal),
    tax: formatCents(tax),
    total: formatCents(subtotal + tax),
  };
}
