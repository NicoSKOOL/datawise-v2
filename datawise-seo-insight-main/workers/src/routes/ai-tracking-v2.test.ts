import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import type { NormalizedAnswer } from '../ai-engines';

const runEngineMock = vi.fn();
vi.mock('../ai-engines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai-engines')>();
  return { ...actual, runEngine: (...args: unknown[]) => runEngineMock(...args) };
});

import { runChecksForProject, resolveProjectLocale, isEnginesV2Enabled, AI_ENGINES_V2_FLAG } from './ai-tracking';

const answer = (over: Partial<NormalizedAnswer>): NormalizedAnswer => ({
  engine: 'chatgpt', model: 'gpt-x', answerText: 'HubSpot is popular', answerMarkdown: '', cited: [], retrieved: [], brands: [], ads: [], fanOut: [], ...over,
});

function makeEnv() {
  const { d1, raw } = createTestDb();
  const kv = new Map<string, string>([[AI_ENGINES_V2_FLAG, '1']]);
  raw.prepare("INSERT INTO users (id, email, default_location_code, default_language_code) VALUES ('u1', 'u1@example.com', 2826, 'fr')").run();
  raw.prepare("INSERT INTO seo_projects (id, user_id, name, domain, location_code) VALUES ('p1', 'u1', 'DataWise', 'datawiseseo.com', 2724)").run();
  raw.prepare("INSERT INTO tracked_keywords (id, project_id, keyword, location_code, language_code) VALUES ('k1', 'p1', 'crm', 2724, 'es')").run();
  raw.prepare("INSERT INTO tracked_keywords (id, project_id, keyword, location_code, language_code) VALUES ('k2', 'p1', 'crm gratis', 2724, 'es')").run();
  raw.prepare("INSERT INTO tracked_keywords (id, project_id, keyword, location_code, language_code) VALUES ('k3', 'p1', 'crm tool', 2840, 'en')").run();
  raw.prepare("INSERT INTO ai_tracked_queries (id, project_id, query_text) VALUES ('q1', 'p1', 'mejor herramienta seo')").run();
  const env = { DB: d1, KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } }, DATAFORSEO_EMAIL: 'x', DATAFORSEO_PASSWORD: 'y' } as any;
  return { env, raw, kv };
}
const project = { id: 'p1', user_id: 'u1', name: 'DataWise', domain: 'datawiseseo.com', ai_tracking_enabled: 1, ai_brand_terms: null, ai_engines: JSON.stringify(['chatgpt', 'gemini']), location_code: 2724 };

// mockClear, not mockReset: vitest 3 re-raises rejected promises a reset spy had recorded.
beforeEach(() => runEngineMock.mockClear());

describe('resolveProjectLocale', () => {
  it('uses the project location and the dominant tracked-keyword language', async () => {
    const { env } = makeEnv();
    expect(await resolveProjectLocale(env, project)).toEqual({ location_code: 2724, language_code: 'es' });
  });
  it('falls back to the account defaults, then US/EN', async () => {
    const { env, raw } = makeEnv();
    raw.prepare('DELETE FROM tracked_keywords').run();
    expect(await resolveProjectLocale(env, { ...project, location_code: null })).toEqual({ location_code: 2826, language_code: 'fr' });
    raw.prepare("UPDATE users SET default_location_code = NULL, default_language_code = NULL WHERE id = 'u1'").run();
    expect(await resolveProjectLocale(env, { ...project, location_code: null })).toEqual({ location_code: 2840, language_code: 'en' });
  });
});

describe('isEnginesV2Enabled', () => {
  it('reads the KV flag', async () => {
    const { env, kv } = makeEnv();
    expect(await isEnginesV2Enabled(env)).toBe(true);
    kv.delete(AI_ENGINES_V2_FLAG);
    expect(await isEnginesV2Enabled(env)).toBe(false);
  });
});

describe('runChecksForProject (v2)', () => {
  it('runs each enabled engine in the project locale and stores status, model, locale, citations by kind and brands', async () => {
    const { env, raw } = makeEnv();
    runEngineMock.mockImplementation(async (_env: unknown, engine: string) => {
      if (engine === 'chatgpt') return answer({ engine: 'chatgpt', retrieved: [{ url: 'https://datawiseseo.com/g', domain: 'datawiseseo.com', title: null, position: 1 }], cited: [{ url: 'https://reddit.com/r', domain: 'reddit.com', title: null, position: 1 }], brands: [{ name: 'HubSpot', category: 'company', urls: [] }] });
      // A brand entity naming the project counts as mentioned, but a citation wins.
      return answer({ engine: 'gemini', model: '3.5 Flash-Lite', cited: [{ url: 'https://blog.datawiseseo.com/p', domain: 'blog.datawiseseo.com', title: null, position: 2 }], brands: [{ name: 'DataWise', category: 'company', urls: [] }] });
    });

    const summary = await runChecksForProject(env, project, [{ id: 'q1', query_text: 'mejor herramienta seo' }], 'manual');
    expect(summary).toMatchObject({ checks: 2, cited: 1, mentioned: 0, retrieved: 1, errors: 0 });
    expect(runEngineMock).toHaveBeenCalledTimes(2);
    expect(runEngineMock.mock.calls[0][3]).toEqual({ location_code: 2724, language_code: 'es' });

    const rows = raw.prepare('SELECT engine, status, model, location_code, language_code, retrieved_url, cited_url, citation_position FROM ai_visibility_checks ORDER BY engine').all() as any[];
    expect(rows).toEqual([
      { engine: 'chatgpt', status: 'retrieved', model: 'gpt-x', location_code: 2724, language_code: 'es', retrieved_url: 'https://datawiseseo.com/g', cited_url: null, citation_position: null },
      { engine: 'gemini', status: 'cited', model: '3.5 Flash-Lite', location_code: 2724, language_code: 'es', retrieved_url: null, cited_url: 'https://blog.datawiseseo.com/p', citation_position: 2 },
    ]);
    const kinds = raw.prepare("SELECT kind, domain FROM ai_check_citations cc JOIN ai_visibility_checks c ON c.id = cc.check_id WHERE c.engine = 'chatgpt' ORDER BY kind").all();
    expect(kinds).toEqual([{ kind: 'cited', domain: 'reddit.com' }, { kind: 'retrieved', domain: 'datawiseseo.com' }]);
    const brands = raw.prepare('SELECT name, is_you FROM ai_check_brands ORDER BY name').all();
    expect(brands).toEqual([{ name: 'DataWise', is_you: 1 }, { name: 'HubSpot', is_you: 0 }]);
  });

  it('records a task-level engine error as status error', async () => {
    const { env, raw } = makeEnv();
    const { EngineTaskError } = await import('../ai-engines');
    runEngineMock.mockImplementation(async (_e: unknown, engine: string) => {
      if (engine === 'chatgpt') throw new EngineTaskError('chatgpt', 'Internal Error - Timeout.');
      return answer({ engine: 'gemini' });
    });
    const summary = await runChecksForProject(env, project, [{ id: 'q1', query_text: 'x' }], 'scheduled');
    expect(summary.errors).toBe(1);
    const statuses = raw.prepare('SELECT engine, status FROM ai_visibility_checks ORDER BY engine').all();
    expect(statuses).toEqual([{ engine: 'chatgpt', status: 'error' }, { engine: 'gemini', status: 'absent' }]);
  });

  it('retries a failed engine once before recording an error, and stores the reason', async () => {
    const { env, raw } = makeEnv();
    let chatgptCalls = 0;
    runEngineMock.mockImplementation(async (_e: unknown, engine: string) => {
      if (engine === 'chatgpt') {
        chatgptCalls += 1;
        if (chatgptCalls === 1) throw new Error('Internal Error - Timeout.');
        return answer({ engine: 'chatgpt' });
      }
      throw new Error('gemini scraper failed');
    });
    const summary = await runChecksForProject(env, project, [{ id: 'q1', query_text: 'x' }], 'manual');
    expect(chatgptCalls).toBe(2);
    expect(summary).toMatchObject({ checks: 2, errors: 1 });
    const rows = raw.prepare('SELECT engine, status, answer_excerpt FROM ai_visibility_checks ORDER BY engine').all();
    expect(rows).toEqual([
      { engine: 'chatgpt', status: 'absent', answer_excerpt: null },
      { engine: 'gemini', status: 'error', answer_excerpt: 'gemini scraper failed' },
    ]);
  });

  it('skips Gemini on the legacy path instead of recording an error', async () => {
    const { env, kv, raw } = makeEnv();
    kv.delete(AI_ENGINES_V2_FLAG);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [] }] }] }), { status: 200 })));
    const summary = await runChecksForProject(env, { ...project, ai_engines: JSON.stringify(['gemini', 'perplexity']) }, [{ id: 'q1', query_text: 'x' }], 'manual');
    vi.unstubAllGlobals();
    expect(summary.checks).toBe(1);
    expect(summary.errors).toBe(0);
    expect(raw.prepare('SELECT engine FROM ai_visibility_checks').all()).toEqual([{ engine: 'perplexity' }]);
  });

  it('does not touch the engine layer when the flag is off', async () => {
    const { env, kv } = makeEnv();
    kv.delete(AI_ENGINES_V2_FLAG);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [] }] }] }), { status: 200 })));
    await runChecksForProject(env, { ...project, ai_engines: JSON.stringify(['perplexity']) }, [{ id: 'q1', query_text: 'x' }], 'manual');
    expect(runEngineMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
