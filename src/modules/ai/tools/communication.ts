import 'server-only';

import { z } from 'zod';

import { getTimeline } from '@/modules/activities/queries';
import { listOutstandingInvoices } from '@/modules/invoices/queries';
import { invoiceNumber } from '@/modules/invoices/types';
import { getMyName } from '@/modules/members/queries';
import { aiService } from '@/server/ai';
import { hasPermission } from '@/server/context';

import type { CommunicationDraftArtifact } from '../types';
import {
  DATA_RULE,
  dataBlock,
  feedback,
  resolveContact,
  truncate,
  type ToolDefinition,
} from './shared';

const CHANNELS = ['email', 'sms', 'note'] as const;

const args = z.object({
  contactId: z.uuid().optional(),
  contactName: z.string().trim().min(1).max(160).optional(),
  channel: z.enum(CHANNELS),
  intent: z.string().trim().min(1).max(200),
  tone: z.string().trim().max(60).optional(),
  extraInstructions: z.string().trim().max(500).optional(),
});

type Args = z.output<typeof args>;

const draftSchema = z.object({
  subject: z.string().trim().max(200).nullable(),
  body: z.string().trim().min(1).max(5000),
});

const draftJsonSchema = {
  type: 'object',
  properties: {
    subject: {
      type: ['string', 'null'],
      description: 'Email subject line; null for sms and note.',
    },
    body: { type: 'string' },
  },
  required: ['subject', 'body'],
};

const CHANNEL_RULES: Record<(typeof CHANNELS)[number], string> = {
  email:
    'Write an email: a short subject line and a body with a greeting and a sign-off from the sender.',
  sms: 'Write a text message: no subject (null), at most 320 characters, no sign-off beyond the sender’s first name.',
  note: 'Write an internal note for colleagues about this person: no subject (null), no greeting, factual and brief.',
};

/**
 * Drafts an email, text message or internal note, grounded in the contact's recent history. On
 * the fast model: drafting is short and frequent. The draft is shown for editing; an email or text
 * is sent by the person from their own app, and only a note is saved here, on approval.
 */
export const draftCommunicationTool: ToolDefinition<Args> = {
  name: 'draft_communication',
  description:
    'Draft an email, SMS or internal note to or about one contact, grounded in their recent activity. Returns an editable draft; nothing is sent or saved. Use contactId when the user is viewing a contact; otherwise contactName.',
  parameters: {
    type: 'object',
    properties: {
      contactId: { type: 'string' },
      contactName: { type: 'string' },
      channel: { type: 'string', enum: [...CHANNELS] },
      intent: {
        type: 'string',
        description: 'What the message is for, e.g. follow-up, proposal reminder, overdue invoice.',
      },
      tone: {
        type: 'string',
        description: 'e.g. friendly, formal, firm. Default friendly and professional.',
      },
      extraInstructions: { type: 'string', description: 'Anything else the user asked for.' },
    },
    required: ['channel', 'intent'],
  },
  args,
  available: ({ ctx }) => hasPermission(ctx, 'contacts.view'),

  async run(input, { ctx, today }) {
    if (!input.contactId && !input.contactName)
      return feedback('Ask the user who the message is for.');
    const match = await resolveContact(ctx, {
      contactId: input.contactId,
      contactName: input.contactName,
    });
    if (match.kind === 'ambiguous') {
      return feedback('Several contacts match that name. Ask the user which one they mean.', {
        matches: match.options,
      });
    }
    if (match.kind === 'none') return feedback('No matching contact is visible to the user.');
    const contact = match.contact;

    // Only what a draft needs: the history's words, never contact details such as the date of
    // birth, email address or phone number (data minimisation, ADR-074).
    const [timeline, sender, owed] = await Promise.all([
      getTimeline(ctx, { contactId: contact.id }, 12),
      getMyName(ctx),
      hasPermission(ctx, 'invoices.manage') ? listOutstandingInvoices(ctx) : Promise.resolve([]),
    ]);
    const history = timeline.map((item) => ({
      when: item.occurredAt.toISOString().slice(0, 10),
      type: item.type,
      direction: item.direction,
      subject: truncate(item.subject, 200),
      text: truncate(item.body, 600),
    }));
    // Invoices carry the customer's name rather than a link to the contact, so match on the name.
    const invoices = owed
      .filter(
        (invoice) =>
          invoice.customerName.trim().toLowerCase() === contact.fullName.trim().toLowerCase(),
      )
      .slice(0, 10)
      .map((invoice) => ({
        reference: invoiceNumber(invoice.number),
        dueDate: invoice.dueDate,
        balance: `${invoice.balance} ${ctx.tenant.currency}`,
      }));

    const draft = await aiService.generateJson('fast', {
      systemInstruction: [
        `You draft messages for ${sender} at ${ctx.tenant.name}. Today is ${today}.`,
        CHANNEL_RULES[input.channel],
        `Tone: ${input.tone ?? 'friendly and professional'}.`,
        'Use only facts from the data provided. Never invent amounts, dates, prices or promises; where a fact is missing, leave a placeholder in square brackets such as [date].',
        'Write in plain text without markdown.',
        DATA_RULE,
      ].join('\n'),
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                `Purpose: ${input.intent}`,
                input.extraInstructions ? `Also: ${input.extraInstructions}` : '',
                dataBlock('contact', {
                  name: contact.fullName,
                  firstName: contact.firstName,
                  status: contact.status,
                }),
                dataBlock('recent_activity', history),
                invoices.length > 0 ? dataBlock('unpaid_invoices', invoices) : '',
              ]
                .filter(Boolean)
                .join('\n\n'),
            },
          ],
        },
      ],
      jsonSchema: draftJsonSchema,
      schema: draftSchema,
    });

    const artifact: CommunicationDraftArtifact = {
      kind: 'communication_draft',
      contactId: contact.id,
      contactName: contact.fullName,
      channel: input.channel,
      intent: input.intent,
      subject: input.channel === 'email' ? (draft.subject ?? '') : null,
      body: draft.body,
      recipient: { email: contact.email, phone: contact.phone },
    };
    const what =
      input.channel === 'email' ? 'email' : input.channel === 'sms' ? 'text message' : 'note';
    return {
      kind: 'artifact',
      artifact,
      reply:
        input.channel === 'note'
          ? `Here is a draft note about ${contact.fullName}. Edit it, then approve to save it on their timeline.`
          : `Here is a draft ${what} to ${contact.fullName}. Edit it, then send it from your own ${input.channel === 'email' ? 'email' : 'messages'} app; nothing is sent from here.`,
      audit: {
        contactId: contact.id,
        channel: input.channel,
        historyItems: history.length,
        draftModel: aiService.modelFor('fast'),
      },
    };
  },
};
