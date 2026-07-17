import { describe, it, expect, vi } from 'vitest';
import { chatCompleteEscalating, escalateBudget } from './length-escalation';
import type { ChatCompleteResult, LLMProvider } from './provider';
import type { Env } from '../index';

const env = {} as Env;
const messages = [{ role: 'user' as const, content: 'hi' }];

function mockProvider(results: ChatCompleteResult[]): { provider: LLMProvider; calls: Array<{ maxTokens?: number; options?: unknown }> } {
  const calls: Array<{ maxTokens?: number; options?: unknown }> = [];
  let i = 0;
  const provider: LLMProvider = {
    chat: vi.fn(),
    chatComplete: async (_m, _e, _c, maxTokens, options) => {
      calls.push({ maxTokens, options });
      return results[Math.min(i++, results.length - 1)];
    },
  };
  return { provider, calls };
}

const ok: ChatCompleteResult = { text: '{"a":1}', usage: { input_tokens: 100, output_tokens: 50 }, finishReason: 'stop' };
const truncated: ChatCompleteResult = { text: '{"a"', usage: { input_tokens: 100, output_tokens: 4000 }, finishReason: 'length' };

describe('escalateBudget', () => {
  it('doubles up to the ceiling', () => {
    expect(escalateBudget(4000, 8000)).toBe(8000);
    expect(escalateBudget(3000, 8000)).toBe(6000);
    expect(escalateBudget(8000, 8000)).toBe(8000);
  });
});

describe('chatCompleteEscalating', () => {
  it('returns the first result when the model stops naturally', async () => {
    const { provider, calls } = mockProvider([ok]);
    const res = await chatCompleteEscalating(provider, messages, env, undefined, {
      startTokens: 4000, ceilingTokens: 8000, label: 'test',
    });
    expect(res.text).toBe('{"a":1}');
    expect(calls).toHaveLength(1);
    expect(calls[0].maxTokens).toBe(4000);
  });

  it('retries with a doubled budget on finish_reason=length and sums usage', async () => {
    const { provider, calls } = mockProvider([truncated, ok]);
    const res = await chatCompleteEscalating(provider, messages, env, undefined, {
      startTokens: 4000, ceilingTokens: 8000, label: 'test',
    });
    expect(calls.map(c => c.maxTokens)).toEqual([4000, 8000]);
    expect(res.text).toBe('{"a":1}');
    expect(res.usage).toEqual({ input_tokens: 200, output_tokens: 4050 });
  });

  it('stops escalating once the ceiling budget also truncates', async () => {
    const { provider, calls } = mockProvider([truncated, truncated, truncated]);
    const res = await chatCompleteEscalating(provider, messages, env, undefined, {
      startTokens: 4000, ceilingTokens: 8000, label: 'test',
    });
    expect(calls.map(c => c.maxTokens)).toEqual([4000, 8000]);
    expect(res.finishReason).toBe('length');
  });

  it('passes responseFormat through to the provider', async () => {
    const { provider, calls } = mockProvider([ok]);
    await chatCompleteEscalating(provider, messages, env, undefined, {
      startTokens: 4000, ceilingTokens: 8000, label: 'test', responseFormat: 'json',
    });
    expect(calls[0].options).toEqual({ responseFormat: 'json' });
  });
});
