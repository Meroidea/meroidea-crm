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

/**
 * Turns the posted history into model messages, keeping only plain text.
 *
 * The browser sends the whole conversation back every turn, so anything in it is
 * client-controlled. Earlier tool calls and tool results are dropped on purpose: a forged tool
 * result ("pipeline value: 9,999,999", or another business's figures) would otherwise reach the
 * model looking like data the server fetched. Without them, the model calls the tools again,
 * under this request's own session and scope. `system` is rejected by the schema for the same
 * reason: instructions come only from the server.
 */
export function toModelMessages(input: AssistantChatInput): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const message of input.messages) {
    const text = message.parts
      .map((part) => textPartSchema.safeParse(part))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data.text)
      .join('\n')
      .trim();
    if (text) messages.push({ role: message.role, content: text });
  }
  return messages;
}
