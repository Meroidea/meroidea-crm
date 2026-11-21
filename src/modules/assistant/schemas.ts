import type { ModelMessage } from 'ai';
import { z } from 'zod';

/** Bounds on what one chat request may carry; the history is resent by the browser each turn. */
export const ASSISTANT_LIMITS = {
  maxBodyBytes: 64 * 1024,
  maxMessages: 20,
  maxTextChars: 4_000,
} as const;

/**
 * The shape the AI SDK's chat client posts (UI messages with parts). Parts other than text are
 * accepted so a normal client never fails validation, but they are dropped in
 * toModelMessages(): see there.
 */
const partSchema = z.looseObject({ type: z.string().max(64) });

const messageSchema = z.object({
  id: z.string().max(100).optional(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(partSchema).max(50),
});

export const assistantChatSchema = z.object({
  messages: z.array(messageSchema).min(1).max(ASSISTANT_LIMITS.maxMessages),
});

export type AssistantChatInput = z.infer<typeof assistantChatSchema>;

const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(ASSISTANT_LIMITS.maxTextChars),
});

const uuid = z.uuid();

/**
 * Proposal ids the browser says appear in the conversation. Untrusted: they are only ever used to
 * look up the person's own proposals, under RLS, so a made-up id finds nothing.
 */
export function proposalIdsIn(input: AssistantChatInput): string[] {
  const ids = new Set<string>();
  for (const message of input.messages) {
    if (message.role !== 'assistant') continue;
    for (const part of message.parts) {
      if (!part.type.startsWith('tool-propose_')) continue;
      const id = (part as { output?: { proposal?: { id?: unknown } } }).output?.proposal?.id;
      if (uuid.safeParse(id).success) ids.add(id as string);
    }
  }
  return [...ids].slice(0, 50);
}

/** What the server knows about a proposal, read from the database, for the model to see. */
export type KnownProposal = { id: string; summary: string; status: string; error: string | null };

/**
 * Turns the posted history into model messages, keeping only plain text.
 *
 * The browser sends the whole conversation back every turn, so anything in it is
 * client-controlled. Earlier tool calls and tool results are dropped on purpose: a forged tool
 * result ("pipeline value: 9,999,999", or another business's figures) would otherwise reach the
 * model looking like data the server fetched. Without them, the model calls the tools again,
 * under this request's own session and scope. `system` is rejected by the schema for the same
 * reason: instructions come only from the server.
 *
 * Proposals are the one exception, and come from the server, not the browser: for each proposal
 * id found in an assistant message, the server's own record of it (`known`, looked up under RLS)
 * is added to that message, so the model can revise it and knows whether it was approved.
 */
export function toModelMessages(
  input: AssistantChatInput,
  known: ReadonlyMap<string, KnownProposal> = new Map(),
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const message of input.messages) {
    const pieces = message.parts.flatMap((part) => {
      const text = textPartSchema.safeParse(part);
      if (text.success) return [text.data.text];
      if (message.role !== 'assistant' || !part.type.startsWith('tool-propose_')) return [];
      const id = (part as { output?: { proposal?: { id?: unknown } } }).output?.proposal?.id;
      const proposal = typeof id === 'string' ? known.get(id) : undefined;
      if (!proposal) return [];
      return [
        `[Proposal ${proposal.id}: ${proposal.summary}. Status: ${proposal.status}` +
          `${proposal.error ? `. Last attempt refused: ${proposal.error}` : ''}]`,
      ];
    });
    const text = pieces.join('\n').trim();
    if (text) messages.push({ role: message.role, content: text });
  }
  return messages;
}
