import { describe, it, expect, vi, afterEach } from 'vitest';
import { geminiAdapter } from './gemini';
import { googleAiModeAdapter } from './google-ai-mode';
import { perplexityAdapter } from './perplexity';
import { countryCodeForLocation } from './country-codes';
import gemini from './__fixtures__/gemini.json';
import aiMode from './__fixtures__/ai_mode.json';
import perplexity from './__fixtures__/perplexity.json';

const kv = new Map<string, string>();
const env = {
  KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } },
  DATAFORSEO_EMAIL: 'x', DATAFORSEO_PASSWORD: 'y',
} as any;

afterEach(() => { kv.clear(); vi.unstubAllGlobals(); });

describe('geminiAdapter', () => {
  it('targets the Gemini scraper with locale', async () => {
    const req = await geminiAdapter.buildRequest(env, 'best crm', { location_code: 2724, language_code: 'es' });
    expect(req.endpoint).toBe('/ai_optimization/gemini/llm_scraper/live/advanced');
    expect(req.body).toEqual([{ keyword: 'best crm', location_code: 2724, language_code: 'es' }]);
  });
  it('parses markdown, cited sources and the model; no retrieved, brands or ads', () => {
    const a = geminiAdapter.parse(gemini);
    expect(a.engine).toBe('gemini');
    expect(a.model).toBe('3.5 Flash-Lite');
    expect(a.answerMarkdown.length).toBeGreaterThan(50);
    // The fixture carries 4 source entries of which 3 URLs are distinct
    // (Gemini repeats a URL with different text fragments); dedupe keeps 3.
    expect(a.cited.length).toBe(3);
    expect(new Set(a.cited.map((s) => s.url)).size).toBe(3);
    expect(a.cited[0]).toMatchObject({ position: 1, domain: expect.not.stringMatching(/^www\./) });
    expect(a.retrieved).toEqual([]);
    expect(a.brands).toEqual([]);
    expect(a.ads).toEqual([]);
  });
});

describe('googleAiModeAdapter', () => {
  it('targets the AI Mode SERP with locale and desktop', async () => {
    const req = await googleAiModeAdapter.buildRequest(env, 'best crm', { location_code: 2840, language_code: 'en' });
    expect(req.endpoint).toBe('/serp/google/ai_mode/live/advanced');
    expect(req.body).toEqual([{ keyword: 'best crm', location_code: 2840, language_code: 'en', device: 'desktop', os: 'windows' }]);
  });
  it('parses the ai_overview markdown, references from the item and its elements, and paid elements as ads', () => {
    const a = googleAiModeAdapter.parse(aiMode);
    expect(a.engine).toBe('google_ai_mode');
    expect(a.model).toBeNull();
    expect(a.answerMarkdown).toContain('CRM');
    expect(a.cited.length).toBeGreaterThanOrEqual(4);
    expect(a.cited[0].domain).toBe('reddit.com');
    expect(a.ads).toEqual([{ domain: 'monday.com', advertiser: 'monday.com', rendered: true }]);
  });
  it('returns no_answer shape when there is no ai_overview item', () => {
    const a = googleAiModeAdapter.parse({ tasks: [{ status_code: 20000, result: [{ items: [{ type: 'organic', url: 'https://x.com' }] }] }] });
    expect(a.answerText).toBe('');
    expect(a.cited).toEqual([]);
  });
});

describe('perplexityAdapter', () => {
  it('resolves the model from the catalog and maps the locale to a country code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status_code: 20000, tasks: [{ status_code: 20000, result: [{ model_name: 'sonar', web_search_supported: true }] }],
    }), { status: 200 })));
    const req = await perplexityAdapter.buildRequest(env, 'best crm', { location_code: 2826, language_code: 'en' });
    expect(req.endpoint).toBe('/ai_optimization/perplexity/llm_responses/live');
    expect(req.body).toEqual([{ user_prompt: 'best crm', model_name: 'sonar', web_search_country_iso_code: 'GB', max_output_tokens: 2048 }]);
  });
  it('parses section text, annotations as cited sources, fan-out and model', () => {
    const a = perplexityAdapter.parse(perplexity);
    expect(a.engine).toBe('perplexity');
    expect(a.model).toBe('sonar');
    expect(a.answerText.length).toBeGreaterThan(50);
    expect(a.cited.length).toBe(4);
    expect(a.cited[0].domain).toBe('forbes.com');
    expect(a.fanOut).toEqual(['small business crm comparison']);
  });
});

describe('countryCodeForLocation', () => {
  it('maps known codes and falls back to US', () => {
    expect(countryCodeForLocation(2826)).toBe('GB');
    expect(countryCodeForLocation(2724)).toBe('ES');
    expect(countryCodeForLocation(1)).toBe('US');
  });
});
