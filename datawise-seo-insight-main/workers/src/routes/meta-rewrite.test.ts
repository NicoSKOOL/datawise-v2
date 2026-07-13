import { describe, it, expect } from 'vitest';
import {
  META_REWRITE_MAX_TOKENS,
  META_REWRITE_MAX_TOKENS_CEILING,
  escalateTruncationBudget,
} from './meta-rewrite';

describe('meta-rewrite token budget', () => {
  it('starting budget covers the observed DeepSeek V4 Pro long-thinking burn (1200 tokens of hidden reasoning) with room for the JSON', () => {
    expect(META_REWRITE_MAX_TOKENS).toBeGreaterThanOrEqual(2400);
  });

  it('doubles the budget on truncation', () => {
    expect(escalateTruncationBudget(META_REWRITE_MAX_TOKENS)).toBe(META_REWRITE_MAX_TOKENS * 2);
  });

  it('never escalates past the ceiling', () => {
    expect(escalateTruncationBudget(META_REWRITE_MAX_TOKENS_CEILING)).toBe(META_REWRITE_MAX_TOKENS_CEILING);
    expect(escalateTruncationBudget(META_REWRITE_MAX_TOKENS_CEILING - 1)).toBeLessThanOrEqual(META_REWRITE_MAX_TOKENS_CEILING);
  });
});
