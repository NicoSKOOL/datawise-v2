import { describe, it, expect } from 'vitest';
import { buildSeoMetaPrompt, parseSeoMetaResponse } from './seo-meta';

describe('buildSeoMetaPrompt', () => {
  it('includes keyword, limits, and truncated body', () => {
    const { system, user } = buildSeoMetaPrompt({
      topic: 'Winterizing pools',
      targetKeyword: 'winterize a pool',
      businessName: 'PoolPro',
      bodyMd: 'x'.repeat(9000),
    });
    expect(system).toContain('60 characters');
    expect(system).toContain('155 characters');
    expect(user).toContain('winterize a pool');
    expect(user.length).toBeLessThan(8000);
  });
});

describe('parseSeoMetaResponse', () => {
  it('parses plain JSON', () => {
    const r = parseSeoMetaResponse('{"title":"Winterize a Pool in 7 Steps","meta_description":"Learn how to winterize a pool before the first freeze."}');
    expect(r?.title).toBe('Winterize a Pool in 7 Steps');
  });

  it('parses fenced JSON with prose around it', () => {
    const r = parseSeoMetaResponse('Here you go:\n```json\n{"title":"T","meta_description":"D"}\n```\nDone.');
    expect(r).toEqual({ title: 'T', meta_description: 'D' });
  });

  it('hard-caps runaway lengths', () => {
    const r = parseSeoMetaResponse(JSON.stringify({ title: 'a'.repeat(200), meta_description: 'b'.repeat(400) }));
    expect(r!.title.length).toBeLessThanOrEqual(70);
    expect(r!.meta_description.length).toBeLessThanOrEqual(170);
  });

  it('returns null on garbage', () => {
    expect(parseSeoMetaResponse('sorry, cannot help')).toBeNull();
  });
});
