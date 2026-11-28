import 'server-only';

import { z } from 'zod';

import { AppError } from '@/lib/errors';
import { getMyName } from '@/modules/members/queries';
import { suggestAddresses } from '@/modules/social/compose-service';
import { emailDocDraftSchema, type EmailDoc } from '@/modules/social/email-doc';
import {
  getConversation,
  listEmailThreadsForAssistant,
  type ThreadMessage,
} from '@/modules/social/queries';
import { audit } from '@/server/audit';
import { aiService } from '@/server/ai';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { enforceLimits } from './agent';
import type {
  MeroAIAskThreadInput,
  MeroAIDraftReplyInput,
  MeroAIRewriteEmailInput,
  MeroAIWriteEmailInput,
} from './schemas';
import { DATA_RULE, dataBlock, truncate } from './tools/shared';

/*
 * MeroAI in Email (ADR-092). MeroAI writes and explains; people send and save.
 *
 * - Writing (a new email, a reply, a rewrite) returns a document the editor shows, never sent.
 *   The model answers with paragraphs and lists only; the email document is built here, so it
 *   can never carry a link, a picture or markup the person did not put there.
 * - Summaries and answers are words on the screen. Turning one into a private note or a task is
 *   the person's own click, through those modules' services.
 * - Email text is written by outsiders. It reaches the model only inside fenced data blocks,
 *   with the rule to treat it as data, so a prompt hidden in an email can at worst produce a
 *   draft or a summary the person reads. Private notes and email addresses are never sent.
 * - Every request counts against MeroAI's limits and writes an `ai_assist` audit row with ids
 *   and counts only.
 */

const TONE_WORDS: Record<MeroAIWriteEmailInput['tone'], string> = {
  friendly: 'warm and friendly, but still businesslike',
  professional: 'clear and professional',
  brief: 'as short as possible: a few direct sentences',
  formal: 'formal and polite',
};

/** What the model writes: paragraphs and lists of plain text, nothing else. */
const blocksSchema = z
  .array(
    z.object({
      kind: z.enum(['paragraph', 'bullets', 'numbered']),
      text: z.string().max(4000).nullish(),
      items: z.array(z.string().max(1000)).max(30).nullish(),
    }),
  )
  .min(1)
  .max(40);

const blocksJsonSchema = {
  type: 'array',
  description: 'The email body, in order. Use lists only where the content is a list.',
  items: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['paragraph', 'bullets', 'numbered'] },
      text: { type: ['string', 'null'], description: 'For a paragraph: its plain text.' },
      items: {
        type: ['array', 'null'],
        items: { type: 'string' },
        description: 'For a list: each item as plain text.',
      },
    },
    required: ['kind'],
  },
};

/** The model's paragraphs and lists as an email document, checked like any document. */
export function blocksToEmailDoc(blocks: z.output<typeof blocksSchema>): EmailDoc {
  const doc: EmailDoc = [];
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      const text = (block.text ?? '').trim();
      if (text) doc.push({ type: 'paragraph', content: [{ text }] });
    } else {
      const items = (block.items ?? []).map((item) => item.trim()).filter(Boolean);
      if (items.length > 0) {
        doc.push({
          type: 'list',
          ordered: block.kind === 'numbered',
          items: items.map((item) => [{ text: item }]),
        });
      }
    }
  }
  const checked = emailDocDraftSchema.safeParse(doc);
  if (!checked.success || doc.length === 0) {
    throw new AppError(
      'INTERNAL',
      'MeroAI gave an answer that could not be used. Please try again.',
    );
  }
  return checked.data;
}

function assertReady(ctx: TenantContext, write: boolean) {
  requirePermission(ctx, 'ai.use');
  requirePermission(ctx, 'social.view');
  if (write) requirePermission(ctx, 'social.reply');
  if (!aiService.isConfigured()) {
    throw new AppError(
      'INTERNAL',
      'MeroAI is not set up yet. Ask the platform owner to add a Gemini API key.',
    );
  }
}

async function record(
  ctx: TenantContext,
  action: string,
  details: Record<string, unknown>,
  tier: 'fast' | 'reasoning',
) {
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_assist',
      entityType: 'ai_assistant',
      entityId: null,
      // Ids and counts only: never what an email or a request says.
      context: { surface: 'email', action, model: aiService.modelFor(tier), ...details },
    }),
  );
}

/** Email addresses in what is sent to the model are blanked: it never needs them to help. */
const ADDRESS = /[^\s<>()"',;:]+@[^\s<>()"',;:]+\.[a-z]{2,}/gi;
export const withoutAddresses = (text: string | null) =>
  text === null ? null : text.replace(ADDRESS, '[email address]');

const MAX_THREAD_CHARS = 14_000;

/**
 * An email thread for the model: the customer's and the business's emails in order, the newest
 * kept when it is long. Names and dates only: no email addresses, and never a private note.
 */
async function threadForModel(ctx: TenantContext, conversationId: string, take = 20) {
  const thread = await getConversation(ctx, conversationId);
  if (!thread || thread.platform !== 'email') {
    throw new AppError('NOT_FOUND', 'That email was not found.');
  }
  const customer =
    withoutAddresses(thread.contactName ?? thread.conversation.participantName) ?? 'The customer';
  const emails = thread.messages
    .filter((message: ThreadMessage) => message.direction !== 'note')
    .slice(-take)
    .map((message: ThreadMessage) => ({
      from:
        message.direction === 'inbound'
          ? `${customer} (customer)`
          : `${message.sentByName ?? thread.accountName} (${thread.accountName})`,
      sent: message.sentAt.toISOString().slice(0, 16).replace('T', ' '),
      text: withoutAddresses(truncate(message.body, 4000)) ?? '(no text)',
      files: message.attachments.filter((file) => !file.inline).length,
    }));
  // The newest emails matter most: drop the oldest until the thread fits.
  while (emails.length > 1 && JSON.stringify(emails).length > MAX_THREAD_CHARS) emails.shift();
  return {
    thread,
    customer,
    block: dataBlock('email_thread', {
      subject: withoutAddresses(thread.conversation.subject),
      customer,
      business: thread.accountName,
      emails,
    }),
    count: emails.length,
  };
}

const today = (ctx: TenantContext) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ctx.tenant.timezone }).format(new Date());

/* ----------------------------------------------------------------------------- writing */

const writeSchema = z.object({
  subject: z.string().trim().max(200).nullable(),
  blocks: blocksSchema,
});

/** A new email from a description (Compose): a subject and a body for the editor. */
export async function writeEmailWithMeroAI(
  ctx: TenantContext,
  input: MeroAIWriteEmailInput,
): Promise<{ subject: string | null; doc: EmailDoc }> {
  assertReady(ctx, true);
  await enforceLimits(ctx);
  const sender = await getMyName(ctx);
  // Names for the To addresses, only from contacts the person may already see.
  const names: string[] = [];
  for (const address of input.to.slice(0, 5)) {
    const match = (await suggestAddresses(ctx, address)).find((item) => item.email === address);
    if (match?.name) names.push(match.name);
  }
  const result = await aiService.generateJson('fast', {
    systemInstruction: [
      `You write emails for ${ctx.tenant.name}. The writer is ${sender ?? 'a member of staff'}. Today is ${today(ctx)}.`,
      `Write in a tone that is ${TONE_WORDS[input.tone]}. Use plain words, short paragraphs, and Australian English unless the request is in another language (then write in that language).`,
      'Say only what the request says or clearly implies. Never invent prices, dates, names, links, phone numbers or promises; where a needed detail is missing, write a short placeholder in square brackets, like [date].',
      input.signed
        ? 'End with a short closing line such as "Kind regards," and no name: a signature follows.'
        : `End with a short closing line and the writer's first name.`,
      'Give a short, specific subject line.',
      DATA_RULE,
    ].join('\n'),
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              names.length > 0 ? dataBlock('recipients', names) : '',
              dataBlock('request', input.instruction),
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      },
    ],
    jsonSchema: {
      type: 'object',
      properties: {
        subject: { type: ['string', 'null'] },
        blocks: blocksJsonSchema,
      },
      required: ['subject', 'blocks'],
    },
    schema: writeSchema,
  });
  const doc = blocksToEmailDoc(result.blocks);
  await record(ctx, 'write', { tone: input.tone, blocks: doc.length }, 'fast');
  return { subject: result.subject, doc };
}

const REWRITE_TASK: Record<MeroAIRewriteEmailInput['kind'], string> = {
  improve:
    'Improve the email: clearer, better organised and more natural, keeping its meaning and length about the same.',
  shorter: 'Make the email noticeably shorter, keeping every fact, request and date.',
  friendlier: 'Make the email warmer and friendlier, keeping every fact, request and date.',
  formal: 'Make the email more formal and polite, keeping every fact, request and date.',
  fix: 'Correct spelling, grammar and punctuation only. Change nothing else.',
  translate: 'Translate the email.',
};

/** What has been written, rewritten (Compose or the reply box). Formatting is not kept. */
export async function rewriteEmailWithMeroAI(
  ctx: TenantContext,
  input: MeroAIRewriteEmailInput,
): Promise<{ doc: EmailDoc }> {
  assertReady(ctx, true);
  if (input.kind === 'translate' && !input.language) {
    throw new AppError('VALIDATION', 'Choose a language to translate into.');
  }
  await enforceLimits(ctx);
  const result = await aiService.generateJson('fast', {
    systemInstruction: [
      `You edit emails for ${ctx.tenant.name}.`,
      REWRITE_TASK[input.kind],
      input.kind === 'translate'
        ? `Write it in ${input.language}. Keep names, amounts and dates exactly as they are.`
        : 'Write in the same language as the email.',
      'Never add facts, prices, dates, links or promises that are not in the email. Keep square-bracket placeholders as they are.',
      DATA_RULE,
    ].join('\n'),
    contents: [{ role: 'user', parts: [{ text: dataBlock('email', input.text) }] }],
    jsonSchema: {
      type: 'object',
      properties: { blocks: blocksJsonSchema },
      required: ['blocks'],
    },
    schema: z.object({ blocks: blocksSchema }),
  });
  const doc = blocksToEmailDoc(result.blocks);
  await record(ctx, 'rewrite', { kind: input.kind, blocks: doc.length }, 'fast');
  return { doc };
}

const INTENT_TASK: Record<MeroAIDraftReplyInput['intent'], string> = {
  reply: 'Answer the customer’s latest email: respond to each thing they asked or said.',
  accept: 'Say yes to what the customer asked for, and confirm the details they gave.',
  decline:
    'Politely say no to what the customer asked for, briefly, and offer an alternative only if the instructions give one.',
  more_info:
    'Ask the customer for the details still needed to help them, as a short list if there are several.',
  thanks: 'Thank the customer for their email, briefly and warmly.',
};

/** A reply on an email thread, for the reply box. */
export async function draftReplyWithMeroAI(
  ctx: TenantContext,
  input: MeroAIDraftReplyInput,
): Promise<{ doc: EmailDoc }> {
  assertReady(ctx, true);
  await enforceLimits(ctx);
  const [{ block, count, customer }, sender] = await Promise.all([
    threadForModel(ctx, input.conversationId, 12),
    getMyName(ctx),
  ]);
  const result = await aiService.generateJson('fast', {
    systemInstruction: [
      `You write email replies for ${ctx.tenant.name}. The writer is ${sender ?? 'a member of staff'}. Today is ${today(ctx)}.`,
      INTENT_TASK[input.intent],
      `Write to ${customer} in a tone that is ${TONE_WORDS[input.tone]}, in the language of their latest email.`,
      'Use only facts from the thread and the writer’s instructions. Never invent prices, availability, dates, links or promises; where one is needed and not given, write a short placeholder in square brackets, like [time].',
      'Do not repeat the earlier emails or quote them. Do not write a subject line.',
      input.signed
        ? 'End with a short closing line such as "Kind regards," and no name: a signature follows.'
        : `End with a short closing line and the writer's first name.`,
      DATA_RULE,
    ].join('\n'),
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              block,
              input.instruction ? dataBlock('writer_instructions', input.instruction) : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      },
    ],
    jsonSchema: {
      type: 'object',
      properties: { blocks: blocksJsonSchema },
      required: ['blocks'],
    },
    schema: z.object({ blocks: blocksSchema }),
  });
  const doc = blocksToEmailDoc(result.blocks);
  await record(
    ctx,
    'reply',
    { conversationId: input.conversationId, intent: input.intent, emails: count },
    'fast',
  );
  return { doc };
}

/* ------------------------------------------------------------------------ understanding */

const summarySchema = z.object({
  summary: z.string().trim().min(1).max(800),
  keyPoints: z.array(z.string().trim().max(300)).max(6),
  customerAsks: z.array(z.string().trim().max(300)).max(6),
  dates: z
    .array(z.object({ what: z.string().trim().max(200), when: z.string().trim().max(80) }))
    .max(6),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'urgent']),
  nextStep: z.string().trim().max(400).nullable(),
  followUps: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(150),
        dueDate: z.iso.date().nullable(),
      }),
    )
    .max(4),
});
export type EmailSummary = z.output<typeof summarySchema>;

/** What a thread is about, what the customer wants, and what to do next. */
export async function summariseThreadWithMeroAI(
  ctx: TenantContext,
  conversationId: string,
): Promise<EmailSummary> {
  assertReady(ctx, false);
  await enforceLimits(ctx);
  const { block, count } = await threadForModel(ctx, conversationId);
  const summary = await aiService.generateJson('reasoning', {
    systemInstruction: [
      `You summarise email threads for staff at ${ctx.tenant.name}. Today is ${today(ctx)}.`,
      'Be accurate and brief. Use only what the emails say; never guess. Write in English.',
      'summary: two or three sentences on what the thread is about and where it stands now.',
      'keyPoints: the important facts. customerAsks: what the customer is asking the business to do, each one specific. dates: dates, times and deadlines mentioned, with what they are for.',
      'sentiment: urgent when the customer needs something soon or is escalating; negative when they are unhappy; otherwise positive or neutral.',
      'nextStep: the single most useful thing staff should do now, or null when nothing is needed. followUps: up to four tasks staff could create, with a due date (YYYY-MM-DD) only when the emails give one.',
      DATA_RULE,
    ].join('\n'),
    contents: [{ role: 'user', parts: [{ text: block }] }],
    jsonSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        keyPoints: { type: 'array', items: { type: 'string' } },
        customerAsks: { type: 'array', items: { type: 'string' } },
        dates: {
          type: 'array',
          items: {
            type: 'object',
            properties: { what: { type: 'string' }, when: { type: 'string' } },
            required: ['what', 'when'],
          },
        },
        sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'urgent'] },
        nextStep: { type: ['string', 'null'] },
        followUps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, dueDate: { type: ['string', 'null'] } },
            required: ['title', 'dueDate'],
          },
        },
      },
      required: [
        'summary',
        'keyPoints',
        'customerAsks',
        'dates',
        'sentiment',
        'nextStep',
        'followUps',
      ],
    },
    schema: summarySchema,
    thinking: 'low',
  });
  await record(ctx, 'summarise', { conversationId, emails: count }, 'reasoning');
  return summary;
}

const answerSchema = z.object({
  answer: z.string().trim().min(1).max(2000),
  found: z.boolean(),
});

/** A question about one thread, answered only from its emails. */
export async function askThreadWithMeroAI(
  ctx: TenantContext,
  input: MeroAIAskThreadInput,
): Promise<{ answer: string; found: boolean }> {
  assertReady(ctx, false);
  await enforceLimits(ctx);
  const { block, count } = await threadForModel(ctx, input.conversationId);
  const result = await aiService.generateJson('reasoning', {
    systemInstruction: [
      `You answer questions from staff at ${ctx.tenant.name} about one email thread. Today is ${today(ctx)}.`,
      'Answer only from the emails in the thread. If they do not contain the answer, say so plainly and set found to false; never guess or use outside knowledge about the customer.',
      'Be brief and specific; quote a short phrase from an email when it helps. Answer in the language of the question.',
      DATA_RULE,
    ].join('\n'),
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              block,
              input.history.length > 0 ? dataBlock('earlier_questions', input.history) : '',
              dataBlock('question', input.question),
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      },
    ],
    jsonSchema: {
      type: 'object',
      properties: { answer: { type: 'string' }, found: { type: 'boolean' } },
      required: ['answer', 'found'],
    },
    schema: answerSchema,
    thinking: 'low',
  });
  await record(
    ctx,
    'ask_thread',
    { conversationId: input.conversationId, emails: count, found: result.found },
    'reasoning',
  );
  return result;
}

const inboxAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(3000),
  threads: z.array(z.string().regex(/^T\d{1,3}$/)).max(20),
});

export type InboxAnswer = {
  answer: string;
  /** The threads the answer is about, in the order named; links are built here, not by the model. */
  threads: { ref: string; id: string; name: string; subject: string | null }[];
};

/**
 * A question about the inbox ("what needs a reply today?"), answered from the person's most recent
 * email threads. Threads go to the model under short refs (T1, T2); the answer names them by ref,
 * and links are built here from the thread itself. A ref the model made up is dropped.
 */
export async function askInboxWithMeroAI(
  ctx: TenantContext,
  question: string,
): Promise<InboxAnswer> {
  assertReady(ctx, false);
  await enforceLimits(ctx);
  const threads = await listEmailThreadsForAssistant(ctx, 40);
  if (threads.length === 0) {
    return { answer: 'There are no email threads to look at yet.', threads: [] };
  }
  const refs = new Map(threads.map((thread, index) => [`T${index + 1}`, thread]));
  const listed = threads.map((thread, index) => ({
    ref: `T${index + 1}`,
    customer: withoutAddresses(thread.name),
    subject: withoutAddresses(thread.subject),
    status: thread.status,
    unread: thread.unread,
    lastActivity: thread.lastMessageAt?.toISOString().slice(0, 16).replace('T', ' ') ?? null,
    waitingOnBusiness: thread.lastFrom === 'inbound',
    assignedTo: thread.assignee,
    customerLastWrote: withoutAddresses(thread.lastCustomerText),
  }));
  const result = await aiService.generateJson('reasoning', {
    systemInstruction: [
      `You answer questions from staff at ${ctx.tenant.name} about their email inbox. Today is ${today(ctx)}; times are UTC.`,
      'You see the most recent threads only. Answer only from them; if they do not answer the question, say so. Never guess.',
      'Name threads by their ref in square brackets, like [T3], and list every ref you mention in threads, most important first. "waitingOnBusiness" means the customer wrote last.',
      'Be brief: a sentence or two, then a short list when there are several threads. Answer in the language of the question.',
      DATA_RULE,
    ].join('\n'),
    contents: [
      {
        role: 'user',
        parts: [{ text: [dataBlock('inbox', listed), dataBlock('question', question)].join('\n') }],
      },
    ],
    jsonSchema: {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        threads: { type: 'array', items: { type: 'string' } },
      },
      required: ['answer', 'threads'],
    },
    schema: inboxAnswerSchema,
    thinking: 'low',
  });
  const named = [...new Set(result.threads)].flatMap((ref) => {
    const thread = refs.get(ref);
    return thread ? [{ ref, id: thread.id, name: thread.name, subject: thread.subject }] : [];
  });
  // A ref in the words that is not a real thread is shown as plain text, never as a link.
  await record(
    ctx,
    'ask_inbox',
    { threadsSeen: threads.length, threadsNamed: named.length },
    'reasoning',
  );
  return { answer: result.answer, threads: named };
}

/** Whether MeroAI may be offered in Email to this person. */
export function meroAIEmailAvailable(ctx: TenantContext): boolean {
  return (
    aiService.isConfigured() &&
    ctx.tenant.features.includes('ai_assistant') &&
    hasPermission(ctx, 'ai.use') &&
    hasPermission(ctx, 'social.view')
  );
}
