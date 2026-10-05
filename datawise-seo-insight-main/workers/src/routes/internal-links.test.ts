import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index';
import { encryptToken } from '../lib/token-crypto';
import { createTestDb } from '../test-support/d1';
import { handleInternalLinksRequest } from './internal-links';

// End to end through the real routes and runner: a fake 6-page site, fake
// Workers AI embeddings (bag of words), and fake Jev + anchor writer
// responses. Verifies a run walks every stage to a report with links.

const SITE = 'https://example.com';
const TOPICS = ['solar panels', 'heat pumps', 'roof insulation', 'battery storage', 'smart thermostats', 'energy audits'];
const slug = (t: string) => t.replace(/ /g, '-');

function pageHtml(topic: string): string {
  const others = TOPICS.filter((t) => t !== topic);
  const para = (t: string) =>
    `<p>Many homeowners compare ${t} with ${topic} before deciding, because ${t} changes how much energy a house ` +
    `needs every month and how quickly the investment pays back over the following ten or fifteen years.</p>`;
  return `<!doctype html><html lang="en"><head><title>${topic} guide</title>
    <meta name="description" content="Everything about ${topic}."></head><body>
    <header><nav><a href="/">Home</a></nav></header><main><h1>${topic}</h1>
    ${others.slice(0, 3).map(para).join('\n')}</main><footer>footer</footer></body></html>`;
}

function sitemap(): string {
  return `<?xml version="1.0"?><urlset>${TOPICS.map((t) => `<url><loc>${SITE}/${slug(t)}/</loc></url>`).join('')}</urlset>`;
}

// Bag-of-words embedding so paragraphs about a topic match that topic's page.
function vec(text: string): number[] {
  const v = new Array(64).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 64;
    v[h] += 1;
  }
  return v;
}

class FakeR2 {
  store = new Map<string, string>();
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
  async get(key: string) {
    const v = this.store.get(key);
    return v === undefined ? null : { json: async () => JSON.parse(v) };
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
  }
  async list({ prefix }: { prefix: string }) {
    return { objects: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
  }
}

function fakeFetch(calls: { jev: number; anchor: number; anchorModels: Set<string> }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${SITE}/robots.txt`) return new Response(`User-agent: *\nSitemap: ${SITE}/sitemap.xml`);
    if (url === `${SITE}/sitemap.xml`) return new Response(sitemap(), { headers: { 'content-type': 'application/xml' } });
    const topic = TOPICS.find((t) => url === `${SITE}/${slug(t)}/`);
    if (topic) return new Response(pageHtml(topic), { headers: { 'content-type': 'text/html' } });
    if (url.endsWith('/api/alpha/decisions')) {
      calls.jev++;
      const body = JSON.parse(String(init?.body));
      const state: string = body.state;
      // Pick the candidate whose title is mentioned first in the paragraph.
      const para = state.split('PARAGRAPH ON THAT PAGE:\n')[1].split('\n')[0].toLowerCase();
      const opts = Object.entries(body.questions.best_target.criteria as Record<string, string>).filter(([k]) => k !== 'none');
      const hit = opts.find(([, title]) => para.includes(title.replace(' guide', '').toLowerCase()));
      return new Response(
        JSON.stringify({
          model: 'typesafe/jev-test',
          usage: { cost: 0.00004, input_tokens: 900 },
          answers: {
            best_target: { choice: hit ? hit[0] : 'none', confidence: hit ? 0.93 : 0.4, probabilities: { [hit?.[0] ?? '1']: 0.93, none: 0.07 } },
            link_warranted: { noul: 0.9 },
            anchor_available: { noul: 0.85 },
            reader_stage: { choice: 'comparing', confidence: 0.8 },
            commercial: { noul: 0.1 },
          },
        })
      );
    }
    if (url.endsWith('/api/v1/chat/completions')) {
      calls.anchor++;
      const req = JSON.parse(String(init?.body));
      calls.anchorModels.add(req.model);
      expect(req.reasoning).toEqual({ enabled: false });
      const prompt: string = req.messages[0].content;
      const title = prompt.match(/Title: (.+) guide/)![1];
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ anchor: `compare ${title}`.split(' ').slice(1).join(' ') + ' with' }) } }] }));
    }
    return new Response('not found', { status: 404 });
  });
}

describe('Internal Links run, end to end', () => {
  let env: Env;
  let waits: Promise<unknown>[];
  let kv: Map<string, string>;
  const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  const calls = { jev: 0, anchor: 0, anchorModels: new Set<string>() };

  beforeEach(async () => {
    const { d1, raw } = createTestDb();
    const key = 'k'.repeat(64);
    raw.prepare("INSERT INTO users (id, email) VALUES ('u1', 'a@b.c')").run();
    raw.prepare('INSERT INTO user_llm_configs (user_id, config_encrypted) VALUES (?, ?)').run(
      'u1',
      await encryptToken(JSON.stringify({ provider: 'openrouter', api_key: 'sk-or-test' }), key)
    );
    kv = new Map<string, string>([['internal-links-min-sim', '0.05']]);
    env = {
      DB: d1,
      KV: { get: async (k: string) => kv.get(k) ?? null },
      TASK_ATTACHMENTS: new FakeR2(),
      ENCRYPTION_KEY: key,
      AI: { run: async (_m: string, { text }: { text: string[] }) => ({ data: text.map(vec) }) },
    } as unknown as Env;
    waits = [];
    calls.jev = 0;
    calls.anchor = 0;
    calls.anchorModels = new Set();
    vi.stubGlobal('fetch', fakeFetch(calls));
  });
  afterEach(() => vi.unstubAllGlobals());

  const call = async (method: string, path: string, body?: unknown) => {
    const req = new Request(`https://api.test${path}`, { method, body: body ? JSON.stringify(body) : undefined });
    const res = await handleInternalLinksRequest(req, env, ctx, 'u1', path, method);
    return { status: res.status, body: (await res.json()) as any };
  };
  const drain = async () => {
    while (waits.length) await waits.shift();
  };

  it('crawls, scores, allocates, writes anchors and builds a report', async () => {
    const created = await call('POST', '/api/internal-links/runs', { site_url: 'example.com' });
    expect(created.status).toBe(201);
    const id = created.body.run.id;

    let run = created.body.run;
    for (let i = 0; i < 30 && run.status === 'running'; i++) {
      await drain();
      run = (await call('POST', `/api/internal-links/runs/${id}/advance`)).body.run;
    }
    await drain();
    run = (await call('GET', `/api/internal-links/runs/${id}`)).body.run;
    expect(run.error).toBeNull();
    expect(run.status).toBe('completed');
    expect(run.progress.pages_done).toBe(6);
    expect(calls.jev).toBe(run.progress.judged);
    expect(run.summary.links).toBeGreaterThan(0);
    expect(run.cost_usd).toBeGreaterThan(0);
    expect([...calls.anchorModels]).toEqual(['deepseek/deepseek-v4-pro']);

    const { body } = await call('GET', `/api/internal-links/runs/${id}/report`);
    const linked = body.report.rows.filter((r: any) => r.o === 'linked_apply' || r.o === 'linked_review');
    expect(linked.length).toBe(run.summary.links);
    // Each source page gets at most 3 new links.
    const perSource = new Map<number, number>();
    for (const r of linked) perSource.set(r.s, (perSource.get(r.s) ?? 0) + 1);
    expect(Math.max(...perSource.values())).toBeLessThanOrEqual(3);
    expect(body.report.pages.reduce((s: number, p: any) => s + p.new_links, 0)).toBe(linked.length);

    const appr = await call('PATCH', `/api/internal-links/runs/${id}/approvals`, { id: linked[0].i, value: 'approved' });
    expect(appr.body.approvals[linked[0].i]).toBe('approved');
  });

  it('writes anchors with the model set in KV', async () => {
    kv.set('internal-links-anchor-model', 'google/gemini-3.1-flash-lite');
    const created = await call('POST', '/api/internal-links/runs', { site_url: 'example.com' });
    const id = created.body.run.id;
    let run = created.body.run;
    for (let i = 0; i < 30 && run.status === 'running'; i++) {
      await drain();
      run = (await call('POST', `/api/internal-links/runs/${id}/advance`)).body.run;
    }
    expect(run.status).toBe('completed');
    expect([...calls.anchorModels]).toEqual(['google/gemini-3.1-flash-lite']);
    const { body } = await call('GET', `/api/internal-links/runs/${id}/report`);
    expect(JSON.stringify(body.report)).toContain('google/gemini-3.1-flash-lite');
  });

  it('refuses to start without a saved OpenRouter key', async () => {
    await env.DB.prepare('DELETE FROM user_llm_configs').run();
    const res = await call('POST', '/api/internal-links/runs', { site_url: 'example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_llm_key');
  });

  it('says the site refused us when every request gets a firewall 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><title>403 - Forbidden</title></html>', { status: 403 })));
    const res = await call('POST', '/api/internal-links/runs', { site_url: 'example.com' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('example.com refused our crawler (HTTP 403)');
  });

  it('pauses for confirmation when the estimate exceeds the cost limit', async () => {
    const created = await call('POST', '/api/internal-links/runs', { site_url: 'example.com', max_cost_usd: 0.0001 });
    const id = created.body.run.id;
    let run = created.body.run;
    for (let i = 0; i < 10 && run.status === 'running'; i++) {
      await drain();
      run = (await call('POST', `/api/internal-links/runs/${id}/advance`)).body.run;
    }
    expect(run.status).toBe('awaiting_confirmation');
    expect(calls.jev).toBe(0);
    const confirmed = await call('POST', `/api/internal-links/runs/${id}/confirm`);
    expect(confirmed.body.run.status).toBe('running');
  });
});
