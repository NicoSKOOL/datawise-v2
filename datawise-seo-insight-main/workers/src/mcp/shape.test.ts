import { describe, it, expect } from 'vitest';
import { stripHtml, compact, toolResult, toolError, CONCISE } from './shape';

describe('stripHtml', () => {
  it('removes tags, entities and control chars', () => {
    expect(stripHtml('<b>Hi</b> &amp; bye')).toBe('Hi & bye');
    expect(stripHtml('a\n\nb')).toBe('a b');
  });
});

describe('compact', () => {
  it('truncates arrays and strings, strips html, drops billing/identity keys', () => {
    const input = {
      cost: 0.02,
      user_id: 'u1',
      request_id: 'r',
      title: '<i>Long</i> ' + 'x'.repeat(500),
      items: Array.from({ length: 50 }, (_, i) => ({ n: i, html: '<p>t</p>' })),
      nested: { deep: { deeper: { cost: 1, ok: true } } },
    };
    const out = compact(input, CONCISE) as any;
    expect(out.cost).toBeUndefined();
    expect(out.user_id).toBeUndefined();
    expect(out.request_id).toBeUndefined();
    expect(out.title.startsWith('Long x')).toBe(true);
    expect(out.title.length).toBeLessThanOrEqual(300);
    expect(out.items).toHaveLength(25);
    expect(out.items[0]).toEqual({ n: 0, html: 't' });
    expect(out.nested.deep.deeper).toEqual({ ok: true });
  });

  it('leaves numbers, booleans and null alone and stops at maxDepth', () => {
    expect(compact({ a: 1, b: false, c: null }, CONCISE)).toEqual({ a: 1, b: false, c: null });
    const deep = { l1: { l2: { l3: { l4: { l5: { l6: { l7: 'x' } } } } } } };
    expect(JSON.stringify(compact(deep, { ...CONCISE, maxDepth: 3 }))).not.toContain('l7');
  });
});

describe('tool results', () => {
  it('toolResult carries text and structuredContent', () => {
    const r = toolResult({ rows: [1] }, 'One row.');
    expect(r.isError).toBeUndefined();
    expect(r.content[0]).toEqual({ type: 'text', text: 'One row.\n\n{"rows":[1]}' });
    expect(r.structuredContent).toEqual({ rows: [1] });
  });
  it('toolError sets isError', () => {
    expect(toolError('nope')).toEqual({ isError: true, content: [{ type: 'text', text: 'nope' }] });
  });
});
