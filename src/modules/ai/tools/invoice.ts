import 'server-only';

import { z } from 'zod';

import { addDaysToDate } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import { getLastFromDetails } from '@/modules/invoices/queries';
import { saveInvoiceSchema } from '@/modules/invoices/schemas';
import { DEFAULT_PAYMENT_DAYS, defaultTaxRate } from '@/modules/invoices/types';
import { hasPermission } from '@/server/context';

import { decimalString, invoiceTotals, lineTotal } from '../invoice-math';
import type { InvoiceDraftArtifact } from '../types';
import { contactAddress, feedback, resolveContact, type ToolDefinition } from './shared';

const args = z.object({
  clientId: z.uuid().optional(),
  clientName: z.string().trim().min(1).max(160).optional(),
  lineItems: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(300),
        quantity: z.number().positive().max(9_999_999),
        unitPrice: z.number().min(0).max(999_999_999),
      }),
    )
    .min(1)
    .max(100),
  dueDate: z.iso.date().optional(),
  notes: z.string().trim().max(600).optional(),
});

type Args = z.output<typeof args>;

/**
 * Prepares an invoice for the person to check. Nothing is written: invoice numbers have no gaps,
 * so a draft the person then discards would leave a voided number behind. Approving saves it as
 * an ordinary draft through the invoices service, which still sends nothing.
 */
export const createDraftInvoiceTool: ToolDefinition<Args> = {
  name: 'create_draft_invoice',
  description:
    'Prepare a draft customer invoice for the user to review. Nothing is saved or sent until the user approves it, and approving only saves a draft. Use clientId when the user is looking at a contact; otherwise clientName. Never invent prices or quantities: ask the user if they are missing.',
  parameters: {
    type: 'object',
    properties: {
      clientId: { type: 'string', description: 'The id of the contact being invoiced, if known.' },
      clientName: {
        type: 'string',
        description: 'Who the invoice is for, as the user named them.',
      },
      lineItems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            quantity: { type: 'number', description: 'Greater than zero.' },
            unitPrice: { type: 'number', description: 'Price for one unit, before tax.' },
          },
          required: ['description', 'quantity', 'unitPrice'],
        },
      },
      dueDate: { type: 'string', description: 'YYYY-MM-DD. Leave out for the usual terms.' },
      notes: {
        type: 'string',
        description: 'Notes printed on the invoice, such as payment details.',
      },
    },
    required: ['lineItems'],
  },
  args,
  available: ({ ctx }) => hasPermission(ctx, 'invoices.manage'),

  async run(input, { ctx, today }) {
    if (!input.clientId && !input.clientName) {
      return feedback('Ask the user who the invoice is for.');
    }
    const match = await resolveContact(ctx, {
      contactId: input.clientId,
      contactName: input.clientName,
    });
    if (match.kind === 'ambiguous') {
      return feedback('Several contacts match that name. Ask the user which one they mean.', {
        matches: match.options,
      });
    }
    if (match.kind === 'none' && input.clientId) {
      return feedback(
        'No contact with that id is visible to the user. Ask who the invoice is for.',
      );
    }

    const warnings: string[] = [];
    const lines: InvoiceDraftArtifact['lines'] = [];
    for (const item of input.lineItems) {
      const quantity = decimalString(item.quantity, 3);
      const unitPrice = item.unitPrice.toFixed(2);
      const total = quantity ? lineTotal(quantity, unitPrice) : null;
      if (!quantity || !total) {
        return feedback(
          `The line "${item.description}" has a quantity or price that cannot be used.`,
        );
      }
      if (decimalString(item.quantity, 3) !== decimalString(item.quantity, 6)) {
        warnings.push(`The quantity for "${item.description}" was rounded to ${quantity}.`);
      }
      if (Number(unitPrice) === 0) warnings.push(`"${item.description}" has no price.`);
      lines.push({ description: item.description, quantity, unitPrice, lineTotal: total });
    }

    const customer =
      match.kind === 'found'
        ? {
            name: match.contact.fullName,
            email: match.contact.email,
            address: contactAddress(match.contact),
            contactId: match.contact.id,
          }
        : { name: input.clientName!, email: null, address: null, contactId: null };
    if (match.kind === 'none') {
      warnings.push(
        `"${customer.name}" was not matched to a contact; check the name and add an email to send it.`,
      );
    }

    const taxRate = defaultTaxRate(ctx.tenant.country);
    const draft = {
      customerName: customer.name,
      customerEmail: customer.email ?? '',
      customerAddress: customer.address,
      fromDetails: (await getLastFromDetails(ctx)) ?? ctx.tenant.name,
      issueDate: today,
      dueDate: input.dueDate ?? addDaysToDate(today, DEFAULT_PAYMENT_DAYS),
      taxRate,
      notes: input.notes ?? null,
      lines: lines.map(({ description, quantity, unitPrice }) => ({
        description,
        quantity,
        unitPrice,
      })),
    };
    // The same checks the invoice form makes, so what the person approves will save.
    const checked = saveInvoiceSchema.safeParse(draft);
    if (!checked.success) {
      return feedback('The invoice is not valid yet. Fix these and try again, or ask the user.', {
        problems: z.flattenError(checked.error).fieldErrors,
      });
    }
    const totals = invoiceTotals(lines, taxRate)!;

    const artifact: InvoiceDraftArtifact = {
      kind: 'invoice_draft',
      customer,
      issueDate: checked.data.issueDate,
      dueDate: checked.data.dueDate,
      taxRate,
      currency: ctx.tenant.currency,
      fromDetails: checked.data.fromDetails,
      notes: checked.data.notes,
      lines,
      ...totals,
      warnings,
    };
    return {
      kind: 'artifact',
      artifact,
      reply: `Here is a draft invoice for ${customer.name}, ${formatMoney(totals.total, ctx.tenant.currency)} due ${artifact.dueDate}. Check it, then approve to save it as a draft. Nothing is sent to the customer.`,
      audit: { contactId: customer.contactId, lines: lines.length },
    };
  },
};
