import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleClaudeSearch, handleGeminiSearch, handleChatGPTSearch, handlePerplexitySearch } from './ai';
import { buildEngineRequest } from './ai-tracking';

// Every LLM Responses call must take its model from the live DataForSEO
// catalog. Hardcoded names (claude-3-5-sonnet, gemini-1.5-flash) were retired
// upstream and returned task error 40501 on every call.

const kvStore = new Map<string, string>();
const env = {
  KV: {
    get: async (key: string) => kvStore.get(key) ?? null,
    put: async (key: string, value: string) => { kvStore.set(key, value); },
  },
  DATAFORSEO_EMAIL: 'x',
  DATAFORSEO_PASSWORD: 'y',
} as any;

const catalogs: Record<string, string[]> = {
  claude: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  gemini: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'],
  chat_gpt: ['gpt-5.4-mini', 'gpt-4o', 'gpt-4o-mini'],
  perplexity: ['sonar-reasoning-pro', 'sonar-pro', 'sonar'],
};

function stubDataForSeo() {
  const posted: Array<{ url: string; body: any }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const models = url.match(/ai_optimization\/(\w+)\/llm_responses\/models$/);
    if (models) {
      const result = catalogs[models[1]].map((model_name) => ({ model_name, web_search_supported: true }));
      return new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result }] }), { status: 200 });
    }
    posted.push({ url, body: JSON.parse(String(init?.body))[0] });
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks: [{ status_code: 20000, status_message: 'Ok.', result: [{ items: [{ type: 'message', sections: [{ text: 'ok' }] }] }] }],
    }), { status: 200 });
  }));
  return posted;
}

const req = (body: unknown) => new Request('https://x/api/ai/test', { method: 'POST', body: JSON.stringify(body) });

afterEach(() => {
  kvStore.clear();
  vi.unstubAllGlobals();
});

describe('LLM Responses handlers use catalog models', () => {
  it('Claude search sends a model from the live catalog', async () => {
    const posted = stubDataForSeo();
    const res = await handleClaudeSearch(req({ keyword: 'best crm' }), env);
    expect(res.status).toBe(200);
    expect(posted[0].url).toContain('/ai_optimization/claude/llm_responses/live');
    expect(posted[0].body.model_name).toBe('claude-sonnet-4-6');
    expect(posted[0].body.web_search).toBe(true);
  });

  it('Gemini search sends a model from the live catalog', async () => {
    const posted = stubDataForSeo();
    const res = await handleGeminiSearch(req({ keyword: 'best crm' }), env);
    expect(res.status).toBe(200);
    expect(posted[0].url).toContain('/ai_optimization/gemini/llm_responses/live');
    expect(posted[0].body.model_name).toBe('gemini-3.5-flash');
  });

  it('ChatGPT search sends a model from the live catalog', async () => {
    const posted = stubDataForSeo();
    await handleChatGPTSearch(req({ keyword: 'best crm' }), env);
    expect(posted[0].body.model_name).toBe('gpt-4o');
  });

  it('Perplexity search sends a model from the live catalog', async () => {
    const posted = stubDataForSeo();
    await handlePerplexitySearch(req({ keyword: 'best crm', location_code: 2826 }), env);
    expect(posted[0].body.model_name).toBe('sonar');
    expect(posted[0].body.web_search_country_iso_code).toBe('GB');
  });
});

describe('buildEngineRequest (AI Visibility Tracker)', () => {
  it('chatgpt resolves its model from the catalog', async () => {
    stubDataForSeo();
    const { endpoint, body } = await buildEngineRequest(env, 'chatgpt', 'best crm');
    expect(endpoint).toBe('/ai_optimization/chat_gpt/llm_responses/live');
    expect(body[0]).toMatchObject({ user_prompt: 'best crm', model_name: 'gpt-4o', web_search: true });
  });

  it('perplexity resolves its model from the catalog', async () => {
    stubDataForSeo();
    const { endpoint, body } = await buildEngineRequest(env, 'perplexity', 'best crm');
    expect(endpoint).toBe('/ai_optimization/perplexity/llm_responses/live');
    expect(body[0]).toMatchObject({ user_prompt: 'best crm', model_name: 'sonar' });
  });

  it('google_ai_mode does not need a model', async () => {
    stubDataForSeo();
    const { endpoint, body } = await buildEngineRequest(env, 'google_ai_mode', 'best crm');
    expect(endpoint).toBe('/serp/google/ai_mode/live/advanced');
    expect(body[0]).toMatchObject({ keyword: 'best crm', location_name: 'United States' });
    expect(body[0].model_name).toBeUndefined();
  });
});
