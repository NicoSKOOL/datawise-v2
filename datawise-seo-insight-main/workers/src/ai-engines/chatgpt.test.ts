import { describe, it, expect } from 'vitest';
import { chatgptAdapter } from './chatgpt';
import fixture from './__fixtures__/chatgpt.json';

const env = { KV: {} as any, DATAFORSEO_EMAIL: 'x', DATAFORSEO_PASSWORD: 'y' };

describe('chatgptAdapter.buildRequest', () => {
  it('targets the ChatGPT scraper with locale and forced web search', async () => {
    const req = await chatgptAdapter.buildRequest(env, 'best crm', { location_code: 2826, language_code: 'en' });
    expect(req.endpoint).toBe('/ai_optimization/chat_gpt/llm_scraper/live/advanced');
    expect(req.body).toEqual([{ keyword: 'best crm', location_code: 2826, language_code: 'en', force_web_search: true }]);
  });
});

describe('chatgptAdapter.parse', () => {
  const answer = chatgptAdapter.parse(fixture);

  it('reads the answer markdown and a plain-text version', () => {
    expect(answer.engine).toBe('chatgpt');
    expect(answer.answerMarkdown.length).toBeGreaterThan(50);
    expect(answer.answerText).not.toContain('**');
  });

  it('collects cited sources from the result and its items, deduped and numbered', () => {
    expect(answer.cited.length).toBeGreaterThanOrEqual(4);
    expect(answer.cited[0].position).toBe(1);
    expect(new Set(answer.cited.map((s) => s.url)).size).toBe(answer.cited.length);
    expect(answer.cited.every((s) => s.domain && !s.domain.startsWith('www.'))).toBe(true);
  });

  it('keeps retrieved pages that were not cited', () => {
    expect(answer.retrieved.map((s) => s.domain)).toEqual(['example-retrieved.com']);
  });

  it('reads brand entities with their urls', () => {
    expect(answer.brands).toEqual([
      { name: 'HubSpot', category: 'company', urls: ['https://www.hubspot.com/'] },
      { name: 'Zoho CRM', category: 'product', urls: [] },
    ]);
  });

  it('reads ads with the rendered flag', () => {
    expect(answer.ads).toEqual([{ domain: 'pipedrive.com', advertiser: 'Pipedrive', rendered: true }]);
  });

  it('reads fan-out queries and the model', () => {
    expect(answer.fanOut).toEqual(['best crm for small business 2026', 'cheap crm for startups']);
    expect(answer.model).toBeNull();
  });

  it('tolerates an empty result', () => {
    const empty = chatgptAdapter.parse({ tasks: [{ status_code: 20000, result: [{}] }] });
    expect(empty).toMatchObject({ engine: 'chatgpt', answerText: '', cited: [], retrieved: [], brands: [], ads: [], fanOut: [] });
  });
});
