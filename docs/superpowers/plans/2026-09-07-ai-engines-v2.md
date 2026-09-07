# AI Engines v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every AI check in DataWise (tracker cron + manual, Instant Check, dashboard card) reads real ChatGPT and Gemini interface answers through one engine layer, with a new `retrieved` status, project locale, and a KV flag so the shared worker keeps today's behavior until staging is verified.

**Architecture:** A new `workers/src/ai-engines/` module holds one adapter per engine (request builder + parser to a `NormalizedAnswer`), a `runEngine()` runner over the KV-cached DataForSEO client, and a pure `classify()`. The tracker, a new `POST /api/ai/engine-check` route and the dashboard `visibility-check` route all consume that layer. The SPA gets one `EngineResultPanel` for Instant Check, a `gemini` engine and a `retrieved` status everywhere it renders checks.

**Tech Stack:** Cloudflare Worker (TypeScript, vitest, better-sqlite3 for D1 tests), React 18 + Vite SPA (vitest for pure libs only; no DOM test runner installed), DataForSEO LLM Scraper / AI Mode SERP / LLM Responses.

**Spec:** `docs/superpowers/specs/2026-09-06-ai-engines-v2-design.md`

## Global Constraints

- Branch `feat/ai-engines-v2` (worktree `.claude/worktrees/ai-engines-v2`). Repo root for paths below: `datawise-seo-insight-main/`. Worker paths are under `workers/`.
- Stage files by name. Never `git add .` or `-A`. Never amend or force-push.
- No em dashes in any code, copy, or docs.
- Worker tests: `cd workers && npx vitest run <file>`; full suite `npx vitest run` must stay green (1342 tests at start). Typecheck changed worker files with `npx tsc --noEmit -p tsconfig.json`.
- SPA typecheck: `npx tsc --noEmit -p tsconfig.app.json` from `datawise-seo-insight-main/` (vite never typechecks; see lessons). SPA pure-lib tests: `npx vitest run src`.
- Engines: `google_ai_mode`, `chatgpt`, `gemini`, `perplexity`. Statuses: `cited`, `mentioned`, `retrieved`, `absent`, `no_answer`, `error`.
- KV flag name: `ai-engines-v2`. Existing kill switch `ai-tracking-paused` unchanged.
- ChatGPT scraper requests send `force_web_search: true` (verified 2026-09-06: without it, `brand_entities` and consistent `sources` are often empty).
- Fixtures live in `workers/src/ai-engines/__fixtures__/`. Raw captures (`raw-*.json`) are trimmed in Task 1 and the raw files deleted before commit.
- Commit message format: `<kind>(<scope>): <imperative summary>` with the session trailers from the harness.

---

### Task 1: Engine types, shared helpers, fixtures, ChatGPT adapter

**Files:**
- Create: `workers/src/ai-engines/types.ts`
- Create: `workers/src/ai-engines/shared.ts`
- Create: `workers/src/ai-engines/chatgpt.ts`
- Create: `workers/src/ai-engines/__fixtures__/chatgpt.json`, `chatgpt-task-error.json`, `gemini.json`, `ai_mode.json`, `perplexity.json` (trimmed from `raw-*.json` already in that folder)
- Test: `workers/src/ai-engines/shared.test.ts`, `workers/src/ai-engines/chatgpt.test.ts`

**Interfaces:**
- Produces: `EngineId`, `ALL_ENGINES`, `Locale`, `AnswerSource`, `AnswerBrand`, `AnswerAd`, `NormalizedAnswer`, `EngineAdapter` (types.ts); `normalizeDomain(raw): string | null`, `domainsMatch(a, b): boolean`, `dedupeSources(list): AnswerSource[]`, `stripMarkdown(md): string`, `toSource(input, position): AnswerSource | null` (shared.ts); `chatgptAdapter: EngineAdapter`.

- [ ] **Step 1: Trim fixtures**

Run from `workers/`:

```sh
python3 - <<'EOF'
import json, os
F = 'src/ai-engines/__fixtures__'
def load(name):
    return json.load(open(f'{F}/raw-{name}.json'))
def envelope(task_result, status=20000, message='Ok.'):
    return {"version": "0.1.20260902", "status_code": 20000, "status_message": "Ok.", "cost": 0.004,
            "tasks": [{"id": "fixture", "status_code": status, "status_message": message, "result": task_result}]}

# ChatGPT: keep markdown, sources (first 4), items (first 2, sources trimmed), add documented
# brand_entities / search_results / chat_gpt_ad shapes so the parser is exercised on every branch.
c = load('chatgpt')['tasks'][0]['result'][0]
src = lambda s: {k: s.get(k) for k in ('type','title','domain','url','source_name','publication_date')}
chat = {
  "keyword": c["keyword"], "location_code": 2840, "language_code": "en", "model": c.get("model"),
  "check_url": c.get("check_url"), "datetime": c["datetime"],
  "markdown": c["markdown"][:600],
  "sources": [src(s) for s in c["sources"][:4]],
  "search_results": [
    {"type": "chat_gpt_search_result", "url": "https://www.example-retrieved.com/crm-guide", "domain": "www.example-retrieved.com", "title": "CRM guide", "description": "retrieved only"},
    {"type": "chat_gpt_search_result", "url": c["sources"][0]["url"], "domain": c["sources"][0]["domain"], "title": c["sources"][0]["title"], "description": "also cited"}
  ],
  "brand_entities": [
    {"type": "chat_gpt_brand_entity", "title": "HubSpot", "category": "company", "markdown": "HubSpot", "urls": [{"url": "https://www.hubspot.com/", "domain": "www.hubspot.com"}]},
    {"type": "chat_gpt_brand_entity", "title": "Zoho CRM", "category": "product", "markdown": "Zoho CRM", "urls": None}
  ],
  "fan_out_queries": ["best crm for small business 2026", "cheap crm for startups"],
  "item_types": ["chat_gpt_text", "chat_gpt_ad"],
  "items": [
    {"type": "chat_gpt_text", "rank_group": 1, "rank_absolute": 1, "markdown": c["items"][0]["markdown"][:300], "sources": [src(s) for s in (c["items"][0].get("sources") or [])[:2]], "brand_entities": None},
    {"type": "chat_gpt_ad", "rank_group": 2, "rank_absolute": 2, "is_rendered": True, "title": "Try Pipedrive", "snippet": "sponsored", "url": "https://www.pipedrive.com/", "domain": "www.pipedrive.com", "image_url": None, "advertiser": {"name": "Pipedrive", "url": "https://www.pipedrive.com/", "favicon_url": None}}
  ]
}
json.dump(envelope([chat]), open(f'{F}/chatgpt.json','w'), indent=2)

e = load('chatgpt-error')['tasks'][0]
json.dump(envelope(None, e["status_code"], e["status_message"]), open(f'{F}/chatgpt-task-error.json','w'), indent=2)

g = load('gemini')['tasks'][0]['result'][0]
gem = {"keyword": g["keyword"], "location_code": 2840, "language_code": "en", "model": g.get("model"), "datetime": g["datetime"],
       "markdown": g["markdown"][:600], "sources": [src(s) for s in g["sources"][:4]], "item_types": g["item_types"],
       "items": [{"type": "gemini_text", "rank_group": 1, "rank_absolute": 1, "markdown": g["items"][0]["markdown"][:300], "sources": [src(s) for s in (g["items"][0].get("sources") or [])[:2]]}]}
json.dump(envelope([gem]), open(f'{F}/gemini.json','w'), indent=2)

a = load('ai_mode')['tasks'][0]['result'][0]; it = a["items"][0]
ref = lambda r: {k: r.get(k) for k in ('type','source','domain','url','title')}
sub_text = next(x for x in it["items"] if x["type"] == "ai_overview_element")
aim = {"keyword": a["keyword"], "location_code": 2840, "language_code": "en", "datetime": a["datetime"], "item_types": ["ai_overview"],
       "items": [{"type": "ai_overview", "rank_group": 1, "rank_absolute": 1, "markdown": it["markdown"][:600],
                  "references": [ref(r) for r in it["references"][:4]],
                  "items": [
                    {"type": "ai_overview_element", "position": "left", "title": sub_text.get("title"), "text": (sub_text.get("text") or "")[:200], "markdown": (sub_text.get("markdown") or "")[:200], "references": [ref(r) for r in (sub_text.get("references") or [])[:2]]},
                    {"type": "ai_overview_paid", "position": "left", "text": None, "markdown": None, "items": [
                      {"type": "ai_overview_paid_element", "title": "Monday CRM", "url": "https://monday.com/", "domain": "monday.com", "ad_aclk": "x", "website_name": "monday.com", "breadcrumb": None, "snippet": "sponsored", "images": None}]}
                  ]}]}
json.dump(envelope([aim]), open(f'{F}/ai_mode.json','w'), indent=2)

p = load('perplexity')['tasks'][0]['result'][0]; sec = p["items"][0]["sections"][0]
per = {"model_name": p["model_name"], "input_tokens": p["input_tokens"], "output_tokens": p["output_tokens"], "web_search": True, "money_spent": p["money_spent"], "datetime": p["datetime"],
       "items": [{"type": "message", "sections": [{"type": "text", "text": sec["text"][:400], "annotations": [{k: an.get(k) for k in ('title','url','start_index','end_index','text')} for an in sec["annotations"][:4]]}]}],
       "fan_out_queries": ["small business crm comparison"]}
json.dump(envelope([per]), open(f'{F}/perplexity.json','w'), indent=2)
for n in ('chatgpt','chatgpt-error','gemini','ai_mode','perplexity'):
    os.remove(f'{F}/raw-{n}.json')
print('fixtures written')
EOF
```

Expected: `fixtures written`; five `*.json` files, no `raw-*` left.

- [ ] **Step 2: Write the failing shared-helper tests**

`workers/src/ai-engines/shared.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeDomain, domainsMatch, dedupeSources, stripMarkdown, toSource } from './shared';

describe('normalizeDomain', () => {
  it('strips scheme, www and path', () => {
    expect(normalizeDomain('https://www.Example.com/path?x=1')).toBe('example.com');
    expect(normalizeDomain('www.example.com')).toBe('example.com');
    expect(normalizeDomain('sc-domain:example.com')).toBe('example.com');
  });
  it('returns null for empty input', () => {
    expect(normalizeDomain('')).toBeNull();
  });
});

describe('domainsMatch', () => {
  it('matches equal domains and subdomains either way', () => {
    expect(domainsMatch('blog.example.com', 'example.com')).toBe(true);
    expect(domainsMatch('example.com', 'blog.example.com')).toBe(true);
    expect(domainsMatch('example.co', 'example.com')).toBe(false);
  });
});

describe('toSource', () => {
  it('builds a source from url and falls back to the domain field', () => {
    expect(toSource({ url: 'https://www.a.com/x', title: 'A' }, 1)).toEqual({ url: 'https://www.a.com/x', domain: 'a.com', title: 'A', position: 1 });
    expect(toSource({ domain: 'www.b.com' }, 2)).toEqual({ url: null, domain: 'b.com', title: null, position: 2 });
    expect(toSource({ title: 'no location' }, 3)).toBeNull();
  });
});

describe('dedupeSources', () => {
  it('dedupes by url, then by domain when there is no url, and renumbers positions', () => {
    const out = dedupeSources([
      { url: 'https://a.com/1', domain: 'a.com', title: null, position: 9 },
      { url: 'https://a.com/1', domain: 'a.com', title: 'dup', position: 9 },
      { url: null, domain: 'b.com', title: null, position: 9 },
      { url: null, domain: 'b.com', title: null, position: 9 },
    ]);
    expect(out.map((s) => [s.url, s.domain, s.position])).toEqual([['https://a.com/1', 'a.com', 1], [null, 'b.com', 2]]);
  });
});

describe('stripMarkdown', () => {
  it('removes links, emphasis, headings and table pipes but keeps the words', () => {
    expect(stripMarkdown('## Best **CRM** [HubSpot](https://hubspot.com) | col')).toBe('Best CRM HubSpot col');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd workers && npx vitest run src/ai-engines/shared.test.ts`
Expected: FAIL, "Failed to load url ./shared".

- [ ] **Step 4: Write types.ts and shared.ts**

`workers/src/ai-engines/types.ts`:

```ts
import type { DataForSeoEnv } from '../dataforseo/client';

// The engine layer: one adapter per AI engine turns (query, locale) into a
// DataForSEO request and the raw payload into a NormalizedAnswer. Everything
// downstream (tracker, Instant Check, dashboard card) reads only this shape.
// Spec: docs/superpowers/specs/2026-09-06-ai-engines-v2-design.md

export type EngineId = 'google_ai_mode' | 'chatgpt' | 'gemini' | 'perplexity';
export const ALL_ENGINES: EngineId[] = ['google_ai_mode', 'chatgpt', 'gemini', 'perplexity'];

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && (ALL_ENGINES as string[]).includes(value);
}

export interface Locale {
  location_code: number;
  language_code: string;
}

export const DEFAULT_LOCALE: Locale = { location_code: 2840, language_code: 'en' };

export interface AnswerSource {
  url: string | null;
  domain: string;
  title: string | null;
  position: number;
}

export interface AnswerBrand {
  name: string;
  category: string | null;
  urls: string[];
}

export interface AnswerAd {
  domain: string | null;
  advertiser: string | null;
  rendered: boolean;
}

export interface NormalizedAnswer {
  engine: EngineId;
  model: string | null;
  answerText: string;
  answerMarkdown: string;
  cited: AnswerSource[];
  retrieved: AnswerSource[];
  brands: AnswerBrand[];
  ads: AnswerAd[];
  fanOut: string[];
}

export interface EngineRequest {
  endpoint: string;
  body: Record<string, unknown>[];
}

export interface EngineAdapter {
  id: EngineId;
  buildRequest(env: DataForSeoEnv, query: string, locale: Locale): Promise<EngineRequest>;
  parse(raw: unknown): NormalizedAnswer;
}
```

`workers/src/ai-engines/shared.ts`:

```ts
import type { AnswerSource } from './types';

export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/^sc-domain:/i, '');
  if (!cleaned) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  try {
    const host = new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

export function domainsMatch(candidate: string, target: string): boolean {
  return candidate === target || candidate.endsWith(`.${target}`) || target.endsWith(`.${candidate}`);
}

interface SourceLike { url?: unknown; domain?: unknown; title?: unknown }

export function toSource(input: SourceLike | null | undefined, position: number): AnswerSource | null {
  if (!input || typeof input !== 'object') return null;
  const url = typeof input.url === 'string' && input.url ? input.url : null;
  const domain = normalizeDomain(url) ?? normalizeDomain(typeof input.domain === 'string' ? input.domain : null);
  if (!domain) return null;
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : null;
  return { url, domain, title, position };
}

export function dedupeSources(list: AnswerSource[]): AnswerSource[] {
  const seen = new Set<string>();
  const out: AnswerSource[] = [];
  for (const source of list) {
    const key = source.url || source.domain;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...source, position: out.length + 1 });
  }
  return out;
}

// Plain text for brand-term matching. Keeps words, drops markdown syntax.
export function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~>|]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
```

- [ ] **Step 5: Run shared tests, verify pass**

Run: `npx vitest run src/ai-engines/shared.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing ChatGPT adapter test**

`workers/src/ai-engines/chatgpt.test.ts`:

```ts
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
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/ai-engines/chatgpt.test.ts`
Expected: FAIL, "Failed to load url ./chatgpt".

- [ ] **Step 8: Write chatgpt.ts**

```ts
import { extractResult } from '../dataforseo/client';
import type { AnswerAd, AnswerBrand, AnswerSource, EngineAdapter, NormalizedAnswer } from './types';
import { asArray, asString, dedupeSources, normalizeDomain, stripMarkdown, toSource } from './shared';

// Real ChatGPT interface answer via DataForSEO's LLM Scraper. `sources` are
// what ChatGPT attributed the answer to; `search_results` are pages it fetched
// while answering. force_web_search keeps citations and brand entities present
// (verified 2026-09-06: without it both are often empty).
export const chatgptAdapter: EngineAdapter = {
  id: 'chatgpt',
  async buildRequest(_env, query, locale) {
    return {
      endpoint: '/ai_optimization/chat_gpt/llm_scraper/live/advanced',
      body: [{ keyword: query, location_code: locale.location_code, language_code: locale.language_code, force_web_search: true }],
    };
  },
  parse(raw): NormalizedAnswer {
    const result = (extractResult(raw) ?? {}) as Record<string, unknown>;
    const items = asArray<Record<string, unknown>>(result.items);

    const citedRaw: AnswerSource[] = [];
    for (const s of asArray<Record<string, unknown>>(result.sources)) {
      const src = toSource(s, citedRaw.length + 1);
      if (src) citedRaw.push(src);
    }
    for (const item of items) {
      for (const s of asArray<Record<string, unknown>>(item.sources)) {
        const src = toSource(s, citedRaw.length + 1);
        if (src) citedRaw.push(src);
      }
    }
    const cited = dedupeSources(citedRaw);
    const citedKeys = new Set(cited.map((s) => s.url || s.domain));

    const retrievedRaw: AnswerSource[] = [];
    for (const s of asArray<Record<string, unknown>>(result.search_results)) {
      const src = toSource(s, retrievedRaw.length + 1);
      if (src && !citedKeys.has(src.url || src.domain)) retrievedRaw.push(src);
    }
    const retrieved = dedupeSources(retrievedRaw);

    const brandInputs = [
      ...asArray<Record<string, unknown>>(result.brand_entities),
      ...items.flatMap((item) => asArray<Record<string, unknown>>(item.brand_entities)),
    ];
    const brandsByName = new Map<string, AnswerBrand>();
    for (const b of brandInputs) {
      const name = asString(b.title) ?? asString(b.markdown);
      if (!name) continue;
      const key = name.toLowerCase();
      const urls = asArray<Record<string, unknown>>(b.urls).map((u) => asString(u.url)).filter((u): u is string => !!u);
      const existing = brandsByName.get(key);
      if (existing) {
        for (const u of urls) if (!existing.urls.includes(u)) existing.urls.push(u);
      } else {
        brandsByName.set(key, { name, category: asString(b.category), urls });
      }
    }

    const ads: AnswerAd[] = items
      .filter((item) => item.type === 'chat_gpt_ad')
      .map((item) => {
        const advertiser = item.advertiser as Record<string, unknown> | undefined;
        return {
          domain: normalizeDomain(asString(item.url) ?? asString(item.domain)),
          advertiser: asString(advertiser?.name) ?? null,
          rendered: item.is_rendered === true,
        };
      });

    const answerMarkdown =
      asString(result.markdown) ??
      items.map((item) => asString(item.markdown) ?? asString(item.text) ?? '').filter(Boolean).join('\n\n');

    return {
      engine: 'chatgpt',
      model: asString(result.model),
      answerText: stripMarkdown(answerMarkdown),
      answerMarkdown,
      cited,
      retrieved,
      brands: Array.from(brandsByName.values()),
      ads,
      fanOut: asArray<unknown>(result.fan_out_queries).filter((q): q is string => typeof q === 'string' && !!q.trim()),
    };
  },
};
```

- [ ] **Step 9: Run tests, verify pass**

Run: `npx vitest run src/ai-engines/`
Expected: PASS (shared 5 + chatgpt 8).

- [ ] **Step 10: Commit**

```sh
git add workers/src/ai-engines/types.ts workers/src/ai-engines/shared.ts workers/src/ai-engines/chatgpt.ts workers/src/ai-engines/shared.test.ts workers/src/ai-engines/chatgpt.test.ts workers/src/ai-engines/__fixtures__/chatgpt.json workers/src/ai-engines/__fixtures__/chatgpt-task-error.json workers/src/ai-engines/__fixtures__/gemini.json workers/src/ai-engines/__fixtures__/ai_mode.json workers/src/ai-engines/__fixtures__/perplexity.json
git commit -m "feat(ai-engines): engine types, shared helpers, ChatGPT scraper adapter"
```

---

### Task 2: Gemini, Google AI Mode and Perplexity adapters, country codes

**Files:**
- Create: `workers/src/ai-engines/gemini.ts`, `workers/src/ai-engines/google-ai-mode.ts`, `workers/src/ai-engines/perplexity.ts`, `workers/src/ai-engines/country-codes.ts`
- Test: `workers/src/ai-engines/adapters.test.ts`

**Interfaces:**
- Consumes: Task 1 types and helpers; `resolveModel(env, 'perplexity')` from `workers/src/dataforseo/llm-models.ts`.
- Produces: `geminiAdapter`, `googleAiModeAdapter`, `perplexityAdapter` (all `EngineAdapter`); `countryCodeForLocation(location_code: number): string`.

- [ ] **Step 1: Generate country-codes.ts from the SPA location table**

Run from `datawise-seo-insight-main/`:

```sh
node -e '
const fs = require("fs");
const src = fs.readFileSync("src/lib/dataForSeoLocations.ts", "utf8");
const rows = [...src.matchAll(/value:\s*(\d+),\s*label:\s*"[^"]*",\s*countryCode:\s*"([A-Z]{2})"/g)].map(m => `  ${m[1]}: "${m[2]}",`);
const out = `// Generated from src/lib/dataForSeoLocations.ts (country-level DataForSEO
// location codes to ISO 3166-1 alpha-2). Perplexity takes only a country code.
// Regenerate with the node one-liner in docs/superpowers/plans/2026-09-07-ai-engines-v2.md Task 2.
export const COUNTRY_CODES: Record<number, string> = {
${rows.join("\n")}
};

export function countryCodeForLocation(locationCode: number): string {
  return COUNTRY_CODES[locationCode] || "US";
}
`;
fs.writeFileSync("workers/src/ai-engines/country-codes.ts", out);
console.log(rows.length, "countries");
'
```

Expected: a count above 100 and the file written.

- [ ] **Step 2: Write the failing adapter tests**

`workers/src/ai-engines/adapters.test.ts`:

```ts
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
    expect(a.cited.length).toBeGreaterThanOrEqual(4);
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/ai-engines/adapters.test.ts`
Expected: FAIL, "Failed to load url ./gemini".

- [ ] **Step 4: Write the three adapters**

`workers/src/ai-engines/gemini.ts`:

```ts
import { extractResult } from '../dataforseo/client';
import type { AnswerSource, EngineAdapter, NormalizedAnswer } from './types';
import { asArray, asString, dedupeSources, stripMarkdown, toSource } from './shared';

// Real Gemini interface answer via DataForSEO's LLM Scraper. Gemini exposes
// cited sources only: no retrieved list, brand entities or ads.
export const geminiAdapter: EngineAdapter = {
  id: 'gemini',
  async buildRequest(_env, query, locale) {
    return {
      endpoint: '/ai_optimization/gemini/llm_scraper/live/advanced',
      body: [{ keyword: query, location_code: locale.location_code, language_code: locale.language_code }],
    };
  },
  parse(raw): NormalizedAnswer {
    const result = (extractResult(raw) ?? {}) as Record<string, unknown>;
    const items = asArray<Record<string, unknown>>(result.items);
    const citedRaw: AnswerSource[] = [];
    for (const s of asArray<Record<string, unknown>>(result.sources)) {
      const src = toSource(s, citedRaw.length + 1);
      if (src) citedRaw.push(src);
    }
    for (const item of items) {
      for (const s of asArray<Record<string, unknown>>(item.sources)) {
        const src = toSource(s, citedRaw.length + 1);
        if (src) citedRaw.push(src);
      }
    }
    const answerMarkdown =
      asString(result.markdown) ??
      items.map((item) => asString(item.markdown) ?? asString(item.original_text) ?? '').filter(Boolean).join('\n\n');
    return {
      engine: 'gemini',
      model: asString(result.model),
      answerText: stripMarkdown(answerMarkdown),
      answerMarkdown,
      cited: dedupeSources(citedRaw),
      retrieved: [],
      brands: [],
      ads: [],
      fanOut: [],
    };
  },
};
```

`workers/src/ai-engines/google-ai-mode.ts`:

```ts
import { extractResult } from '../dataforseo/client';
import type { AnswerAd, AnswerSource, EngineAdapter, NormalizedAnswer } from './types';
import { asArray, asString, dedupeSources, normalizeDomain, stripMarkdown, toSource } from './shared';

const AI_ITEM_TYPES = new Set(['ai_overview', 'ai_mode']);

// Google AI Mode SERP. The answer is one `ai_overview` item whose `references`
// and nested elements' `references` are the citations; `ai_overview_paid`
// elements carry sponsored placements (DataForSEO, 2026-07-30).
export const googleAiModeAdapter: EngineAdapter = {
  id: 'google_ai_mode',
  async buildRequest(_env, query, locale) {
    return {
      endpoint: '/serp/google/ai_mode/live/advanced',
      body: [{ keyword: query, location_code: locale.location_code, language_code: locale.language_code, device: 'desktop', os: 'windows' }],
    };
  },
  parse(raw): NormalizedAnswer {
    const result = (extractResult(raw) ?? {}) as Record<string, unknown>;
    const aiItems = asArray<Record<string, unknown>>(result.items).filter((item) => AI_ITEM_TYPES.has(String(item.type)));

    const citedRaw: AnswerSource[] = [];
    const ads: AnswerAd[] = [];
    const markdownParts: string[] = [];

    const pushRefs = (refs: unknown) => {
      for (const r of asArray<Record<string, unknown>>(refs)) {
        const src = toSource(r, citedRaw.length + 1);
        if (src) citedRaw.push(src);
      }
    };

    for (const item of aiItems) {
      const md = asString(item.markdown);
      if (md) markdownParts.push(md);
      pushRefs(item.references);
      for (const el of asArray<Record<string, unknown>>(item.items)) {
        pushRefs(el.references);
        if (!md) {
          const elText = asString(el.markdown) ?? asString(el.text);
          if (elText) markdownParts.push(elText);
        }
        if (el.type === 'ai_overview_paid') {
          for (const ad of asArray<Record<string, unknown>>(el.items)) {
            ads.push({
              domain: normalizeDomain(asString(ad.url) ?? asString(ad.domain)),
              advertiser: asString(ad.website_name) ?? asString(ad.title),
              rendered: true,
            });
          }
        }
      }
    }

    const answerMarkdown = markdownParts.join('\n\n');
    return {
      engine: 'google_ai_mode',
      model: null,
      answerText: stripMarkdown(answerMarkdown),
      answerMarkdown,
      cited: dedupeSources(citedRaw),
      retrieved: [],
      brands: [],
      ads,
      fanOut: [],
    };
  },
};
```

`workers/src/ai-engines/perplexity.ts`:

```ts
import { extractResult } from '../dataforseo/client';
import { resolveModel } from '../dataforseo/llm-models';
import { countryCodeForLocation } from './country-codes';
import type { AnswerSource, EngineAdapter, NormalizedAnswer } from './types';
import { asArray, asString, dedupeSources, toSource } from './shared';

// Perplexity has no scraper; this stays on the LLM Responses API. Model comes
// from the live catalog (PR #137), the country from the project's location.
export const perplexityAdapter: EngineAdapter = {
  id: 'perplexity',
  async buildRequest(env, query, locale) {
    return {
      endpoint: '/ai_optimization/perplexity/llm_responses/live',
      body: [{
        user_prompt: query,
        model_name: await resolveModel(env, 'perplexity'),
        web_search_country_iso_code: countryCodeForLocation(locale.location_code),
        max_output_tokens: 2048,
      }],
    };
  },
  parse(raw): NormalizedAnswer {
    const result = (extractResult(raw) ?? {}) as Record<string, unknown>;
    const texts: string[] = [];
    const citedRaw: AnswerSource[] = [];
    for (const item of asArray<Record<string, unknown>>(result.items)) {
      if (item.type === 'reasoning') continue;
      for (const section of asArray<Record<string, unknown>>(item.sections)) {
        const text = asString(section.text);
        if (text) texts.push(text);
        for (const a of asArray<Record<string, unknown>>(section.annotations)) {
          const src = toSource(a, citedRaw.length + 1);
          if (src) citedRaw.push(src);
        }
      }
    }
    const answerText = texts.join('\n\n');
    return {
      engine: 'perplexity',
      model: asString(result.model_name),
      answerText,
      answerMarkdown: answerText,
      cited: dedupeSources(citedRaw),
      retrieved: [],
      brands: [],
      ads: [],
      fanOut: asArray<unknown>(result.fan_out_queries).filter((q): q is string => typeof q === 'string' && !!q.trim()),
    };
  },
};
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run src/ai-engines/`
Expected: PASS (all adapter tests).

- [ ] **Step 6: Commit**

```sh
git add workers/src/ai-engines/gemini.ts workers/src/ai-engines/google-ai-mode.ts workers/src/ai-engines/perplexity.ts workers/src/ai-engines/country-codes.ts workers/src/ai-engines/adapters.test.ts
git commit -m "feat(ai-engines): Gemini, Google AI Mode and Perplexity adapters"
```

---

### Task 3: Runner and classifier

**Files:**
- Create: `workers/src/ai-engines/index.ts`, `workers/src/ai-engines/classify.ts`
- Test: `workers/src/ai-engines/runner.test.ts`, `workers/src/ai-engines/classify.test.ts`

**Interfaces:**
- Consumes: adapters from Tasks 1 and 2; `dataforseoRequestCached`, `getTaskError` from `../dataforseo/client`.
- Produces: `ENGINES: Record<EngineId, EngineAdapter>`, `class EngineTaskError extends Error { engine: EngineId }`, `runEngine(env, engine, query, locale, opts: { ttlSeconds: number; timeoutMs: number }): Promise<NormalizedAnswer>`, `ENGINE_LABELS: Record<EngineId, string>`; `CheckStatus`, `Classification`, `classify(answer, projectDomain, brandTerms): Classification`, `isVisibleStatus(status): boolean`. `index.ts` re-exports everything from `types.ts` and `classify.ts`.

- [ ] **Step 1: Write the failing runner test**

`workers/src/ai-engines/runner.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runEngine, EngineTaskError, ENGINES, ALL_ENGINES } from './index';
import chatgptFixture from './__fixtures__/chatgpt.json';
import taskError from './__fixtures__/chatgpt-task-error.json';

const kv = new Map<string, string>();
const env = {
  KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } },
  DATAFORSEO_EMAIL: 'x', DATAFORSEO_PASSWORD: 'y',
} as any;
const locale = { location_code: 2840, language_code: 'en' };

afterEach(() => { kv.clear(); vi.unstubAllGlobals(); });

describe('runEngine', () => {
  it('has an adapter for every engine', () => {
    for (const id of ALL_ENGINES) expect(ENGINES[id].id).toBe(id);
  });

  it('posts the adapter request, parses the answer, and serves the second call from KV', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(chatgptFixture), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await runEngine(env, 'chatgpt', 'best crm', locale, { ttlSeconds: 3600, timeoutMs: 5000 });
    const second = await runEngine(env, 'chatgpt', 'best crm', locale, { ttlSeconds: 3600, timeoutMs: 5000 });
    expect(first.cited.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toContain('/ai_optimization/chat_gpt/llm_scraper/live/advanced');
    expect(JSON.parse(init.body)[0]).toMatchObject({ keyword: 'best crm', location_code: 2840 });
  });

  it('throws EngineTaskError on a task-level error and does not cache it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(taskError), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runEngine(env, 'chatgpt', 'best crm', locale, { ttlSeconds: 3600, timeoutMs: 5000 }))
      .rejects.toBeInstanceOf(EngineTaskError);
    await expect(runEngine(env, 'chatgpt', 'best crm', locale, { ttlSeconds: 3600, timeoutMs: 5000 }))
      .rejects.toThrow(/Timeout/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('separates cache entries by locale', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(chatgptFixture), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await runEngine(env, 'chatgpt', 'best crm', locale, { ttlSeconds: 3600, timeoutMs: 5000 });
    await runEngine(env, 'chatgpt', 'best crm', { location_code: 2724, language_code: 'es' }, { ttlSeconds: 3600, timeoutMs: 5000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ai-engines/runner.test.ts`
Expected: FAIL, "Failed to load url ./index".

- [ ] **Step 3: Write index.ts**

```ts
import { dataforseoRequestCached, getTaskError, type DataForSeoEnv } from '../dataforseo/client';
import { chatgptAdapter } from './chatgpt';
import { geminiAdapter } from './gemini';
import { googleAiModeAdapter } from './google-ai-mode';
import { perplexityAdapter } from './perplexity';
import type { EngineAdapter, EngineId, Locale, NormalizedAnswer } from './types';

export * from './types';
export * from './classify';

export const ENGINES: Record<EngineId, EngineAdapter> = {
  google_ai_mode: googleAiModeAdapter,
  chatgpt: chatgptAdapter,
  gemini: geminiAdapter,
  perplexity: perplexityAdapter,
};

export const ENGINE_LABELS: Record<EngineId, string> = {
  google_ai_mode: 'Google AI Mode',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
};

// A DataForSEO task that failed inside an HTTP 200 (status 40xxx/50xxx).
// Callers record it as `error`; it is never cached (client.ts refuses).
export class EngineTaskError extends Error {
  readonly engine: EngineId;
  constructor(engine: EngineId, message: string) {
    super(message);
    this.name = 'EngineTaskError';
    this.engine = engine;
  }
}

export interface RunEngineOptions {
  ttlSeconds: number;
  timeoutMs: number;
}

export async function runEngine(
  env: DataForSeoEnv,
  engine: EngineId,
  query: string,
  locale: Locale,
  opts: RunEngineOptions
): Promise<NormalizedAnswer> {
  const adapter = ENGINES[engine];
  const { endpoint, body } = await adapter.buildRequest(env, query, locale);
  const raw = await dataforseoRequestCached(env, endpoint, body, { ttlSeconds: opts.ttlSeconds, timeoutMs: opts.timeoutMs });
  const taskError = getTaskError(raw);
  if (taskError) throw new EngineTaskError(engine, taskError);
  return adapter.parse(raw);
}
```

- [ ] **Step 4: Write the failing classifier test**

`workers/src/ai-engines/classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classify, isVisibleStatus } from './classify';
import type { NormalizedAnswer } from './types';

const base = (over: Partial<NormalizedAnswer> = {}): NormalizedAnswer => ({
  engine: 'chatgpt', model: null,
  answerText: 'HubSpot and Zoho are popular. DataWise SEO also gets a mention here for analytics.',
  answerMarkdown: '', cited: [], retrieved: [], brands: [], ads: [], fanOut: [], ...over,
});
const src = (domain: string, position: number, url = `https://${domain}/p`) => ({ url, domain, title: null, position });

describe('classify', () => {
  it('cited when the project domain is among cited sources, with position and url', () => {
    const c = classify(base({ cited: [src('other.com', 1), src('blog.datawiseseo.com', 2)] }), 'datawiseseo.com', ['DataWise']);
    expect(c.status).toBe('cited');
    expect(c.citation_position).toBe(2);
    expect(c.cited_url).toBe('https://blog.datawiseseo.com/p');
    expect(c.answer_excerpt).toContain('HubSpot');
  });

  it('cited beats mentioned and retrieved', () => {
    const c = classify(base({ cited: [src('datawiseseo.com', 1)], retrieved: [src('datawiseseo.com', 1)], brands: [{ name: 'DataWise', category: null, urls: [] }] }), 'datawiseseo.com', ['DataWise']);
    expect(c.status).toBe('cited');
  });

  it('mentioned via brand entity name (case-insensitive)', () => {
    const c = classify(base({ answerText: 'nothing here', brands: [{ name: 'datawise seo', category: 'company', urls: [] }] }), 'datawiseseo.com', ['DataWise SEO']);
    expect(c.status).toBe('mentioned');
    expect(c.matched_brand).toBe('datawise seo');
  });

  it('mentioned via brand entity url matching the domain', () => {
    const c = classify(base({ answerText: 'nothing here', brands: [{ name: 'DW', category: null, urls: ['https://www.datawiseseo.com/'] }] }), 'datawiseseo.com', ['zzz']);
    expect(c.status).toBe('mentioned');
    expect(c.matched_brand).toBe('DW');
  });

  it('mentioned via a brand term in the text, with an excerpt around the match', () => {
    const c = classify(base(), 'datawiseseo.com', ['DataWise SEO']);
    expect(c.status).toBe('mentioned');
    expect(c.answer_excerpt).toContain('DataWise SEO');
    expect(c.matched_brand).toBe('DataWise SEO');
  });

  it('ignores brand terms shorter than 3 characters and matches whole words only', () => {
    expect(classify(base({ answerText: 'datawiseseoisgreat' }), 'datawiseseo.com', ['datawiseseo']).status).toBe('absent');
    expect(classify(base({ answerText: 'we use dw daily' }), 'x.com', ['dw']).status).toBe('absent');
  });

  it('retrieved when the domain was fetched but not cited', () => {
    const c = classify(base({ answerText: 'nothing here', retrieved: [src('datawiseseo.com', 3, 'https://datawiseseo.com/guide')] }), 'datawiseseo.com', ['zzz']);
    expect(c.status).toBe('retrieved');
    expect(c.retrieved_url).toBe('https://datawiseseo.com/guide');
    expect(c.answer_excerpt).toBe('nothing here');
  });

  it('no_answer when there is no text and no sources', () => {
    expect(classify(base({ answerText: '' }), 'datawiseseo.com', ['DataWise']).status).toBe('no_answer');
  });

  it('absent otherwise', () => {
    const c = classify(base({ answerText: 'HubSpot only' }), 'datawiseseo.com', ['DataWise']);
    expect(c).toEqual({ status: 'absent', citation_position: null, cited_url: null, retrieved_url: null, answer_excerpt: null, matched_brand: null });
  });
});

describe('isVisibleStatus', () => {
  it('counts cited and mentioned only', () => {
    expect(isVisibleStatus('cited')).toBe(true);
    expect(isVisibleStatus('mentioned')).toBe(true);
    expect(isVisibleStatus('retrieved')).toBe(false);
    expect(isVisibleStatus('absent')).toBe(false);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run src/ai-engines/classify.test.ts`
Expected: FAIL, "Failed to load url ./classify".

- [ ] **Step 6: Write classify.ts**

```ts
import type { NormalizedAnswer } from './types';
import { domainsMatch, normalizeDomain } from './shared';

export type CheckStatus = 'cited' | 'mentioned' | 'retrieved' | 'absent' | 'no_answer';

export interface Classification {
  status: CheckStatus;
  citation_position: number | null;
  cited_url: string | null;
  retrieved_url: string | null;
  answer_excerpt: string | null;
  matched_brand: string | null;
}

const EXCERPT_MAX = 300;

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 100);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`.slice(0, EXCERPT_MAX);
}

function leadExcerpt(text: string): string | null {
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, EXCERPT_MAX) : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isVisibleStatus(status: string): boolean {
  return status === 'cited' || status === 'mentioned';
}

// Priority: cited > mentioned > retrieved > no_answer > absent.
// Spec section 4 of docs/superpowers/specs/2026-09-06-ai-engines-v2-design.md.
export function classify(answer: NormalizedAnswer, projectDomain: string, brandTerms: string[]): Classification {
  const none: Classification = { status: 'absent', citation_position: null, cited_url: null, retrieved_url: null, answer_excerpt: null, matched_brand: null };
  const target = normalizeDomain(projectDomain);
  const text = answer.answerText || '';

  if (target) {
    const hit = answer.cited.find((s) => domainsMatch(s.domain, target));
    if (hit) {
      return { ...none, status: 'cited', citation_position: hit.position, cited_url: hit.url, answer_excerpt: leadExcerpt(text) };
    }
  }

  const terms = brandTerms.map((t) => t.trim()).filter((t) => t.length >= 3);
  const termKeys = new Set(terms.map((t) => t.toLowerCase()));
  for (const brand of answer.brands) {
    const byName = termKeys.has(brand.name.trim().toLowerCase());
    const byUrl = !!target && brand.urls.some((u) => { const d = normalizeDomain(u); return !!d && domainsMatch(d, target); });
    if (byName || byUrl) {
      return { ...none, status: 'mentioned', matched_brand: brand.name, answer_excerpt: leadExcerpt(text) };
    }
  }
  for (const term of terms) {
    const match = text.match(new RegExp(`\\b${escapeRegex(term)}\\b`, 'i'));
    if (match && match.index != null) {
      return { ...none, status: 'mentioned', matched_brand: term, answer_excerpt: excerptAround(text, match.index, term.length) };
    }
  }

  if (target) {
    const fetched = answer.retrieved.find((s) => domainsMatch(s.domain, target));
    if (fetched) {
      return { ...none, status: 'retrieved', retrieved_url: fetched.url, answer_excerpt: leadExcerpt(text) };
    }
  }

  if (!text.trim() && answer.cited.length === 0 && answer.retrieved.length === 0) {
    return { ...none, status: 'no_answer' };
  }
  return none;
}
```

- [ ] **Step 7: Run all engine tests, verify pass**

Run: `npx vitest run src/ai-engines/`
Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add workers/src/ai-engines/index.ts workers/src/ai-engines/classify.ts workers/src/ai-engines/runner.test.ts workers/src/ai-engines/classify.test.ts
git commit -m "feat(ai-engines): runEngine runner with task-error surfacing and five-status classifier"
```

---

### Task 4: D1 migration and schema mirror

**Files:**
- Create: `workers/migrations/2026-09-07-ai-engines-v2.sql`
- Modify: `workers/src/db/schema.sql` (append the AI tracking tables; they were never mirrored there)
- Test: `workers/src/ai-engines/migration.test.ts`

**Interfaces:**
- Produces: columns `ai_visibility_checks.model`, `.location_code`, `.language_code`, `.retrieved_url`; `ai_check_citations.kind` (default `cited`); table `ai_check_brands(id, check_id, name, category, is_you)`.

- [ ] **Step 1: Write the failing migration test**

`workers/src/ai-engines/migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '../test-support/d1';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, '..', '..', 'migrations', '2026-09-07-ai-engines-v2.sql'), 'utf8');

describe('ai-engines-v2 migration', () => {
  it('schema.sql already contains the v2 columns so the app schema and migration agree', () => {
    const { raw } = createTestDb();
    const cols = raw.prepare('PRAGMA table_info(ai_visibility_checks)').all().map((c: any) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['model', 'location_code', 'language_code', 'retrieved_url', 'answer_text']));
    const citeCols = raw.prepare('PRAGMA table_info(ai_check_citations)').all().map((c: any) => c.name);
    expect(citeCols).toContain('kind');
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_check_brands'").get()).toBeTruthy();
  });

  it('migration applies on top of the pre-v2 tables and stores retrieved checks, kinds and brands', () => {
    const { raw } = createTestDb();
    // Recreate the pre-v2 shape to prove the ALTERs apply cleanly.
    raw.exec(`DROP TABLE ai_check_brands; DROP TABLE ai_check_citations; DROP TABLE ai_visibility_checks; DROP TABLE ai_tracked_queries;`);
    raw.exec(readFileSync(join(here, '..', '..', 'migrations', '2026-06-09-ai-visibility-tracking.sql'), 'utf8').replace(/ALTER TABLE seo_projects[^;]*;/g, ''));
    raw.exec(readFileSync(join(here, '..', '..', 'migrations', '2026-06-10-ai-checks-answer-text.sql'), 'utf8'));
    raw.exec(migration);

    raw.prepare("INSERT INTO seo_projects (id, user_id, name, domain) VALUES ('p1', 'u1', 'P', 'datawiseseo.com')").run();
    raw.prepare("INSERT INTO ai_tracked_queries (id, project_id, query_text) VALUES ('q1', 'p1', 'best seo tool')").run();
    const check = raw.prepare(`INSERT INTO ai_visibility_checks (query_id, engine, status, retrieved_url, model, location_code, language_code, run_type)
      VALUES ('q1', 'gemini', 'retrieved', 'https://datawiseseo.com/x', '3.5 Flash-Lite', 2840, 'en', 'manual')`).run();
    const checkId = Number(check.lastInsertRowid);
    raw.prepare("INSERT INTO ai_check_citations (check_id, domain, url, position, kind) VALUES (?, 'datawiseseo.com', 'https://datawiseseo.com/x', 1, 'retrieved')").run(checkId);
    raw.prepare("INSERT INTO ai_check_citations (check_id, domain, url, position) VALUES (?, 'reddit.com', 'https://reddit.com/r', 1)").run(checkId);
    raw.prepare("INSERT INTO ai_check_brands (check_id, name, category, is_you) VALUES (?, 'DataWise', 'company', 1)").run(checkId);

    const row = raw.prepare('SELECT status, retrieved_url, model FROM ai_visibility_checks WHERE id = ?').get(checkId) as any;
    expect(row).toEqual({ status: 'retrieved', retrieved_url: 'https://datawiseseo.com/x', model: '3.5 Flash-Lite' });
    const kinds = raw.prepare('SELECT kind FROM ai_check_citations WHERE check_id = ? ORDER BY id').all(checkId).map((r: any) => r.kind);
    expect(kinds).toEqual(['retrieved', 'cited']);
    expect(raw.prepare('SELECT COUNT(*) as n FROM ai_check_brands WHERE check_id = ?').get(checkId)).toEqual({ n: 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ai-engines/migration.test.ts`
Expected: FAIL (migration file missing / `ai_visibility_checks` has no `model` column).

- [ ] **Step 3: Write the migration**

`workers/migrations/2026-09-07-ai-engines-v2.sql`:

```sql
-- AI Engines v2: real ChatGPT/Gemini answers through one engine layer.
-- Adds per-check provenance (model, locale), the new `retrieved` evidence
-- (page fetched but not cited), citation kind, and named brand entities.
-- All additive. The pre-v2 worker ignores every column here.
--
-- Run BEFORE deploying the worker that writes them:
--   CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
--     npx wrangler d1 execute datawise-db --remote --file=migrations/2026-09-07-ai-engines-v2.sql

ALTER TABLE ai_visibility_checks ADD COLUMN model TEXT;
ALTER TABLE ai_visibility_checks ADD COLUMN location_code INTEGER;
ALTER TABLE ai_visibility_checks ADD COLUMN language_code TEXT;
ALTER TABLE ai_visibility_checks ADD COLUMN retrieved_url TEXT;

-- 'cited' (attributed source) or 'retrieved' (fetched during search, not cited).
ALTER TABLE ai_check_citations ADD COLUMN kind TEXT NOT NULL DEFAULT 'cited';

CREATE TABLE IF NOT EXISTS ai_check_brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  is_you INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (check_id) REFERENCES ai_visibility_checks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_check_brands_check ON ai_check_brands(check_id);
```

- [ ] **Step 4: Mirror the AI tracking tables in schema.sql**

Append to `workers/src/db/schema.sql` (after the last table):

```sql
-- AI Visibility Tracker (migrations 2026-06-09, 2026-06-10, 2026-09-07).
CREATE TABLE IF NOT EXISTS ai_tracked_queries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  query_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'custom',
  keyword_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES seo_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_tracked_queries_project ON ai_tracked_queries(project_id);

CREATE TABLE IF NOT EXISTS ai_visibility_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  status TEXT NOT NULL,
  citation_position INTEGER,
  cited_url TEXT,
  answer_excerpt TEXT,
  run_type TEXT NOT NULL DEFAULT 'scheduled',
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  answer_text TEXT,
  model TEXT,
  location_code INTEGER,
  language_code TEXT,
  retrieved_url TEXT,
  FOREIGN KEY (query_id) REFERENCES ai_tracked_queries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_checks_query_engine ON ai_visibility_checks(query_id, engine, id);
CREATE INDEX IF NOT EXISTS idx_ai_checks_checked_at ON ai_visibility_checks(checked_at);

CREATE TABLE IF NOT EXISTS ai_check_citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  url TEXT,
  position INTEGER,
  kind TEXT NOT NULL DEFAULT 'cited',
  FOREIGN KEY (check_id) REFERENCES ai_visibility_checks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_citations_check ON ai_check_citations(check_id);
CREATE INDEX IF NOT EXISTS idx_ai_citations_domain ON ai_check_citations(domain);

CREATE TABLE IF NOT EXISTS ai_check_brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  is_you INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (check_id) REFERENCES ai_visibility_checks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_check_brands_check ON ai_check_brands(check_id);
```

Before appending, check whether `seo_projects` in schema.sql already has `ai_tracking_enabled`, `ai_brand_terms`, `ai_engines` (`grep -n "ai_tracking_enabled" workers/src/db/schema.sql`). If missing, add those three columns to the `seo_projects` CREATE TABLE in schema.sql as well (`ai_tracking_enabled INTEGER DEFAULT 0, ai_brand_terms TEXT, ai_engines TEXT`). Verify `seo_projects` has `location_code INTEGER DEFAULT 2840` and `language_code TEXT` (it does at lines 143 and 154).

- [ ] **Step 5: Run the migration test and the full suite**

Run: `npx vitest run src/ai-engines/migration.test.ts && npx vitest run`
Expected: PASS; full suite green.

- [ ] **Step 6: Commit**

```sh
git add workers/migrations/2026-09-07-ai-engines-v2.sql workers/src/db/schema.sql workers/src/ai-engines/migration.test.ts
git commit -m "feat(db): ai-engines-v2 migration (model, locale, retrieved, citation kind, brands) and schema mirror"
```

---

### Task 5: Tracker on the engine layer behind the `ai-engines-v2` flag

**Files:**
- Modify: `workers/src/routes/ai-tracking.ts`
- Modify: `workers/src/routes/ai-recommendations.ts` (add `retrieved` status + play + Gemini label)
- Test: `workers/src/routes/ai-tracking-v2.test.ts`, extend `workers/src/routes/ai-recommendations.test.ts`

**Interfaces:**
- Consumes: `runEngine`, `classify`, `EngineTaskError`, `ALL_ENGINES`, `EngineId`, `Locale`, `DEFAULT_LOCALE`, `NormalizedAnswer` from `../ai-engines`.
- Produces: `export const AI_ENGINES_V2_FLAG = 'ai-engines-v2'`; `export async function isEnginesV2Enabled(env): Promise<boolean>`; `export async function runChecksForProject(env, project, queries, runType, budget?)` (now exported, same summary shape plus `retrieved: number`); `export function projectLocale(project): Locale`; `ProjectRow` gains `location_code`, `language_code`; `AIEngine` type becomes `EngineId`; `ALL_AI_ENGINES` re-exports `ALL_ENGINES`. `handleAIReport` trend rows gain `retrieved` and `legacy` (count of checks with null model). `MAX_CHECKS_PER_SCHEDULED_RUN = 1000`.

- [ ] **Step 1: Extend recommendations for `retrieved` (failing test first)**

Append to `workers/src/routes/ai-recommendations.test.ts`:

```ts
import { buildRecommendation } from './ai-recommendations';

describe('retrieved recommendation', () => {
  it('ranks a retrieved-not-cited engine between absent and mentioned', () => {
    const rec = buildRecommendation('best crm', [
      { engine: 'gemini', status: 'cited', citation_position: 1, citations: [] },
      { engine: 'chatgpt', status: 'retrieved', citation_position: null, citations: [{ domain: 'datawiseseo.com', url: 'https://datawiseseo.com/crm', position: 1 }] },
    ], 'datawiseseo.com');
    expect(rec.title).toMatch(/fetched|not cited/i);
    expect(rec.body).toContain('https://datawiseseo.com/crm');
    expect(rec.body).toContain('ChatGPT');
  });
});
```

Run: `npx vitest run src/routes/ai-recommendations.test.ts`
Expected: FAIL (type error on `'retrieved'` or wrong title).

- [ ] **Step 2: Implement in ai-recommendations.ts**

Change the `EngineCheck.status` union to `'cited' | 'mentioned' | 'retrieved' | 'absent' | 'no_answer' | 'error'`, add `gemini: 'Gemini'` to `ENGINE_LABELS`, and insert after the `absent` play in `buildRecommendation` (before the `mentioned` block):

```ts
  const retrieved = usable.find(c => c.status === 'retrieved');
  if (retrieved) {
    const own = retrieved.citations.find(c => isUserDomain(c.domain, userDomain));
    const url = own?.url ? ` (${own.url})` : '';
    return {
      title: `${label(retrieved.engine)} fetched your page but did not cite it`,
      body: `${label(retrieved.engine)} pulled your page${url} while answering "${query}" and left it out of the answer. Add a 40-60 word answer capsule at the top of that page that answers the question directly, include one sourced statistic, and make the page title match the question.`,
      priority: 'high',
    };
  }
```

Run: `npx vitest run src/routes/ai-recommendations.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing tracker test**

`workers/src/routes/ai-tracking-v2.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import type { NormalizedAnswer } from '../ai-engines';

const runEngineMock = vi.fn();
vi.mock('../ai-engines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai-engines')>();
  return { ...actual, runEngine: (...args: unknown[]) => runEngineMock(...args) };
});

import { runChecksForProject, projectLocale, isEnginesV2Enabled, AI_ENGINES_V2_FLAG } from './ai-tracking';

const answer = (over: Partial<NormalizedAnswer>): NormalizedAnswer => ({
  engine: 'chatgpt', model: 'gpt-x', answerText: 'HubSpot is popular', answerMarkdown: '', cited: [], retrieved: [], brands: [], ads: [], fanOut: [], ...over,
});

function makeEnv() {
  const { d1, raw } = createTestDb();
  const kv = new Map<string, string>([[AI_ENGINES_V2_FLAG, '1']]);
  raw.prepare("INSERT INTO seo_projects (id, user_id, name, domain, location_code, language_code) VALUES ('p1', 'u1', 'DataWise', 'datawiseseo.com', 2724, 'es')").run();
  raw.prepare("INSERT INTO ai_tracked_queries (id, project_id, query_text) VALUES ('q1', 'p1', 'mejor herramienta seo')").run();
  const env = { DB: d1, KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } }, DATAFORSEO_EMAIL: 'x', DATAFORSEO_PASSWORD: 'y' } as any;
  return { env, raw, kv };
}
const project = { id: 'p1', user_id: 'u1', name: 'DataWise', domain: 'datawiseseo.com', ai_tracking_enabled: 1, ai_brand_terms: null, ai_engines: JSON.stringify(['chatgpt', 'gemini']), location_code: 2724, language_code: 'es' };

beforeEach(() => runEngineMock.mockReset());

describe('projectLocale', () => {
  it('uses the project locale and defaults to US/EN', () => {
    expect(projectLocale(project)).toEqual({ location_code: 2724, language_code: 'es' });
    expect(projectLocale({ ...project, location_code: null, language_code: null })).toEqual({ location_code: 2840, language_code: 'en' });
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
      if (engine === 'chatgpt') return answer({ engine: 'chatgpt', retrieved: [{ url: 'https://datawiseseo.com/g', domain: 'datawiseseo.com', title: null, position: 1 }], cited: [{ url: 'https://reddit.com/r', domain: 'reddit.com', title: null, position: 1 }], brands: [{ name: 'HubSpot', category: 'company', urls: [] }, { name: 'DataWise', category: 'company', urls: [] }] });
      return answer({ engine: 'gemini', model: '3.5 Flash-Lite', cited: [{ url: 'https://blog.datawiseseo.com/p', domain: 'blog.datawiseseo.com', title: null, position: 2 }] });
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

  it('does not touch the engine layer when the flag is off', async () => {
    const { env, kv } = makeEnv();
    kv.delete(AI_ENGINES_V2_FLAG);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [] }] }] }), { status: 200 })));
    await runChecksForProject(env, { ...project, ai_engines: JSON.stringify(['perplexity']) }, [{ id: 'q1', query_text: 'x' }], 'manual');
    expect(runEngineMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/routes/ai-tracking-v2.test.ts`
Expected: FAIL (`runChecksForProject` / `projectLocale` / `isEnginesV2Enabled` not exported).

- [ ] **Step 5: Implement in ai-tracking.ts**

Edits, top of file: replace the local engine type and constant with the engine layer, add the flag and cap change:

```ts
import { runEngine, classify, EngineTaskError, ALL_ENGINES, DEFAULT_LOCALE, isVisibleStatus,
  type EngineId, type Locale, type NormalizedAnswer } from '../ai-engines';

export type AIEngine = EngineId;
export const ALL_AI_ENGINES: AIEngine[] = ALL_ENGINES;
// KV flag: set any value to route checks through the v2 engine layer (real
// ChatGPT/Gemini scraper answers). Unset = legacy path. Removed after one
// clean Monday run in production.
export const AI_ENGINES_V2_FLAG = 'ai-engines-v2';
export async function isEnginesV2Enabled(env: Env): Promise<boolean> {
  return !!(await env.KV.get(AI_ENGINES_V2_FLAG));
}
const MAX_CHECKS_PER_SCHEDULED_RUN = 1000;
```

`ProjectRow` gains `location_code: number | null; language_code: string | null;` and every `SELECT ... FROM seo_projects` in this file (`runScheduledAIChecks`, `getOwnedProject`) adds `location_code, language_code` to the column list.

Add:

```ts
export function projectLocale(project: { location_code?: number | null; language_code?: string | null }): Locale {
  const location = Number(project.location_code);
  const language = (project.language_code || '').trim().toLowerCase();
  return {
    location_code: Number.isFinite(location) && location > 0 ? location : DEFAULT_LOCALE.location_code,
    language_code: language || DEFAULT_LOCALE.language_code,
  };
}
```

Legacy path: keep `buildEngineRequest`, `callEngine`, `parseEngineResponse`, `classifyAnswer` as they are today (they become dead code once the flag is removed). The legacy `buildEngineRequest` throws for `gemini` (`throw new Error('gemini requires ai-engines-v2')`) so an explicit-Gemini project on the legacy path records an error instead of calling Perplexity by accident.

Rewrite `runChecksForProject` (export it) so the body branches once on the flag:

```ts
export async function runChecksForProject(
  env: Env, project: ProjectRow, queries: QueryRow[], runType: 'scheduled' | 'manual', budget?: { remaining: number }
): Promise<{ checks: number; cited: number; mentioned: number; retrieved: number; errors: number; skipped_fresh: number }> {
  const v2 = await isEnginesV2Enabled(env);
  const engines = projectEngines(project);
  const brandTerms = parseJsonArray(project.ai_brand_terms) || defaultBrandTerms(project);
  const locale = projectLocale(project);
  const summary = { checks: 0, cited: 0, mentioned: 0, retrieved: 0, errors: 0, skipped_fresh: 0 };
  if (!queries.length || !engines.length) return summary;

  const placeholders = queries.map(() => '?').join(',');
  const { results: freshRows } = await env.DB.prepare(`
    SELECT query_id, engine FROM ai_visibility_checks
    WHERE query_id IN (${placeholders}) AND status != 'error'
      AND checked_at >= datetime('now', '-${FRESHNESS_HOURS} hours')
  `).bind(...queries.map(q => q.id)).all();
  const fresh = new Set((freshRows as any[] || []).map(r => `${r.query_id}|${r.engine}`));

  for (const query of queries) {
    const due = engines.filter(e => !fresh.has(`${query.id}|${e}`));
    summary.skipped_fresh += engines.length - due.length;
    if (!due.length) continue;
    if (budget && budget.remaining < due.length) break;
    if (budget) budget.remaining -= due.length;

    const checkedAt = nowSql();
    const settled = await Promise.allSettled(due.map(async (engine) => {
      if (v2) {
        const answer = await runEngine(env, engine, query.query_text, locale, { ttlSeconds: ENGINE_CACHE_TTL_SECONDS, timeoutMs: ENGINE_TIMEOUT_MS });
        return { kind: 'v2' as const, answer, classification: classify(answer, project.domain, brandTerms) };
      }
      const data = await callEngine(env, engine, query.query_text);
      const parsed = parseEngineResponse(data);
      return { kind: 'legacy' as const, parsed, classification: classifyAnswer(parsed, project.domain, brandTerms) };
    }));

    for (let i = 0; i < settled.length; i++) {
      const engine = due[i];
      const outcome = settled[i];
      summary.checks++;

      if (outcome.status === 'rejected') {
        summary.errors++;
        const reason = outcome.reason;
        console.error(`AI check failed [${engine}] "${query.query_text}":`, reason instanceof Error ? reason.message : reason);
        await env.DB.prepare(
          'INSERT INTO ai_visibility_checks (query_id, engine, status, run_type, checked_at, location_code, language_code) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(query.id, engine, 'error', runType, checkedAt, locale.location_code, locale.language_code).run();
        continue;
      }

      const status = outcome.value.classification.status;
      if (status === 'cited') summary.cited++;
      if (status === 'mentioned') summary.mentioned++;
      if (status === 'retrieved') summary.retrieved++;

      if (outcome.value.kind === 'v2') {
        await persistV2Check(env, query.id, engine, outcome.value.answer, outcome.value.classification, runType, checkedAt, locale, project.domain, brandTerms);
      } else {
        await persistLegacyCheck(env, query.id, engine, outcome.value.parsed, outcome.value.classification, runType, checkedAt);
      }
    }
  }
  return summary;
}
```

`persistLegacyCheck` is the existing insert block (moved verbatim into a function: the `INSERT INTO ai_visibility_checks (query_id, engine, status, citation_position, cited_url, answer_excerpt, answer_text, run_type, checked_at)` plus the citations batch). `persistV2Check`:

```ts
async function persistV2Check(
  env: Env, queryId: string, engine: AIEngine, answer: NormalizedAnswer, c: ReturnType<typeof classify>,
  runType: 'scheduled' | 'manual', checkedAt: string, locale: Locale, projectDomain: string, brandTerms: string[]
): Promise<void> {
  const inserted = await env.DB.prepare(`
    INSERT INTO ai_visibility_checks
      (query_id, engine, status, citation_position, cited_url, retrieved_url, answer_excerpt, answer_text, run_type, checked_at, model, location_code, language_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    queryId, engine, c.status, c.citation_position, c.cited_url, c.retrieved_url, c.answer_excerpt,
    answer.answerText ? answer.answerText.slice(0, 10_000) : null,
    runType, checkedAt, answer.model, locale.location_code, locale.language_code,
  ).run();
  const checkId = inserted.meta?.last_row_id;
  if (!checkId) return;

  const stmts: D1PreparedStatement[] = [];
  for (const cite of answer.cited.slice(0, 30)) {
    stmts.push(env.DB.prepare('INSERT INTO ai_check_citations (check_id, domain, url, position, kind) VALUES (?, ?, ?, ?, ?)').bind(checkId, cite.domain, cite.url, cite.position, 'cited'));
  }
  for (const page of answer.retrieved.slice(0, 30)) {
    stmts.push(env.DB.prepare('INSERT INTO ai_check_citations (check_id, domain, url, position, kind) VALUES (?, ?, ?, ?, ?)').bind(checkId, page.domain, page.url, page.position, 'retrieved'));
  }
  const target = normalizeDomain(projectDomain);
  const termKeys = new Set(brandTerms.map(t => t.trim().toLowerCase()).filter(t => t.length >= 3));
  for (const brand of answer.brands.slice(0, 50)) {
    const isYou = termKeys.has(brand.name.trim().toLowerCase())
      || (!!target && brand.urls.some(u => { const d = normalizeDomain(u); return !!d && domainsMatch(d, target); }));
    stmts.push(env.DB.prepare('INSERT INTO ai_check_brands (check_id, name, category, is_you) VALUES (?, ?, ?, ?)').bind(checkId, brand.name, brand.category, isYou ? 1 : 0));
  }
  for (let j = 0; j < stmts.length; j += 50) {
    await env.DB.batch(stmts.slice(j, j + 50));
  }
}
```

`runScheduledAIChecks`: add `retrieved: 0` to totals, count `projects_skipped_by_budget = projects.length - totals.projects` in the final log line. `handleRunAICheck` returns the summary unchanged (it now includes `retrieved`).

`handleGetAITracking`: select `c.retrieved_url, c.model` too and include `retrieved_url` and `model` in each engine result; the citations query adds `kind` and only `kind = 'cited'` rows feed the 10-item evidence list, while a separate `retrieved: [...]` list (max 5) is attached from `kind = 'retrieved'` rows. The `EngineCheck` passed to `buildRecommendation` uses `citations` = cited rows, and for `retrieved` status uses the retrieved rows (so the play can name the URL).

`handleAIReport` trend SQL adds:

```sql
      SUM(CASE WHEN c.status = 'retrieved' THEN 1 ELSE 0 END) as retrieved,
      SUM(CASE WHEN c.model IS NULL THEN 1 ELSE 0 END) as legacy
```

Share-of-voice SQL adds `AND cc.kind = 'cited'`.

- [ ] **Step 6: Run the tracker tests, then the full suite and typecheck**

Run: `npx vitest run src/routes/ai-tracking-v2.test.ts && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all PASS; tsc has no errors in `ai-tracking.ts`, `ai-recommendations.ts`, `ai-engines/*`.

- [ ] **Step 7: Commit**

```sh
git add workers/src/routes/ai-tracking.ts workers/src/routes/ai-recommendations.ts workers/src/routes/ai-tracking-v2.test.ts workers/src/routes/ai-recommendations.test.ts
git commit -m "feat(ai-tracking): engine layer behind ai-engines-v2 flag, project locale, retrieved status, brands"
```

---

### Task 6: Routes: engine-check, dashboard visibility-check, remove Claude/Gemini API routes

**Files:**
- Create: `workers/src/routes/ai-engine-check.ts`
- Modify: `workers/src/routes/ai.ts` (delete `handleClaudeSearch`, `handleGeminiSearch`; rewrite `handleVisibilityCheck`)
- Modify: `workers/src/index.ts` (imports, routes)
- Delete: `workers/src/routes/ai-engine-models.test.ts` cases for Claude/Gemini (keep ChatGPT/Perplexity cases and the tracker `buildEngineRequest` cases)
- Test: `workers/src/routes/ai-engine-check.test.ts`, extend `workers/src/routes/ai-engine-models.test.ts`

**Interfaces:**
- Produces: `handleEngineCheck(request, env): Promise<Response>` for `POST /api/ai/engine-check` with body `{ engine: EngineId; query: string; location_code?: number; language_code?: string; brand_domain?: string; brand_terms?: string[] }` returning `{ answer: NormalizedAnswer; classification: Classification | null; engine: EngineId; locale: Locale }`; `handleVisibilityCheck` response gains `gemini: boolean` per result and `engines_total: 4`.

- [ ] **Step 1: Write the failing route tests**

`workers/src/routes/ai-engine-check.test.ts`:

```ts
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
    const res = await handleEngineCheck(post({ engine: 'chatgpt', query: 'best crm', location_code: 2826, language_code: 'en', brand_domain: 'https://www.hubspot.com/' }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.engine).toBe('chatgpt');
    expect(body.locale).toEqual({ location_code: 2826, language_code: 'en' });
    expect(body.answer.cited.length).toBeGreaterThan(0);
    expect(body.classification.status).toBe('mentioned');
    expect(body.classification.matched_brand).toBe('HubSpot');
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
```

Extend `workers/src/routes/ai-engine-models.test.ts`: remove the Claude and Gemini `it` blocks and their imports, and add:

```ts
import { handleVisibilityCheck } from './ai';
import aiModeFixture from '../ai-engines/__fixtures__/ai_mode.json';

describe('POST /api/ai/visibility-check (dashboard card)', () => {
  it('marks Google AI Mode visible when a reference cites the domain and reports four engines', async () => {
    const empty = { status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [] }] }] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/models')) return new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ model_name: 'sonar', web_search_supported: true }] }] }), { status: 200 });
      if (url.includes('/serp/google/ai_mode/')) return new Response(JSON.stringify(aiModeFixture), { status: 200 });
      return new Response(JSON.stringify(empty), { status: 200 });
    }));
    const res = await handleVisibilityCheck(req({ domain: 'reddit.com', keywords: ['best crm'] }), env, 'user-1');
    const body = await res.json() as any;
    expect(body.engines_total).toBe(4);
    expect(body.results[0]).toMatchObject({ keyword: 'best crm', google_ai: true, chatgpt: false, gemini: false, perplexity: false });
    expect(body.engines_visible).toBe(1);
  });
});
```

(`req` and `env` already exist in that file; `env.KV` there must also support `put` for the cache, which it does.)

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/routes/ai-engine-check.test.ts src/routes/ai-engine-models.test.ts`
Expected: FAIL (module missing; `gemini` undefined / `engines_total` 3).

- [ ] **Step 3: Write ai-engine-check.ts**

```ts
import type { Env } from '../index';
import { runEngine, classify, isEngineId, EngineTaskError, DEFAULT_LOCALE, type Locale } from '../ai-engines';
import { DataForSeoQuotaError } from '../dataforseo/client';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const INSTANT_CACHE_TTL_SECONDS = 3600;
const INSTANT_TIMEOUT_MS = 90_000;

// POST /api/ai/engine-check (credit-gated in index.ts). Instant Check's single
// route: one engine, one query, optional brand for a verdict.
export async function handleEngineCheck(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const engine = body.engine;
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!isEngineId(engine)) return json({ error: 'engine must be one of google_ai_mode, chatgpt, gemini, perplexity' }, 400);
  if (!query) return json({ error: 'query is required' }, 400);
  if (query.length > 500) return json({ error: 'query must be 500 characters or fewer' }, 400);

  const locationCode = Number(body.location_code);
  const languageCode = typeof body.language_code === 'string' ? body.language_code.trim().toLowerCase() : '';
  const locale: Locale = {
    location_code: Number.isFinite(locationCode) && locationCode > 0 ? locationCode : DEFAULT_LOCALE.location_code,
    language_code: languageCode || DEFAULT_LOCALE.language_code,
  };
  const brandDomain = typeof body.brand_domain === 'string' ? body.brand_domain.trim() : '';
  const brandTerms = Array.isArray(body.brand_terms) ? body.brand_terms.filter((t): t is string => typeof t === 'string') : [];

  try {
    const answer = await runEngine(env, engine, query, locale, { ttlSeconds: INSTANT_CACHE_TTL_SECONDS, timeoutMs: INSTANT_TIMEOUT_MS });
    const classification = brandDomain ? classify(answer, brandDomain, brandTerms) : null;
    return json({ engine, locale, answer, classification });
  } catch (err) {
    if (err instanceof DataForSeoQuotaError) throw err;
    if (err instanceof EngineTaskError) return json({ error: 'DataForSEO request failed', detail: err.message }, 502);
    return json({ error: 'AI engine request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}
```

- [ ] **Step 4: Rewrite `handleVisibilityCheck` in ai.ts and delete the Claude/Gemini handlers**

Delete `handleClaudeSearch` and `handleGeminiSearch` (lines 128 to 166 today). Add the import `import { runEngine, classify, isVisibleStatus, ALL_ENGINES, DEFAULT_LOCALE, type EngineId } from '../ai-engines';` and replace the body of `handleVisibilityCheck` after the input validation with:

```ts
  const limitedKeywords = keywords.slice(0, 3);
  const engineKeys: Record<EngineId, 'google_ai' | 'chatgpt' | 'gemini' | 'perplexity'> = {
    google_ai_mode: 'google_ai', chatgpt: 'chatgpt', gemini: 'gemini', perplexity: 'perplexity',
  };
  const project = await env.DB.prepare(
    'SELECT location_code, language_code FROM seo_projects WHERE user_id = ? AND lower(domain) = lower(?) ORDER BY ai_tracking_enabled DESC, created_at ASC LIMIT 1'
  ).bind(userId, domain).first() as { location_code?: number | null; language_code?: string | null } | null;
  const locale = {
    location_code: project?.location_code && project.location_code > 0 ? project.location_code : DEFAULT_LOCALE.location_code,
    language_code: project?.language_code?.trim().toLowerCase() || DEFAULT_LOCALE.language_code,
  };

  const results: Array<{ keyword: string; google_ai: boolean; chatgpt: boolean; gemini: boolean; perplexity: boolean }> = [];
  for (const keyword of limitedKeywords) {
    const row = { keyword, google_ai: false, chatgpt: false, gemini: false, perplexity: false };
    await Promise.all(ALL_ENGINES.map(async (engine) => {
      try {
        const answer = await runEngine(env, engine, keyword, locale, { ttlSeconds: 86400, timeoutMs: 60_000 });
        row[engineKeys[engine]] = isVisibleStatus(classify(answer, domain, []).status);
      } catch (err) {
        console.error(`visibility-check [${engine}] "${keyword}":`, err instanceof Error ? err.message : err);
      }
    }));
    results.push(row);
  }

  const enginesVisible = new Set<string>();
  for (const r of results) {
    for (const key of ['google_ai', 'chatgpt', 'gemini', 'perplexity'] as const) if (r[key]) enginesVisible.add(key);
  }

  const summary = {
    domain,
    keywords_checked: limitedKeywords,
    results,
    engines_visible: enginesVisible.size,
    engines_total: ALL_ENGINES.length,
    checked_at: new Date().toISOString(),
  };
  const cacheKey = `ai-visibility:${userId}:${domain}`;
  await env.KV.put(cacheKey, JSON.stringify(summary), { expirationTtl: 86400 });
  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
```

If `seo_projects` has no `created_at` column, drop it from the ORDER BY (check with `grep -n "created_at" workers/src/db/schema.sql` near the `seo_projects` table). The test env for `handleVisibilityCheck` needs `env.DB`; in `ai-engine-models.test.ts` extend `env` with `DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) }`.

- [ ] **Step 5: Wire index.ts**

- Import: remove `handleClaudeSearch, handleGeminiSearch` from the `./routes/ai` import; add `import { handleEngineCheck } from './routes/ai-engine-check';`.
- Routes: delete the two `if (path === '/api/ai/claude-search' ...` and `gemini-search` blocks; add after the `perplexity` block:

```ts
      if (path === '/api/ai/engine-check' && method === 'POST') {
        return await withCredit(() => handleEngineCheck(request, env));
      }
```

- [ ] **Step 6: Run the route tests, full suite, typecheck**

Run: `npx vitest run src/routes/ && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; no tsc errors in changed files.

- [ ] **Step 7: Commit**

```sh
git add workers/src/routes/ai-engine-check.ts workers/src/routes/ai.ts workers/src/index.ts workers/src/routes/ai-engine-check.test.ts workers/src/routes/ai-engine-models.test.ts
git commit -m "feat(api): engine-check route, dashboard visibility check on the engine layer, drop Claude/Gemini API routes"
```

---

### Task 7: SPA libs: engines, statuses, engine-check client

**Files:**
- Modify: `src/lib/ai-tracking.ts`
- Create: `src/lib/ai-engines.ts`
- Modify: `src/lib/ai-visibility.ts`
- Modify: `src/components/rank-tracking/ai/EngineLogo.tsx`
- Delete: `src/components/LLMEngineTab.tsx`
- Test: `src/lib/__tests__/ai-engines.test.ts`

**Interfaces:**
- Produces: `AIEngine` = 4 ids; `AI_ENGINE_LABELS/SHORT_LABELS/COLORS/ORDER` with `gemini`; `AICheckStatus` includes `retrieved`; `AI_OUTCOME_COLORS.retrieved`; `AIEngineResult` gains `retrieved_url?: string | null; model?: string | null; retrieved?: AICitation[]`; `AITrendPoint` gains `retrieved: number; legacy?: number`. `src/lib/ai-engines.ts`: `EngineId`, `NormalizedAnswer`, `Classification`, `EngineCheckResponse`, `fetchEngineCheck(params)`, `verdictFor(classification, engineLabel): { label: string; tone: 'cited' | 'mentioned' | 'retrieved' | 'absent' | 'none' }`, `competitorDomains(answer, brandDomain): Array<{ domain: string; count: number }>`.

- [ ] **Step 1: Write the failing lib test**

`src/lib/__tests__/ai-engines.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { verdictFor, competitorDomains, type NormalizedAnswer } from '../ai-engines';
import { AI_ENGINE_ORDER, AI_OUTCOME_COLORS } from '../ai-tracking';

const answer: NormalizedAnswer = {
  engine: 'chatgpt', model: null, answerText: '', answerMarkdown: '',
  cited: [
    { url: 'https://a.com/1', domain: 'a.com', title: null, position: 1 },
    { url: 'https://a.com/2', domain: 'a.com', title: null, position: 2 },
    { url: 'https://me.com/x', domain: 'me.com', title: null, position: 3 },
  ],
  retrieved: [], brands: [], ads: [], fanOut: [],
};

describe('engine constants', () => {
  it('lists four engines in order and a retrieved outcome color', () => {
    expect(AI_ENGINE_ORDER).toEqual(['google_ai_mode', 'chatgpt', 'gemini', 'perplexity']);
    expect(AI_OUTCOME_COLORS.retrieved).toBeTruthy();
  });
});

describe('verdictFor', () => {
  it('describes each status', () => {
    expect(verdictFor({ status: 'cited', citation_position: 2, cited_url: 'u', retrieved_url: null, answer_excerpt: null, matched_brand: null }, 'ChatGPT'))
      .toEqual({ label: 'Cited by ChatGPT at #2', tone: 'cited' });
    expect(verdictFor({ status: 'mentioned', citation_position: null, cited_url: null, retrieved_url: null, answer_excerpt: null, matched_brand: 'DataWise' }, 'Gemini'))
      .toEqual({ label: 'Mentioned by Gemini as "DataWise", not linked', tone: 'mentioned' });
    expect(verdictFor({ status: 'retrieved', citation_position: null, cited_url: null, retrieved_url: 'u', answer_excerpt: null, matched_brand: null }, 'ChatGPT'))
      .toEqual({ label: 'ChatGPT fetched your page but did not cite it', tone: 'retrieved' });
    expect(verdictFor({ status: 'absent', citation_position: null, cited_url: null, retrieved_url: null, answer_excerpt: null, matched_brand: null }, 'Perplexity'))
      .toEqual({ label: 'Not in the Perplexity answer', tone: 'absent' });
    expect(verdictFor(null, 'ChatGPT')).toEqual({ label: 'Add your domain to see a verdict', tone: 'none' });
  });
});

describe('competitorDomains', () => {
  it('counts cited domains excluding the brand, most cited first', () => {
    expect(competitorDomains(answer, 'https://www.me.com')).toEqual([{ domain: 'a.com', count: 2 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run from `datawise-seo-insight-main/`: `npx vitest run src/lib/__tests__/ai-engines.test.ts`
Expected: FAIL (module missing / order has 3 engines).

- [ ] **Step 3: Update ai-tracking.ts**

Replace the engine block at the top with:

```ts
export type AIEngine = 'google_ai_mode' | 'chatgpt' | 'gemini' | 'perplexity';

export const AI_ENGINE_LABELS: Record<AIEngine, string> = {
  google_ai_mode: 'Google AI Mode',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
};

export const AI_ENGINE_SHORT_LABELS: Record<AIEngine, string> = {
  google_ai_mode: 'Google AI',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
};

// Fixed engine colors (never cycled, never reordered); validated palette.
export const AI_ENGINE_COLORS: Record<AIEngine, string> = {
  google_ai_mode: '#1F7A43',
  chatgpt: '#2563EB',
  gemini: '#7C3AED',
  perplexity: '#D97706',
};

export const AI_ENGINE_ORDER: AIEngine[] = ['google_ai_mode', 'chatgpt', 'gemini', 'perplexity'];

// Answer-outcome ramp: dark to light equals strong to no visibility.
// `retrieved` sits between mentioned and absent: fetched, not used.
export const AI_OUTCOME_COLORS = {
  cited: '#1F7A43',
  mentioned: '#8FC5A6',
  retrieved: '#F3E3B8',
  absent: '#EDF1EE',
} as const;

export type AICheckStatus = 'cited' | 'mentioned' | 'retrieved' | 'absent' | 'no_answer' | 'error';
```

`AIEngineResult` gains `retrieved_url?: string | null; model?: string | null; retrieved?: AICitation[];`. `AITrendPoint` gains `retrieved: number; legacy?: number;`. `runAICheck` return type gains `retrieved: number`.

- [ ] **Step 4: Create ai-engines.ts, update ai-visibility.ts and EngineLogo.tsx, delete LLMEngineTab.tsx**

`src/lib/ai-engines.ts`:

```ts
import { api } from './api';
import { cleanTrackingDomain, type AIEngine } from './ai-tracking';

export type EngineId = AIEngine;

export interface AnswerSource { url: string | null; domain: string; title: string | null; position: number }
export interface AnswerBrand { name: string; category: string | null; urls: string[] }
export interface AnswerAd { domain: string | null; advertiser: string | null; rendered: boolean }

export interface NormalizedAnswer {
  engine: EngineId;
  model: string | null;
  answerText: string;
  answerMarkdown: string;
  cited: AnswerSource[];
  retrieved: AnswerSource[];
  brands: AnswerBrand[];
  ads: AnswerAd[];
  fanOut: string[];
}

export interface Classification {
  status: 'cited' | 'mentioned' | 'retrieved' | 'absent' | 'no_answer';
  citation_position: number | null;
  cited_url: string | null;
  retrieved_url: string | null;
  answer_excerpt: string | null;
  matched_brand: string | null;
}

export interface EngineCheckResponse {
  engine: EngineId;
  locale: { location_code: number; language_code: string };
  answer: NormalizedAnswer;
  classification: Classification | null;
}

export async function fetchEngineCheck(params: {
  engine: EngineId;
  query: string;
  location_code?: number;
  language_code?: string;
  brand_domain?: string;
  brand_terms?: string[];
}) {
  return api<EngineCheckResponse>('/api/ai/engine-check', { method: 'POST', body: params });
}

export type VerdictTone = 'cited' | 'mentioned' | 'retrieved' | 'absent' | 'none';

export function verdictFor(c: Classification | null, engineLabel: string): { label: string; tone: VerdictTone } {
  if (!c) return { label: 'Add your domain to see a verdict', tone: 'none' };
  switch (c.status) {
    case 'cited':
      return { label: `Cited by ${engineLabel}${c.citation_position ? ` at #${c.citation_position}` : ''}`, tone: 'cited' };
    case 'mentioned':
      return { label: `Mentioned by ${engineLabel}${c.matched_brand ? ` as "${c.matched_brand}"` : ''}, not linked`, tone: 'mentioned' };
    case 'retrieved':
      return { label: `${engineLabel} fetched your page but did not cite it`, tone: 'retrieved' };
    case 'no_answer':
      return { label: `${engineLabel} returned no answer`, tone: 'absent' };
    default:
      return { label: `Not in the ${engineLabel} answer`, tone: 'absent' };
  }
}

export function competitorDomains(answer: NormalizedAnswer, brandDomain: string): Array<{ domain: string; count: number }> {
  const me = cleanTrackingDomain(brandDomain);
  const counts = new Map<string, number>();
  for (const s of answer.cited) {
    if (me && (s.domain === me || s.domain.endsWith(`.${me}`) || me.endsWith(`.${s.domain}`))) continue;
    counts.set(s.domain, (counts.get(s.domain) || 0) + 1);
  }
  return Array.from(counts, ([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count);
}
```

`src/lib/ai-visibility.ts`: add `gemini: boolean;` to the `results` item type.

`EngineLogo.tsx`: add before the final Perplexity return:

```tsx
  if (engine === 'gemini') {
    return (
      <svg viewBox="0 0 24 24" className={`${className} flex-shrink-0`} aria-hidden="true">
        <path fill="#7C3AED" d="M12 0c.6 6.4 5.6 11.4 12 12-6.4.6-11.4 5.6-12 12C11.4 17.6 6.4 12.6 0 12 6.4 11.4 11.4 6.4 12 0z" />
      </svg>
    );
  }
```

Delete `src/components/LLMEngineTab.tsx` (`git rm`).

- [ ] **Step 5: Run the lib test and the SPA typecheck**

Run: `npx vitest run src/lib/__tests__/ai-engines.test.ts && npx tsc --noEmit -p tsconfig.app.json`
Expected: test PASS; tsc reports only errors in files this task has not touched yet (AnswerStatusMatrix/KpiRail/RightRail may complain about missing `retrieved`; Task 8 fixes them). If tsc shows errors inside `ai-tracking.ts`, `ai-engines.ts`, `ai-visibility.ts` or `EngineLogo.tsx`, fix them now.

- [ ] **Step 6: Commit**

```sh
git add src/lib/ai-tracking.ts src/lib/ai-engines.ts src/lib/ai-visibility.ts src/components/rank-tracking/ai/EngineLogo.tsx src/lib/__tests__/ai-engines.test.ts
git rm -q src/components/LLMEngineTab.tsx
git commit -m "feat(spa): gemini engine, retrieved status, engine-check client, drop orphaned LLMEngineTab"
```

---

### Task 8: Performance tab renders `retrieved`, Gemini, and the cutover marker

**Files:**
- Modify: `src/components/rank-tracking/ai/AnswerStatusMatrix.tsx`
- Modify: `src/components/rank-tracking/ai/KpiRail.tsx`
- Modify: `src/components/rank-tracking/ai/RightRail.tsx`
- Modify: `src/components/rank-tracking/AIVisibilityPanel.tsx` (only if it hardcodes a 3-column layout for engines; `AI_ENGINE_ORDER.map` already drives the picker)
- Modify: `src/components/dashboard/GEOVisibilityCard.tsx`

No DOM test runner exists in the SPA; verification is `tsc` plus staging. Keep changes minimal and typed.

- [ ] **Step 1: AnswerStatusMatrix**

In `Cell`, add a case before `absent`:

```tsx
    case 'retrieved':
      return <div className={`${base} text-[#7A5A12]`} style={{ background: AI_OUTCOME_COLORS.retrieved }} title={result.retrieved_url ? `Fetched ${result.retrieved_url}, not cited` : 'Fetched, not cited'}>Fetch.</div>;
```

Add to `STATUS_META`: `retrieved: { text: 'Fetched, not cited', fg: '#A67A12' },`. In `EngineDetail`, where the citation list renders, if `result.status === 'retrieved' && result.retrieved_url`, render one line above the list: `<p className="text-xs text-muted-foreground">Fetched but not cited: <a className="underline" href={result.retrieved_url} target="_blank" rel="noreferrer">{result.retrieved_url}</a></p>`. Any grid that sizes columns from `engines.length` keeps working with four; check for a hardcoded `grid-cols-3` and switch it to `grid-cols-4` or a computed class.

- [ ] **Step 2: KpiRail**

In the stats loop add `let retrieved = 0;` and `if (result.status === 'retrieved') retrieved += 1;`; return `retrieved` in the memo. Where the tiles render, add a fifth tile only when `stats.retrieved > 0`: label "Fetched, not cited", value `stats.retrieved`, helper text "pages AI pulled but left out". Deltas ignore it.

- [ ] **Step 3: RightRail trend tooltip and stacking**

In `TrendMiniCard`'s per-date aggregation add `retrieved` and `legacy`:

```ts
      row.retrieved += point.retrieved ?? 0;
      row.legacy += point.legacy ?? 0;
      row.absent += Math.max(0, point.total - point.cited - point.mentioned - (point.retrieved ?? 0));
```

(initialize both to 0 in the row default). Where the tooltip text for a date is built, append `row.legacy === row.total ? ' · API model' : row.legacy > 0 ? ' · mixed' : ' · real answers'` so the cutover week reads as a source change, and render the `retrieved` slice with `AI_OUTCOME_COLORS.retrieved` between mentioned and absent in the stacked bar.

- [ ] **Step 4: GEOVisibilityCard**

Replace the `engines` constant with:

```ts
  const engines = [
    { key: 'google_ai', label: 'Google AI' },
    { key: 'chatgpt', label: 'ChatGPT' },
    { key: 'gemini', label: 'Gemini' },
    { key: 'perplexity', label: 'Perplexity' },
  ] as const;
```

and guard the per-engine read for cached summaries from before this release: `const visible = summary.results.some((r) => (r as Record<string, unknown>)[engine.key] === true);`.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors in the five files above (errors in `AIOverview.tsx` are expected until Task 9 only if it references removed fetchers; today it does not, so expect a clean run).

```sh
git add src/components/rank-tracking/ai/AnswerStatusMatrix.tsx src/components/rank-tracking/ai/KpiRail.tsx src/components/rank-tracking/ai/RightRail.tsx src/components/dashboard/GEOVisibilityCard.tsx
git commit -m "feat(spa): retrieved status, Gemini and cutover marker in the Performance tab and dashboard card"
```

(Include `AIVisibilityPanel.tsx` in the `git add` only if it changed.)

---

### Task 9: Instant Check on one EngineResultPanel

**Files:**
- Create: `src/components/ai-visibility/EngineResultPanel.tsx`
- Rewrite: `src/pages/AIOverview.tsx`
- Modify: `src/lib/dataforseo.ts` (remove `fetchChatGPTSearch`, `fetchPerplexitySearch`, `fetchGoogleAIMode` once nothing imports them)
- Modify: `scripts/deploy-pages-production.mjs` (markers)
- Modify: `src/lib/export/adapters/aiVisibility.ts` only if its input type no longer compiles

- [ ] **Step 1: Check the export adapter's input**

Run: `grep -n "export function\|interface\|type " src/lib/export/adapters/aiVisibility.ts | head -20` and note the shape it expects. The new page builds that shape from `NormalizedAnswer` (`content` = `answerMarkdown`, `sources` = cited mapped to `{ title, url, domain }`, plus the verdict as `brand_cited`/`citation_position`). If the adapter expects fields the normalized answer cannot provide, keep those as `null`/`[]`.

- [ ] **Step 2: Write EngineResultPanel.tsx**

```tsx
import ReactMarkdown from 'react-markdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Megaphone } from 'lucide-react';
import { AI_ENGINE_LABELS, AI_OUTCOME_COLORS, cleanTrackingDomain } from '@/lib/ai-tracking';
import { verdictFor, competitorDomains, type EngineCheckResponse, type VerdictTone } from '@/lib/ai-engines';
import EngineLogo from '@/components/rank-tracking/ai/EngineLogo';

interface EngineResultPanelProps {
  result: EngineCheckResponse;
  brandDomain: string;
}

const TONE_STYLE: Record<VerdictTone, { bg: string; fg: string }> = {
  cited: { bg: AI_OUTCOME_COLORS.cited, fg: '#FFFFFF' },
  mentioned: { bg: AI_OUTCOME_COLORS.mentioned, fg: '#0F4A28' },
  retrieved: { bg: AI_OUTCOME_COLORS.retrieved, fg: '#7A5A12' },
  absent: { bg: AI_OUTCOME_COLORS.absent, fg: '#5A6968' },
  none: { bg: '#F1F4F2', fg: '#5A6968' },
};

function isOwn(domain: string, brandDomain: string) {
  const me = cleanTrackingDomain(brandDomain);
  return !!me && (domain === me || domain.endsWith(`.${me}`) || me.endsWith(`.${domain}`));
}

export default function EngineResultPanel({ result, brandDomain }: EngineResultPanelProps) {
  const { answer, classification, engine } = result;
  const label = AI_ENGINE_LABELS[engine];
  const verdict = verdictFor(classification, label);
  const tone = TONE_STYLE[verdict.tone];
  const competitors = brandDomain ? competitorDomains(answer, brandDomain).slice(0, 5) : [];
  const renderedAds = answer.ads.filter((ad) => ad.rendered);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <EngineLogo engine={engine} className="h-6 w-6" />
          <span className="rounded-full px-3 py-1 text-sm font-semibold" style={{ background: tone.bg, color: tone.fg }}>{verdict.label}</span>
          {answer.model && <Badge variant="outline" className="text-xs">{answer.model}</Badge>}
          <Badge variant="outline" className="text-xs">{result.locale.location_code} · {result.locale.language_code}</Badge>
          {renderedAds.length > 0 && (
            <Badge variant="secondary" className="gap-1 text-xs"><Megaphone className="h-3 w-3" />Sponsored results: {renderedAds.map((ad) => ad.advertiser || ad.domain).filter(Boolean).join(', ')}</Badge>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">What {label} answered</CardTitle></CardHeader>
          <CardContent className="prose prose-sm max-w-none dark:prose-invert">
            {answer.answerMarkdown ? <ReactMarkdown>{answer.answerMarkdown}</ReactMarkdown> : <p className="text-muted-foreground">No answer text was returned.</p>}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Cited sources ({answer.cited.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {answer.cited.length === 0 && <p className="text-sm text-muted-foreground">No sources were cited.</p>}
              {answer.cited.map((s) => {
                const own = isOwn(s.domain, brandDomain);
                return (
                  <div key={`${s.position}-${s.url ?? s.domain}`} className={`flex items-start gap-2 rounded-md px-2 py-1 text-sm ${own ? 'bg-[#E3F1E9]' : ''}`}>
                    <span className="w-6 shrink-0 text-xs font-bold tabular-nums text-muted-foreground">#{s.position}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.title || s.domain}</div>
                      <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {s.domain}{own && <Badge className="ml-1 h-4 px-1 text-[10px]">you</Badge>}
                        {s.url && <a href={s.url} target="_blank" rel="noreferrer" aria-label="Open source"><ExternalLink className="h-3 w-3" /></a>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {answer.retrieved.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Fetched, not cited ({answer.retrieved.length})</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {answer.retrieved.slice(0, 10).map((s) => (
                  <div key={`${s.position}-${s.url ?? s.domain}`} className={`truncate text-sm ${isOwn(s.domain, brandDomain) ? 'font-semibold' : 'text-muted-foreground'}`}>{s.domain}{s.url && <> · <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.url}</a></>}</div>
                ))}
              </CardContent>
            </Card>
          )}

          {answer.brands.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Brands named</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {answer.brands.map((b) => <Badge key={b.name} variant="outline">{b.name}{b.category ? ` · ${b.category}` : ''}</Badge>)}
              </CardContent>
            </Card>
          )}

          {competitors.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Most cited competitors</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {competitors.map((c) => <div key={c.domain} className="flex justify-between text-sm"><span>{c.domain}</span><span className="tabular-nums text-muted-foreground">{c.count}</span></div>)}
              </CardContent>
            </Card>
          )}

          {answer.fanOut.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Sub-queries the engine ran</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {answer.fanOut.map((q) => <Badge key={q} variant="secondary">{q}</Badge>)}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite AIOverview.tsx**

Keep the existing imports for `Tabs`, `Card`, `Button`, `Input`, `Label`, `Select`, `useToast`, `Brain`, `locationOptions`/`languageOptions`, `usePersistentState` (inspect the current file's import block and reuse the same names). The new page:

```tsx
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Brain, Loader2 } from 'lucide-react';
import { locationOptions, languageOptions } from '@/lib/dataForSeoLocations';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { AI_ENGINE_LABELS, AI_ENGINE_ORDER, type AIEngine } from '@/lib/ai-tracking';
import { fetchEngineCheck, type EngineCheckResponse } from '@/lib/ai-engines';
import EngineResultPanel from '@/components/ai-visibility/EngineResultPanel';
import EngineLogo from '@/components/rank-tracking/ai/EngineLogo';

type Results = Partial<Record<AIEngine, EngineCheckResponse>>;

export default function AIOverview() {
  const [activeTab, setActiveTab] = usePersistentState<AIEngine>('ai-overview:engine', 'google_ai_mode');
  const [keyword, setKeyword] = usePersistentState<string>('ai-overview:keyword', '');
  const [brandDomain, setBrandDomain] = usePersistentState<string>('ai-overview:brand', '');
  const [location, setLocation] = usePersistentState<string>('ai-overview:location', '2840');
  const [language, setLanguage] = usePersistentState<string>('ai-overview:language', 'en');
  const [results, setResults] = usePersistentState<Results>('ai-overview:results', {});
  const [loading, setLoading] = useState<AIEngine | null>(null);
  const { toast } = useToast();

  const analyze = async (engine: AIEngine) => {
    if (!keyword.trim()) {
      toast({ title: 'Enter a prompt', description: 'Type the question you want to check.', variant: 'destructive' });
      return;
    }
    setLoading(engine);
    try {
      const res = await fetchEngineCheck({
        engine,
        query: keyword.trim(),
        location_code: parseInt(location, 10),
        language_code: language,
        brand_domain: brandDomain.trim() || undefined,
      });
      setResults({ ...results, [engine]: res });
    } catch (error: any) {
      toast({ title: `${AI_ENGINE_LABELS[engine]} check failed`, description: error?.message || 'Try again in a moment.', variant: 'destructive' });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="container mx-auto space-y-8 p-6">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold"><Brain className="h-8 w-8 text-primary" />AI Search Tracker</h1>
        <p className="text-muted-foreground">See what Google AI Mode, ChatGPT, Gemini and Perplexity actually answer, and whether they cite you.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Instant Check</CardTitle>
          <CardDescription>One prompt, one engine at a time. ChatGPT and Gemini answers come from the real interface.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2 md:col-span-2">
            <Label>Prompt</Label>
            <Input placeholder="best crm for small business" value={keyword} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && analyze(activeTab)} />
          </div>
          <div className="space-y-2">
            <Label>Your domain (optional)</Label>
            <Input placeholder="yourdomain.com" value={brandDomain} onChange={(e) => setBrandDomain(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{locationOptions.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{languageOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AIEngine)} className="w-full">
        <TabsList className="inline-flex">
          {AI_ENGINE_ORDER.map((engine) => (
            <TabsTrigger key={engine} value={engine} className="gap-2"><EngineLogo engine={engine} />{AI_ENGINE_LABELS[engine]}</TabsTrigger>
          ))}
        </TabsList>
        {AI_ENGINE_ORDER.map((engine) => (
          <TabsContent key={engine} value={engine} className="space-y-6">
            <div className="flex items-center gap-3">
              <Button onClick={() => analyze(engine)} disabled={loading !== null}>
                {loading === engine ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking {AI_ENGINE_LABELS[engine]}</> : `Check ${AI_ENGINE_LABELS[engine]}`}
              </Button>
              <span className="text-xs text-muted-foreground">1 credit per check. Results are cached for an hour.</span>
            </div>
            {results[engine] ? (
              <EngineResultPanel result={results[engine]!} brandDomain={brandDomain} />
            ) : (
              <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Run a check to see the {AI_ENGINE_LABELS[engine]} answer, its sources and whether you appear.</CardContent></Card>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
```

Before writing, confirm the real import paths in the current `AIOverview.tsx` for `useToast`, `usePersistentState`, `locationOptions` and `languageOptions` (`sed -n '1,25p' src/pages/AIOverview.tsx`) and use those exact paths. If the page currently offers an `ExportMenu`, keep it: mount it inside the result area with the adapter input built from `results[engine].answer` as described in Step 1.

- [ ] **Step 4: Remove dead fetchers and update the deploy guard**

In `src/lib/dataforseo.ts` delete `fetchGoogleAIMode`, `fetchChatGPTSearch`, `fetchPerplexitySearch` after `grep -rn "fetchChatGPTSearch\|fetchPerplexitySearch\|fetchGoogleAIMode" src` shows no remaining importers.

In `scripts/deploy-pages-production.mjs` `REQUIRED_SOURCE_MARKERS`, add:

```js
  ['Instant Check renders the engine result panel', 'src/pages/AIOverview.tsx', '<EngineResultPanel'],
  ['Instant Check drives tabs from the engine order', 'src/pages/AIOverview.tsx', 'AI_ENGINE_ORDER.map'],
  ['Engine order includes Gemini', 'src/lib/ai-tracking.ts', "'google_ai_mode', 'chatgpt', 'gemini', 'perplexity'"],
```

and to `FORBIDDEN_SOURCE_MARKERS` (create the array next to the required one if it does not exist, following the same tuple shape):

```js
  ['Old per-engine Instant Check fetcher', 'src/pages/AIOverview.tsx', 'fetchChatGPTSearch'],
```

- [ ] **Step 5: Typecheck, lint, build with the guard in check mode**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run deploy:pages:check`
Expected: no type errors; lint passes for changed files; the guard passes (build succeeds, all markers present).

- [ ] **Step 6: Commit**

```sh
git add src/components/ai-visibility/EngineResultPanel.tsx src/pages/AIOverview.tsx src/lib/dataforseo.ts scripts/deploy-pages-production.mjs
git commit -m "feat(spa): Instant Check on one EngineResultPanel with four engines"
```

(Add `src/lib/export/adapters/aiVisibility.ts` if it changed.)

---

### Task 10: Rollout to staging

**Files:** none new. Uses `DEPLOY.md`, memory `feedback_staging_to_live_sequence`, `feedback_prod_d1_migrations`.

- [ ] **Step 1: Check the live worker provenance**

Run: `gh pr list --base production --state open --json number,headRefName` and `cd workers && CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 npx wrangler versions list | tail -4`.
If PR #136 (`fix/content-writer-external-citations`) is still open, the worker must be deployed from this branch merged with that branch (see the 2026-09-06 note in DEPLOY.md), not from this branch alone.

- [ ] **Step 2: Push the branch and open the PR**

```sh
git push -u origin feat/ai-engines-v2
gh pr create --base production --head feat/ai-engines-v2 --title "feat: AI Engines v2, real ChatGPT/Gemini answers across tracker, Instant Check and dashboard" --body-file docs/superpowers/plans/2026-09-07-ai-engines-v2-pr-body.md
```

Write the PR body file first: why (gpt-4o proxy, drifted parsers, dashboard bug), what (engine layer, four engines, retrieved status, locale, flag), migration, verification (test counts), rollout (flag off by default), rollback, and the session trailer. Delete the body file after creating the PR (do not commit it).

- [ ] **Step 3: Apply the D1 migration to production (additive)**

```sh
cd datawise-seo-insight-main/workers
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 npx wrangler d1 execute datawise-db --remote --file=migrations/2026-09-07-ai-engines-v2.sql
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 npx wrangler d1 execute datawise-db --remote --json --command "PRAGMA table_info(ai_visibility_checks)" | grep -c '"name"'
```

Expected: the second command prints 14 (10 old columns plus `answer_text`, `model`, `location_code`, `language_code`, `retrieved_url` = 15 if `answer_text` counts; confirm the four new names appear).

- [ ] **Step 4: Deploy the worker with the flag unset**

From a tree that is this branch merged with any open-PR worker code found in Step 1:

```sh
cd datawise-seo-insight-main/workers && npx vitest run && CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 npm run deploy
```

Record the version id. Verify the flag is unset: `npx wrangler kv key get --binding KV ai-engines-v2` returns nothing (or the dashboard shows no key).

- [ ] **Step 5: Staging SPA**

```sh
git push origin feat/ai-engines-v2:staging --force
```

Wait for the "Deploy DataWise Pages Staging" workflow, then open `https://staging.datawise-118.pages.dev`.

- [ ] **Step 6: Verify with the flag off, then on**

Flag off: Instant Check works on all four tabs (new route is additive). Performance tab loads; a manual check still runs the legacy path (three engines).

Turn the flag on:

```sh
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 npx wrangler kv key put --binding KV ai-engines-v2 1
```

(If `--binding` is unsupported by the installed wrangler, use `--namespace-id` with the KV id from `wrangler.toml`.) On staging: enable Gemini on Nico's project, run a manual check, confirm four rows per prompt with statuses, `model` populated, retrieved rows where applicable:

```sh
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 npx wrangler d1 execute datawise-db --remote --json --command "SELECT engine, status, model, location_code, language_code FROM ai_visibility_checks ORDER BY id DESC LIMIT 8"
```

Dashboard card shows 4 engines. Report the findings to Nico with the staging URL and stop. Merge only on his explicit yes; then tag `prod-<UTC>`, append tag + worker version to DEPLOY.md via a docs commit on a fresh branch, and update memory.

---

## Self-review

**Spec coverage:** Section 3 (engine layer): Tasks 1-3. Section 4 (classification): Task 3. Section 5 (storage): Task 4. Section 6 (tracker, flag, cap, error status, excerpt, recommendations, report): Task 5. Section 7 (routes): Task 6. Section 8 (frontend incl. deploy guard, LLMEngineTab removal, default location 2840): Tasks 7-9. Section 9 (testing): each task. Section 10 (rollout): Task 10. Section 11 (cost): no code. Out of scope items untouched.

**Placeholder scan:** none.

**Type consistency:** `NormalizedAnswer`, `Classification`, `EngineId`, `Locale` are defined in Task 1/3 and mirrored verbatim in Task 7's SPA lib. `runChecksForProject` summary gains `retrieved` in Task 5 and the SPA type in Task 7. `handleVisibilityCheck` result keys (`google_ai`, `chatgpt`, `gemini`, `perplexity`) match `GEOVisibilityCard` and `ai-visibility.ts`.
