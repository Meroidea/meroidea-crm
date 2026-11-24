import 'server-only';

import {
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from '@google/genai';
import type { z } from 'zod';

import { AppError } from '@/lib/errors';
import { errorStatus, withBackoff } from '@/modules/ai/retry';
import { serverEnv } from '@/server/env';

/**
 * The one way the app talks to a language model (ADR-074): Google Gemini through the official
 * SDK, with the key read here on the server only. Two tiers:
 *
 * - `reasoning` for tool calling, rosters, documents and next steps;
 * - `fast` for drafting replies and other short text.
 *
 * Rate limits (429) and overload (503) are retried with backoff, at most twice; after that, or
 * when Google says the quota is gone for the day, the person gets a plain message instead of an
 * error. Nothing a prompt or a reply says is ever logged: only the status code.
 */

export type ModelTier = 'reasoning' | 'fast';

export function modelFor(tier: ModelTier): string {
  const env = serverEnv();
  return tier === 'reasoning' ? env.GEMINI_MODEL_REASONING : env.GEMINI_MODEL_FAST;
}

export function isAiConfigured(): boolean {
  return Boolean(serverEnv().GEMINI_API_KEY);
}

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  const apiKey = serverEnv().GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      'INTERNAL',
      'The AI assistant is not set up yet. Ask the platform owner to add a Gemini API key.',
    );
  }
  // The SDK's own retries are switched off: ours honour Google's retry delay and give up early.
  client ??= new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: 60_000, retryOptions: { attempts: 1 } },
  });
  return client;
}

/** Turns an SDK failure into something a person can read, without echoing what was sent. */
function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const status = errorStatus(error);
  console.error('[ai] model call failed', { status });
  if (status === 429) {
    return new AppError(
      'RATE_LIMITED',
      'The AI assistant has reached its usage limit for now. Please try again in a few minutes.',
    );
  }
  if (status === 503) {
    return new AppError(
      'RATE_LIMITED',
      'The AI assistant is busy right now. Please try again shortly.',
    );
  }
  if (status === 400 || status === 401 || status === 403) {
    return new AppError(
      'INTERNAL',
      'The AI assistant is not set up correctly. Ask the platform owner to check the Gemini API key.',
    );
  }
  return new AppError('INTERNAL', 'The AI assistant could not answer. Please try again.');
}

async function generate(
  tier: ModelTier,
  contents: Content[],
  config: GenerateContentConfig,
): Promise<GenerateContentResponse> {
  const ai = getClient();
  const model = modelFor(tier);
  try {
    return await withBackoff(() => ai.models.generateContent({ model, contents, config }));
  } catch (error) {
    throw toAppError(error);
  }
}

/** The text of a reply, leaving out the model's thinking and any function calls. */
export function responseText(response: GenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('')
    .trim();
}

/**
 * A reply in a fixed JSON shape. `jsonSchema` tells the model the shape (Gemini's structured
 * output); `schema` then checks what came back, because the model's output is never trusted.
 */
async function generateJson<T>(
  tier: ModelTier,
  request: {
    contents: Content[];
    systemInstruction: string;
    jsonSchema: Record<string, unknown>;
    schema: z.ZodType<T>;
  },
): Promise<T> {
  const response = await generate(tier, request.contents, {
    systemInstruction: request.systemInstruction,
    responseMimeType: 'application/json',
    responseJsonSchema: request.jsonSchema,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText(response));
  } catch {
    throw new AppError(
      'INTERNAL',
      'The AI assistant gave an answer that could not be read. Please try again.',
    );
  }
  const result = request.schema.safeParse(parsed);
  if (!result.success) {
    throw new AppError('INTERNAL', 'The AI assistant gave an incomplete answer. Please try again.');
  }
  return result.data;
}

export const aiService = {
  modelFor,
  isConfigured: isAiConfigured,
  generate,
  generateJson,
  responseText,
};
