import { describe, it, expect, vi, afterEach } from 'vitest';
import { pickModel, resolveModel, PREFERRED_MODELS, type LlmModelInfo, type LlmProvider } from './llm-models';
import snapshotJson from './llm-models.snapshot.json';

const snapshot = snapshotJson as unknown as Record<string, LlmModelInfo[]>;

const catalog = (names: Array<string | [string, boolean]>): LlmModelInfo[] =>
  names.map((n) =>
    typeof n === 'string'
      ? { model_name: n, web_search_supported: true }
      : { model_name: n[0], web_search_supported: n[1] }
  );

describe('pickModel', () => {
  it('picks the first preferred model the catalog still lists', () => {
    const models = catalog(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']);
    expect(pickModel('claude', models)).toBe('claude-sonnet-4-6');
  });

  it('skips a preferred model the provider retired', () => {
    const models = catalog(['claude-haiku-4-5', 'claude-opus-4-8']);
    expect(pickModel('claude', models)).toBe('claude-haiku-4-5');
  });

  it('skips a preferred model that cannot web search', () => {
    const models = catalog([['gemini-3.5-flash', false], 'gemini-2.5-flash']);
    expect(pickModel('gemini', models)).toBe('gemini-2.5-flash');
  });

  it('falls back to the first web-search-capable catalog model when no preferred model is listed', () => {
    const models = catalog([['gemini-9-lite', false], 'gemini-9-flash', 'gemini-9-pro']);
    expect(pickModel('gemini', models)).toBe('gemini-9-flash');
  });

  it('falls back to the top preferred model when the catalog is empty', () => {
    expect(pickModel('chat_gpt', [])).toBe(PREFERRED_MODELS.chat_gpt[0]);
  });
});

describe('resolveModel', () => {
  const kvStore = new Map<string, string>();
  const env = {
    KV: {
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => { kvStore.set(key, value); },
    },
    DATAFORSEO_EMAIL: 'x',
    DATAFORSEO_PASSWORD: 'y',
  } as any;

  const dfsModelsResponse = (models: LlmModelInfo[]) => ({
    status_code: 20000,
    tasks_error: 0,
    tasks: [{ status_code: 20000, status_message: 'Ok.', result: models }],
  });

  afterEach(() => {
    kvStore.clear();
    vi.unstubAllGlobals();
  });

  it('resolves from the live models endpoint and caches the catalog in KV', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.dataforseo.com/v3/ai_optimization/claude/llm_responses/models');
      return new Response(JSON.stringify(dfsModelsResponse(catalog(['claude-opus-4-8', 'claude-sonnet-4-6']))), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await resolveModel(env, 'claude')).toBe('claude-sonnet-4-6');
    expect(await resolveModel(env, 'claude')).toBe('claude-sonnet-4-6');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the top preferred model when the models endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await resolveModel(env, 'gemini')).toBe(PREFERRED_MODELS.gemini[0]);
  });

  it('falls back when DataForSEO returns a task-level error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ status_code: 20000, tasks_error: 1, tasks: [{ status_code: 40501, status_message: 'Invalid Field', result: null }] }), { status: 200 })
    ));
    expect(await resolveModel(env, 'perplexity')).toBe(PREFERRED_MODELS.perplexity[0]);
  });
});

// Guard against the failure that shipped in 2026: hardcoded model names that
// the provider retired (claude-3-5-sonnet, gemini-1.5-flash) returned DFS task
// error 40501 on every call. Every preferred model must exist in the checked-in
// catalog snapshot. Refresh the snapshot with `npm run llm-models:snapshot`.
describe('preferred models against the DataForSEO catalog snapshot', () => {
  const providers = Object.keys(PREFERRED_MODELS) as LlmProvider[];

  it.each(providers)('%s: the fallback model is a live, web-search-capable model', (provider) => {
    const listed = snapshot[provider] || [];
    const fallback = PREFERRED_MODELS[provider][0];
    const entry = listed.find((m) => m.model_name === fallback);
    expect(entry, `${fallback} missing from snapshot for ${provider}`).toBeDefined();
    expect(entry?.web_search_supported).toBe(true);
  });

  it.each(providers)('%s: every preferred model is still in the catalog', (provider) => {
    const names = new Set((snapshot[provider] || []).map((m) => m.model_name));
    for (const name of PREFERRED_MODELS[provider]) {
      expect(names.has(name), `${name} is not in the ${provider} catalog snapshot`).toBe(true);
    }
  });
});
