import 'server-only';

import { z } from 'zod';

import { zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { listOverdueInvoices } from '@/modules/invoices/queries';
import { invoiceNumber } from '@/modules/invoices/types';
import { getMyName } from '@/modules/members/queries';
import { audit } from '@/server/audit';
import { aiService } from '@/server/ai';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { enforceLimits } from './agent';
import { writeReminder, type ReminderDraft } from './invoice-reminders';
import type { MeroAIInvoiceDraftInput } from './schemas';
import { createDraftInvoiceTool } from './tools/invoice';
import { DATA_RULE } from './tools/shared';
import type { InvoiceDraftArtifact } from './types';

/**
 * Ask MeroAI on the invoices page (ADR-077).
 *
 * Drafting: the manager describes the invoice in a sentence; the fast model only reads it into
 * customer, lines and due date. Everything after that is the chat's own invoice tool: the
 * customer matched to one contact (never a guess between two), exact totals, the invoice form's
 * own checks. Nothing is saved until the manager approves, and approving saves a draft.
 *
 * Chasing: reminders for overdue invoices are written by code from each invoice's own figures
 * (invoice-reminders.ts), so no customer data goes to a model and no figure can be wrong.
 */

const readSchema = z.object({
  clientName: z.string().trim().max(160).nullable(),
  lineItems: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(300),
        quantity: z.number().positive().max(9_999_999),
        unitPrice: z.number().min(0).max(999_999_999),
      }),
    )
    .max(100),
  dueDate: z.iso.date().nullable(),
  notes: z.string().trim().max(600).nullable(),
});

const readJsonSchema = {
  type: 'object',
  properties: {
    clientName: { type: ['string', 'null'], description: 'Who the invoice is for, as written.' },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number', description: '1 when not stated.' },
          unitPrice: { type: 'number', description: 'Price for one, before tax, as written.' },
        },
        required: ['description', 'quantity', 'unitPrice'],
      },
    },
    dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null for the usual terms.' },
    notes: { type: ['string', 'null'], description: 'Anything to print on the invoice.' },
  },
  required: ['clientName', 'lineItems', 'dueDate', 'notes'],
};

export async function draftInvoiceWithMeroAI(
  ctx: TenantContext,
  input: MeroAIInvoiceDraftInput,
): Promise<{ reply: string; artifact: InvoiceDraftArtifact }> {
  requirePermission(ctx, 'ai.use');
  requirePermission(ctx, 'invoices.manage');
  if (!aiService.isConfigured()) {
    throw new AppError(
      'INTERNAL',
      'MeroAI is not set up yet. Ask the platform owner to add a Gemini API key.',
    );
  }
  await enforceLimits(ctx);
  const today = zonedToday(ctx.tenant.timezone);

  const read = await aiService.generateJson('fast', {
    systemInstruction: [
      `You read a request for an invoice and list who it is for, what to charge, and when it is due. Today is ${today}; money is in ${ctx.tenant.currency}.`,
      'Copy amounts exactly as written; never invent a price or a quantity. "Due in 7 days" means 7 days from today. Leave a field null when the request does not say.',
      DATA_RULE,
    ].join('\n'),
    contents: [{ role: 'user', parts: [{ text: input.text }] }],
    jsonSchema: readJsonSchema,
    schema: readSchema,
  });

  if (!read.clientName) throw new AppError('VALIDATION', 'Say who the invoice is for.');
  if (read.lineItems.length === 0) {
    throw new AppError(
      'VALIDATION',
      'Say what to charge, for example “2 hours consulting at $150”.',
    );
  }

  const outcome = await createDraftInvoiceTool.run(
    {
      clientName: read.clientName,
      lineItems: read.lineItems,
      dueDate: read.dueDate ?? undefined,
      notes: read.notes ?? undefined,
    },
    { ctx, today, attachment: null, rosterDate: null },
  );
  if (outcome.kind === 'feedback') {
    const matches = (outcome.data.matches as { name: string }[] | undefined)?.map(
      (match) => match.name,
    );
    throw new AppError(
      'VALIDATION',
      matches?.length
        ? `More than one contact matches “${read.clientName}”: ${matches.join(', ')}. Use their full name.`
        : String(outcome.data.message ?? 'MeroAI could not draft that invoice.'),
    );
  }
  if (outcome.artifact.kind !== 'invoice_draft')
    throw new AppError('INTERNAL', 'MeroAI could not draft that invoice.');

  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_assist',
      entityType: 'ai_assistant',
      entityId: null,
      context: {
        surface: 'invoices',
        action: 'draft',
        model: aiService.modelFor('fast'),
        ...outcome.audit,
      },
    }),
  );
  return { reply: outcome.reply, artifact: outcome.artifact };
}

export async function chaseOverdueInvoices(ctx: TenantContext): Promise<ReminderDraft[]> {
  requirePermission(ctx, 'ai.use');
  requirePermission(ctx, 'invoices.manage');
  const [overdue, sender] = await Promise.all([listOverdueInvoices(ctx), getMyName(ctx)]);
  const today = zonedToday(ctx.tenant.timezone);
  const reminders = overdue.map((invoice) =>
    writeReminder({
      invoiceId: invoice.id,
      reference: invoiceNumber(invoice.number),
      customerName: invoice.customerName,
      customerEmail: invoice.customerEmail,
      balance: invoice.balance,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      today,
      businessName: ctx.tenant.name,
      senderName: sender,
    }),
  );
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_assist',
      entityType: 'ai_assistant',
      entityId: null,
      // Counts only: which customers owe what stays out of the log.
      context: { surface: 'invoices', action: 'chase', model: null, reminders: reminders.length },
    }),
  );
  return reminders;
}
