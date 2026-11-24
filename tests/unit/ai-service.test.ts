import { beforeEach, describe, expect, it, vi } from 'vitest';

// The AI service against a stand-in for Google's SDK (ADR-074): which model answers, how hard
// it thinks, and what happens when the reasoning model is overloaded, out of quota or too slow.

const sdk = vi.hoisted(() => ({
  calls: [] as { model: string; config: Record<string, unknown> }[],
  outcomes: [] as (unknown | Error)[],
}));

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  class GoogleGenAI {
    models = {
      generateContent: async (request: { model: string; config: Record<string, unknown> }) => {
        sdk.calls.push({ model: request.model, config: request.config });
        const next = sdk.outcomes.shift();
        if (next instanceof Error) throw next;
        return next ?? { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };
      },
    };
  }
  return { ...actual, GoogleGenAI };
});

const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const timeout = () =>
  Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });

async function service() {
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'test-secret');
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  vi.stubEnv('GEMINI_MODEL_REASONING', 'reasoning-model');
  vi.stubEnv('GEMINI_MODEL_FAST', 'fast-model');
  vi.resetModules();
  return (await import('@/server/ai')).aiService;
}

beforeEach(() => {
  sdk.calls.length = 0;
  sdk.outcomes.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the AI service', () => {
  it('asks the reasoning model to think briefly, within a deadline, and the fast model as is', async () => {
    const ai = await service();
    await ai.generate('reasoning', [], {}, { thinking: 'low' });
    await ai.generate('fast', [], {}, { thinking: 'low' });
    expect(sdk.calls[0]?.model).toBe('reasoning-model');
    expect(sdk.calls[0]?.config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(sdk.calls[0]?.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(sdk.calls[1]?.model).toBe('fast-model');
    expect(sdk.calls[1]?.config.thinkingConfig).toBeUndefined();
  });

  it('lets the fast model answer when the reasoning model took too long, without waiting again', async () => {
    const ai = await service();
    sdk.outcomes.push(apiError(504));
    const result = await ai.generate('reasoning', [], {}, { thinking: 'low' });
    expect(sdk.calls.map((call) => call.model)).toEqual(['reasoning-model', 'fast-model']);
    expect(result).toMatchObject({ model: 'fast-model', fellBack: true });
  });

  it('falls back after our own deadline too', async () => {
    const ai = await service();
    sdk.outcomes.push(timeout());
    const result = await ai.generate('reasoning', [], {});
    expect(result.model).toBe('fast-model');
  });

  it('falls back when the reasoning model is out of quota for the day', async () => {
    const ai = await service();
    sdk.outcomes.push(apiError(429), apiError(429), apiError(429));
    const result = await ai.generate('reasoning', [], {});
    expect(result.model).toBe('fast-model');
  });

  it('keeps a conversation on the model that started it', async () => {
    const ai = await service();
    sdk.outcomes.push(apiError(504));
    await expect(ai.generate('reasoning', [], {}, { model: 'reasoning-model' })).rejects.toThrow(
      'took too long',
    );
    expect(sdk.calls.map((call) => call.model)).toEqual(['reasoning-model']);
  });

  it('does not try another model for a bad key, which would fail there too', async () => {
    const ai = await service();
    sdk.outcomes.push(apiError(403));
    await expect(ai.generate('reasoning', [], {})).rejects.toThrow('not set up correctly');
    expect(sdk.calls).toHaveLength(1);
  });

  it('says plainly when both models are busy', async () => {
    const ai = await service();
    sdk.outcomes.push(timeout(), timeout());
    await expect(ai.generate('reasoning', [], {})).rejects.toThrow('took too long');
    expect(sdk.calls.map((call) => call.model)).toEqual(['reasoning-model', 'fast-model']);
  });
});
