import { describe, expect, it } from 'vitest';
import { ANCHOR_MODEL, getAnchorModel } from './anchor-writer';

const kv = (v: string | null) => ({ KV: { get: async () => v } });

describe('getAnchorModel', () => {
  it('defaults to DeepSeek V4 Pro', async () => {
    expect(ANCHOR_MODEL).toBe('deepseek/deepseek-v4-pro');
    expect(await getAnchorModel(kv(null))).toBe(ANCHOR_MODEL);
  });

  it('uses a well-formed KV override', async () => {
    expect(await getAnchorModel(kv(' anthropic/claude-sonnet-5 '))).toBe('anthropic/claude-sonnet-5');
    expect(await getAnchorModel(kv('~typesafe/jev-latest'))).toBe('~typesafe/jev-latest');
  });

  it('ignores a malformed override', async () => {
    expect(await getAnchorModel(kv('sonnet'))).toBe(ANCHOR_MODEL);
    expect(await getAnchorModel(kv(''))).toBe(ANCHOR_MODEL);
  });
});
