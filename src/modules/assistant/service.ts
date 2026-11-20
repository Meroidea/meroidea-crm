import 'server-only';

import { createGoogle } from '@ai-sdk/google';
import { createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream } from 'ai';

import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { serverEnv, type ServerEnv } from '@/server/env';
import { enforceRateLimit } from '@/server/rate-limit';

import { assistantInstructions } from './instructions';
import { toModelMessages, type AssistantChatInput } from './schemas';
import { buildAssistantTools } from './tools';

/** A question usually takes one or two tool calls and an answer; more means the model is looping. */
const MAX_STEPS = 5;
const MAX_OUTPUT_TOKENS = 1_500;

/** Per person, so one tab left looping cannot use up the business's share. */
const PER_USER_HOURLY = 30;
/** Per business, a ceiling on what it can send to the provider (and cost) in a day. */
const PER_TENANT_DAILY = 500;

export type AssistantReadiness =
  | { ready: true; apiKey: string; model: string }
  | { ready: false; reason: 'not_configured' | 'paid_tier_unconfirmed' };

/**
 * Whether the assistant may run here. In production it also needs ASSISTANT_PROVIDER_PAID_TIER,
 * the operator's confirmation that the key's Google Cloud project is billed: on Google's free
 * tier, prompts may be used to improve Google's products and read by its reviewers, and these
 * prompts carry a business's customer names and figures (ADR-063).
 */
export function assistantReadiness(
  env: Pick<
    ServerEnv,
    'NODE_ENV' | 'GOOGLE_GENERATIVE_AI_API_KEY' | 'ASSISTANT_MODEL' | 'ASSISTANT_PROVIDER_PAID_TIER'
  >,
): AssistantReadiness {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) return { ready: false, reason: 'not_configured' };
  if (env.NODE_ENV === 'production' && env.ASSISTANT_PROVIDER_PAID_TIER !== 'true') {
    return { ready: false, reason: 'paid_tier_unconfirmed' };
  }
  return { ready: true, apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY, model: env.ASSISTANT_MODEL };
}

/**
 * Answers one chat turn as a streamed response. The caller has already authenticated the person
 * and checked the workspace is open; this checks the permission again so it is safe on its own.
 */
export async function streamAssistantReply(
  ctx: TenantContext,
  input: AssistantChatInput,
  signal: AbortSignal,
): Promise<Response> {
  requirePermission(ctx, 'assistant.use');

  const readiness = assistantReadiness(serverEnv());
  if (!readiness.ready) {
    throw new AppError('FORBIDDEN', 'The assistant is not set up for this workspace yet.');
  }

  const messages = toModelMessages(input);
  if (messages.at(-1)?.role !== 'user') {
    throw new AppError('VALIDATION', 'Ask a question to get an answer.');
  }

  await enforceRateLimit(
    {
      bucket: `assistant:${ctx.tenantId}`,
      subject: ctx.userId,
      limit: PER_USER_HOURLY,
      windowSeconds: 60 * 60,
    },
    'You have asked a lot of questions in the last hour. Try again a little later.',
  );
  await enforceRateLimit(
    {
      bucket: 'assistant:tenant',
      subject: ctx.tenantId,
      limit: PER_TENANT_DAILY,
      windowSeconds: 24 * 60 * 60,
    },
    'Your business has reached today’s limit for the assistant. It resets tomorrow.',
  );

  const google = createGoogle({ apiKey: readiness.apiKey });
  const result = streamText({
    model: google(readiness.model),
    instructions: assistantInstructions(ctx),
    messages,
    tools: buildAssistantTools(ctx),
    stopWhen: isStepCount(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    abortSignal: signal,
    onError: ({ error }) => {
      // Provider and driver errors can echo prompts or query parameters (personal data).
      console.error('[assistant] failed', error instanceof Error ? error.name : typeof error);
    },
    onEnd: async (event) => {
      // Figures from this business went to the AI provider: record that, like an export, with
      // which tools ran but never the question or the answer (rules/security.md).
      const tools = [
        ...new Set(event.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName))),
      ];
      try {
        await withRls(ctx, (tx) =>
          audit(tx, ctx, {
            action: 'export',
            entityType: 'assistant',
            entityId: null,
            context: { model: readiness.model, tools, steps: event.steps.length },
          }),
        );
      } catch (error) {
        console.error('[assistant] audit failed', error instanceof Error ? error.name : 'unknown');
      }
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendReasoning: false,
      redactToolErrors: true,
      onError: () => 'The assistant could not answer just now. Please try again.',
    }),
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
