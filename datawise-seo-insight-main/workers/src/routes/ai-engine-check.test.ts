import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleEngineCheck } from './ai-engine-check';
import chatgptFixture from '../ai-engines/__fixtures__/chatgpt.json';
import taskError from '../ai-engines/__fixtures__/chatgpt-task-error.json';

const kv = new Map<string, string>();
const env = { KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } }, DATAFORSEO_EMAIL: 'x', DATAFORSEO_PASSWORD: 'y' } as any;
const post = (body: unknown) => new Request('https://x/api/ai/engine-check', { method: 'POST', body: JSON.stringify(body) });
afterEach(() => { kv.clear(); vi.unstubAllGlobals(); });

describe('POST /api/ai/engine-check', () => {
  it('400 on a bad engine or empty query', async () => {
    expect((await handleEngineCheck(post({ engine: 'claude', query: 'x' }), env)).status).toBe(400);
    expect((await handleEngineCheck(post({ engine: 'chatgpt', query: '' }), env)).status).toBe(400);
  });

  it('returns the normalized answer and a classification for the brand domain', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(chatgptFixture), { status: 200 })));
    // hubspot.com is among the fixture's cited sources: a citation outranks the brand entity.
    const res = await handleEngineCheck(post({ engine: 'chatgpt', query: 'best crm', location_code: 2826, language_code: 'en', brand_domain: 'https://www.hubspot.com/' }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.engine).toBe('chatgpt');
    expect(body.locale).toEqual({ location_code: 2826, language_code: 'en' });
    expect(body.answer.cited.length).toBeGreaterThan(0);
    expect(body.classification.status).toBe('cited');
    expect(body.classification.cited_url).toContain('hubspot.com');
  });

  it('classifies a brand named but not cited as mentioned, using brand terms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(chatgptFixture), { status: 200 })));
    const body = await (await handleEngineCheck(post({ engine: 'chatgpt', query: 'best crm', brand_domain: 'zoho-example.test', brand_terms: ['Zoho CRM'] }), env)).json() as any;
    expect(body.classification.status).toBe('mentioned');
    expect(body.classification.matched_brand).toBe('Zoho CRM');
  });

  it('classification is null without a brand domain', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(chatgptFixture), { status: 200 })));
    const body = await (await handleEngineCheck(post({ engine: 'chatgpt', query: 'best crm' }), env)).json() as any;
    expect(body.classification).toBeNull();
  });

  it('502 with the DataForSEO message on a task error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(taskError), { status: 200 })));
    const res = await handleEngineCheck(post({ engine: 'chatgpt', query: 'best crm' }), env);
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).detail).toMatch(/Timeout/);
  });
});
