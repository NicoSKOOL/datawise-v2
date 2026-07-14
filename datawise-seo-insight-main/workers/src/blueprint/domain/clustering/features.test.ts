import { describe, it, expect } from 'vitest';
import { buildEmbeddingText, embeddingContentHash } from './features';

describe('buildEmbeddingText', () => {
  it('kw_v1 prefers coreKeyword over displayKeyword when present', () => {
    const text = buildEmbeddingText(
      { displayKeyword: 'Drain Cleaning Austin', coreKeyword: 'drain cleaning' },
      { category: 'Plumber' },
      'kw_v1'
    );
    expect(text).toBe('drain cleaning | Plumber');
  });

  it('kw_v1 falls back to displayKeyword when coreKeyword is null', () => {
    const text = buildEmbeddingText(
      { displayKeyword: 'emergency plumber austin', coreKeyword: null },
      { category: 'Plumber' },
      'kw_v1'
    );
    expect(text).toBe('emergency plumber austin | Plumber');
  });

  it('is stable: same inputs always produce the same string', () => {
    const a = buildEmbeddingText({ displayKeyword: 'x', coreKeyword: 'y' }, { category: 'z' }, 'kw_v1');
    const b = buildEmbeddingText({ displayKeyword: 'x', coreKeyword: 'y' }, { category: 'z' }, 'kw_v1');
    expect(a).toBe(b);
  });

  it('throws on an unknown template id instead of silently guessing a shape', () => {
    expect(() =>
      buildEmbeddingText({ displayKeyword: 'x', coreKeyword: null }, { category: 'z' }, 'kw_v99')
    ).toThrow(/unknown context template/);
  });
});

describe('embeddingContentHash', () => {
  it('is deterministic for the same model/template/text', async () => {
    const a = await embeddingContentHash('@cf/baai/bge-m3', 'kw_v1', 'drain cleaning | Plumber');
    const b = await embeddingContentHash('@cf/baai/bge-m3', 'kw_v1', 'drain cleaning | Plumber');
    expect(a).toBe(b);
  });

  it('changes when the model changes', async () => {
    const a = await embeddingContentHash('@cf/baai/bge-m3', 'kw_v1', 'drain cleaning | Plumber');
    const b = await embeddingContentHash('@cf/some-other-model', 'kw_v1', 'drain cleaning | Plumber');
    expect(a).not.toBe(b);
  });

  it('changes when the template changes', async () => {
    const a = await embeddingContentHash('@cf/baai/bge-m3', 'kw_v1', 'drain cleaning | Plumber');
    const b = await embeddingContentHash('@cf/baai/bge-m3', 'kw_v2', 'drain cleaning | Plumber');
    expect(a).not.toBe(b);
  });

  it('changes when the text changes', async () => {
    const a = await embeddingContentHash('@cf/baai/bge-m3', 'kw_v1', 'drain cleaning | Plumber');
    const b = await embeddingContentHash('@cf/baai/bge-m3', 'kw_v1', 'drain repair | Plumber');
    expect(a).not.toBe(b);
  });
});
