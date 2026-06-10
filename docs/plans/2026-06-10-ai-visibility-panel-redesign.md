# AI Visibility Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the AI Search Visibility panel into verdict strip + actionable query cards + cited-terms discovery, per `docs/specs/2026-06-10-ai-visibility-panel-redesign.md`.

**Architecture:** Worker gains a pure recommendation module (rule-based, tested with vitest), an additive `answer_text` column, and richer payloads on existing routes. SPA panel splits into five small components under `src/components/rank-tracking/ai/`. Discovery reuses the existing `/api/llm-mentions/search` route via `fetchLlmSearch`.

**Tech Stack:** Cloudflare Worker (TS, manual routing), D1, vitest (new, worker only), React 18 + Tailwind + shadcn.

**Working directory:** `/tmp/gsc-incremental` (worktree). All paths below are relative to `datawise-seo-insight-main/`.

---

### Task 1: Branch + vitest setup for the worker

**Files:**
- Modify: `workers/package.json`

- [ ] **Step 1: Create branch off the rank-tracking branch**

```bash
cd /tmp/gsc-incremental && git checkout -b feat/ai-visibility-panel-v2 feat/rank-tracking-improvements
```

- [ ] **Step 2: Add vitest**

```bash
cd datawise-seo-insight-main/workers && npm install -D vitest@^3
```

Add to `workers/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Smoke test the runner**

Create `workers/src/routes/ai-recommendations.test.ts` with a placeholder-free trivial test (replaced in Task 2):

```ts
import { describe, it, expect } from 'vitest';
describe('vitest wiring', () => {
  it('runs', () => { expect(1 + 1).toBe(2); });
});
```

Run: `npm test` → expect 1 passed. Delete this describe block in Task 2 when real tests land.

- [ ] **Step 4: Commit**

```bash
git add datawise-seo-insight-main/workers/package.json datawise-seo-insight-main/workers/package-lock.json datawise-seo-insight-main/workers/src/routes/ai-recommendations.test.ts
git commit -m "chore(workers): add vitest"
```

---

### Task 2: Pure recommendation module (TDD)

**Files:**
- Create: `workers/src/routes/ai-recommendations.ts`
- Modify: `workers/src/routes/ai-recommendations.test.ts`

The module is pure (no Env, no D1) so it is unit-testable and reusable.

- [ ] **Step 1: Write the failing tests** (replace Task 1's smoke block entirely)

```ts
import { describe, it, expect } from 'vitest';
import { buildRecommendation, classifyCitationUrl, type EngineCheck } from './ai-recommendations';

const cite = (domain: string, url: string | null = null, position = 1) => ({ domain, url, position });

describe('classifyCitationUrl', () => {
  it('detects listicles by path', () => {
    expect(classifyCitationUrl('semrush.com', 'https://semrush.com/blog/best-ai-seo-tools')).toBe('listicle');
  });
  it('detects community domains', () => {
    expect(classifyCitationUrl('reddit.com', 'https://reddit.com/r/SEO/x')).toBe('community');
  });
  it('detects directories', () => {
    expect(classifyCitationUrl('g2.com', null)).toBe('directory');
  });
  it('falls back to editorial', () => {
    expect(classifyCitationUrl('searchengineland.com', 'https://searchengineland.com/some-news')).toBe('editorial');
  });
});

describe('buildRecommendation', () => {
  const q = 'best ai seo tool';

  it('rule 1: absent with listicle competitors -> comparison play, high priority', () => {
    const checks: EngineCheck[] = [
      { engine: 'perplexity', status: 'absent', citation_position: null, citations: [cite('semrush.com', 'https://semrush.com/blog/best-ai-seo-tools'), cite('backlinko.com', 'https://backlinko.com/ai-seo-tools', 2)] },
      { engine: 'google_ai_mode', status: 'cited', citation_position: 2, citations: [cite('semrush.com'), cite('airankingskool.com', null, 2)] },
    ];
    const rec = buildRecommendation(q, checks);
    expect(rec.priority).toBe('high');
    expect(rec.title).toContain('Perplexity');
    expect(rec.body).toContain('comparison');
  });

  it('rule 1: absent with directory competitors -> get listed', () => {
    const checks: EngineCheck[] = [
      { engine: 'chatgpt', status: 'absent', citation_position: null, citations: [cite('g2.com'), cite('capterra.com', null, 2)] },
    ];
    const rec = buildRecommendation(q, checks);
    expect(rec.body).toMatch(/listing|listed/i);
    expect(rec.body).toContain('g2.com');
  });

  it('rule 2: mentioned but not cited -> citability play', () => {
    const checks: EngineCheck[] = [
      { engine: 'chatgpt', status: 'mentioned', citation_position: null, citations: [cite('semrush.com')] },
    ];
    const rec = buildRecommendation(q, checks);
    expect(rec.priority).toBe('high');
    expect(rec.body).toMatch(/citable|FAQ/i);
  });

  it('rule 3: cited below #3 -> climb play, medium priority', () => {
    const checks: EngineCheck[] = [
      { engine: 'google_ai_mode', status: 'cited', citation_position: 6, citations: [cite('semrush.com'), cite('airankingskool.com', 'https://airankingskool.com/post', 6)] },
    ];
    const rec = buildRecommendation(q, checks);
    expect(rec.priority).toBe('medium');
    expect(rec.body).toMatch(/refresh|improve/i);
  });

  it('rule 4: cited top-3 everywhere -> defend, low priority, names top competitor', () => {
    const checks: EngineCheck[] = [
      { engine: 'google_ai_mode', status: 'cited', citation_position: 1, citations: [cite('airankingskool.com', null, 1), cite('semrush.com', null, 2)] },
    ];
    const rec = buildRecommendation(q, checks);
    expect(rec.priority).toBe('low');
    expect(rec.body).toContain('semrush.com');
  });

  it('rule 5: no answer anywhere -> informational', () => {
    const checks: EngineCheck[] = [
      { engine: 'perplexity', status: 'no_answer', citation_position: null, citations: [] },
    ];
    const rec = buildRecommendation(q, checks);
    expect(rec.priority).toBe('low');
    expect(rec.title).toMatch(/no ai answer/i);
  });

  it('absent beats cited-below-3 when both present', () => {
    const checks: EngineCheck[] = [
      { engine: 'google_ai_mode', status: 'cited', citation_position: 7, citations: [] },
      { engine: 'perplexity', status: 'absent', citation_position: null, citations: [cite('semrush.com', 'https://semrush.com/blog/best-tools')] },
    ];
    expect(buildRecommendation(q, checks).title).toContain('Perplexity');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd workers && npm test` → expect FAIL: cannot resolve `./ai-recommendations`.

- [ ] **Step 3: Implement `workers/src/routes/ai-recommendations.ts`**

```ts
// Rule-based "What to do" recommendations for the AI Search Visibility panel.
// Pure module: no Env, no D1, fully unit-tested. See
// docs/specs/2026-06-10-ai-visibility-panel-redesign.md for the rule table.

export interface RecCitation { domain: string; url: string | null; position: number }
export interface EngineCheck {
  engine: string;
  status: 'cited' | 'mentioned' | 'absent' | 'no_answer' | 'error';
  citation_position: number | null;
  citations: RecCitation[];
}
export interface Recommendation { title: string; body: string; priority: 'high' | 'medium' | 'low' }

const ENGINE_LABELS: Record<string, string> = {
  google_ai_mode: 'Google AI Mode', chatgpt: 'ChatGPT', perplexity: 'Perplexity',
};
const COMMUNITY_DOMAINS = ['reddit.com', 'quora.com', 'news.ycombinator.com'];
const DIRECTORY_DOMAINS = ['g2.com', 'capterra.com', 'clutch.co', 'trustpilot.com', 'yelp.com', 'producthunt.com'];
const LISTICLE_PATTERN = /best|top-|top\d|[-/]vs[-/]|comparison|tools|alternatives/i;

export type CitationCategory = 'listicle' | 'community' | 'directory' | 'editorial';

export function classifyCitationUrl(domain: string, url: string | null): CitationCategory {
  const d = domain.replace(/^www\./, '');
  if (COMMUNITY_DOMAINS.some(c => d === c || d.endsWith(`.${c}`))) return 'community';
  if (DIRECTORY_DOMAINS.some(c => d === c || d.endsWith(`.${c}`))) return 'directory';
  if (url) {
    try {
      const path = new URL(url).pathname;
      if (LISTICLE_PATTERN.test(path)) return 'listicle';
    } catch { /* fall through */ }
  }
  return 'editorial';
}

function label(engine: string): string { return ENGINE_LABELS[engine] || engine; }

function absentPlay(query: string, check: EngineCheck): Recommendation {
  const cites = check.citations.slice(0, 5);
  const byCategory = new Map<CitationCategory, RecCitation[]>();
  for (const c of cites) {
    const cat = classifyCitationUrl(c.domain, c.url);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(c);
  }
  let dominant: CitationCategory = 'editorial';
  let max = 0;
  for (const [cat, list] of byCategory) {
    if (list.length > max) { max = list.length; dominant = cat; }
  }
  const domains = (byCategory.get(dominant) || []).map(c => c.domain).slice(0, 3).join(', ');
  const title = `Win the ${label(check.engine)} citation`;
  let body: string;
  switch (dominant) {
    case 'listicle':
      body = `${label(check.engine)} cites comparison and listicle pages for this query (${domains}). Publish a comparison page targeting "${query}" with a feature table and a visible update date.`;
      break;
    case 'community':
      body = `${label(check.engine)} is citing community threads (${domains}). Participate in the cited threads with a substantive answer that references your page.`;
      break;
    case 'directory':
      body = `${label(check.engine)} cites review and directory listings here. Get or strengthen your listing on ${domains}.`;
      break;
    default:
      body = `${label(check.engine)} cites long-form editorial pages (${domains}). Publish an in-depth guide answering "${query}" with answer capsules and sourced stats.`;
  }
  if (cites.length === 0) {
    body = `${label(check.engine)} returned an answer without citing anyone for "${query}". Add citable stats and an FAQ block to your most relevant page so there is something to cite.`;
  }
  return { title, body, priority: 'high' };
}

export function buildRecommendation(query: string, checks: EngineCheck[]): Recommendation {
  const usable = checks.filter(c => c.status !== 'error');
  if (!usable.length) {
    return { title: 'No checks yet', body: 'Run a check to get recommendations for this query.', priority: 'low' };
  }

  const absent = usable.find(c => c.status === 'absent');
  if (absent) return absentPlay(query, absent);

  const mentioned = usable.find(c => c.status === 'mentioned');
  if (mentioned) {
    return {
      title: `Turn the ${label(mentioned.engine)} mention into a citation`,
      body: `The AI knows your brand but has no source worth linking. Add citable stats, an FAQ block, and answer capsules to your most relevant page for "${query}" so engines have something to cite.`,
      priority: 'high',
    };
  }

  const low = usable.find(c => c.status === 'cited' && (c.citation_position ?? 99) > 3);
  if (low) {
    const own = low.citations.find(c => c.position === low.citation_position);
    const url = own?.url ? ` (${own.url})` : '';
    return {
      title: `Climb the ${label(low.engine)} citations`,
      body: `You are cited at #${low.citation_position} on ${label(low.engine)}. Refresh the cited page${url}, add original data, and tighten the answer capsule for "${query}" to improve your citation rank.`,
      priority: 'medium',
    };
  }

  const cited = usable.find(c => c.status === 'cited');
  if (cited) {
    const rival = cited.citations.find(c => c.position !== cited.citation_position);
    return {
      title: 'Defend this query',
      body: `You are cited in the top 3. Keep the cited page fresh${rival ? `; ${rival.domain} is also being cited and could overtake you` : ''}.`,
      priority: 'low',
    };
  }

  return {
    title: 'No AI answer for this query',
    body: 'None of the checked engines currently return an AI answer here. No action needed; we keep monitoring.',
    priority: 'low',
  };
}
```

Note: the spec's rule 4 "fastest-rising competitor between two runs" needs check history that this pure function does not receive; wave 1 names the top co-cited domain from the latest run (covered by the rule 4 test). This simplification is intentional.

- [ ] **Step 4: Run tests** → `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add datawise-seo-insight-main/workers/src/routes/ai-recommendations.ts datawise-seo-insight-main/workers/src/routes/ai-recommendations.test.ts
git commit -m "feat(ai-tracking): rule-based recommendation module with tests"
```

---

### Task 3: Store full answer text

**Files:**
- Create: `workers/migrations/2026-06-10-ai-checks-answer-text.sql`
- Modify: `workers/src/routes/ai-tracking.ts` (the INSERT in `runChecksForProject`, around line 272)

- [ ] **Step 1: Migration file**

```sql
-- Store the full AI answer per visibility check so users can read exactly
-- what the engine said. Additive; old rows stay NULL.
ALTER TABLE ai_visibility_checks ADD COLUMN answer_text TEXT;
```

- [ ] **Step 2: Apply to production D1**

```bash
cd datawise-seo-insight-main/workers && CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
  npx wrangler d1 execute datawise-db --remote --json --file=migrations/2026-06-10-ai-checks-answer-text.sql
```

Verify: `... --command "SELECT name FROM pragma_table_info('ai_visibility_checks') WHERE name='answer_text'"` returns one row.

- [ ] **Step 3: Writer change** in `runChecksForProject`. Replace the success INSERT:

```ts
      const inserted = await env.DB.prepare(`
        INSERT INTO ai_visibility_checks (query_id, engine, status, citation_position, cited_url, answer_excerpt, answer_text, run_type, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        query.id, engine, classification.status, classification.citation_position,
        classification.cited_url, classification.answer_excerpt,
        parsed.answerText ? parsed.answerText.slice(0, 10_000) : null,
        runType, checkedAt,
      ).run();
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add datawise-seo-insight-main/workers/migrations/2026-06-10-ai-checks-answer-text.sql datawise-seo-insight-main/workers/src/routes/ai-tracking.ts
git commit -m "feat(ai-tracking): store full answer text per check (additive migration)"
```

---

### Task 4: Worker API additions

**Files:**
- Modify: `workers/src/routes/ai-tracking.ts`
- Modify: `workers/src/index.ts` (route registration near the other `/api/rank-tracking/.../ai` routes)

- [ ] **Step 1: Raise the cap.** In `ai-tracking.ts`: `export const MAX_AI_QUERIES_PER_PROJECT = 20;` (was 10).

- [ ] **Step 2: Enrich `handleGetAITracking`.** Import at top: `import { buildRecommendation, type EngineCheck } from './ai-recommendations';`. The existing handler builds `byQuery` from a query+latest-check join. Extend it:

After the existing `byQuery` loop, add a citations fetch keyed by the latest check ids, then compute recommendations:

```ts
  // Citations for each latest check (the per-engine evidence lists).
  const checkIds = (queryRows as any[] || []).map(r => r.check_id).filter(Boolean);
  const citationsByCheck = new Map<number, Array<{ domain: string; url: string | null; position: number }>>();
  if (checkIds.length) {
    const placeholders = checkIds.map(() => '?').join(',');
    const { results: citeRows } = await env.DB.prepare(
      `SELECT check_id, domain, url, position FROM ai_check_citations
       WHERE check_id IN (${placeholders}) ORDER BY position ASC`
    ).bind(...checkIds).all();
    for (const row of (citeRows as any[] || [])) {
      if (!citationsByCheck.has(row.check_id)) citationsByCheck.set(row.check_id, []);
      const list = citationsByCheck.get(row.check_id)!;
      if (list.length < 10) list.push({ domain: row.domain, url: row.url, position: row.position });
    }
  }
```

This requires the latest-check SELECT in the handler to also return `c.id as check_id` (add it to the SELECT column list), and each engine entry in `byQuery` to carry `check_id: row.check_id` and `citations: citationsByCheck.get(row.check_id) || []`.

Then per query object before returning:

```ts
  for (const q of byQuery.values()) {
    const checks: EngineCheck[] = Object.entries(q.engines).map(([engine, e]: [string, any]) => ({
      engine, status: e.status, citation_position: e.citation_position, citations: e.citations || [],
    }));
    q.recommendation = buildRecommendation(q.query_text, checks);
  }
```

- [ ] **Step 3: Lazy answer endpoint.** New handler in `ai-tracking.ts`:

```ts
// GET /api/rank-tracking/ai/checks/:id/answer
export async function handleGetAIAnswer(env: Env, userId: string, checkId: string): Promise<Response> {
  const row = await env.DB.prepare(`
    SELECT c.answer_text FROM ai_visibility_checks c
    JOIN ai_tracked_queries q ON q.id = c.query_id
    JOIN seo_projects p ON p.id = q.project_id
    WHERE c.id = ? AND p.user_id = ?
  `).bind(checkId, userId).first() as any;
  if (!row) return json({ error: 'Check not found' }, 404);
  return json({ answer_text: row.answer_text ?? null });
}
```

Register in `index.ts` next to the other ai routes (pattern-match like the existing dynamic routes there):

```ts
      const aiAnswerMatch = path.match(/^\/api\/rank-tracking\/ai\/checks\/(\d+)\/answer$/);
      if (aiAnswerMatch && method === 'GET') {
        return addCors(await handleGetAIAnswer(env, user.id, aiAnswerMatch[1]));
      }
```

- [ ] **Step 4: Track-from-discovery source.** In `handleAddAIQueries`, accept an optional source: parse `{ queries }` items as `Array<{ text: string; keyword_id?: string; source?: string }>` and bind `q.source === 'discovery' ? 'discovery' : (existing default)` in the INSERT (inspect the current INSERT to keep its default for manual adds).

- [ ] **Step 5: Score in report.** In `handleAIReport`, the trend SELECT already returns `total`, `cited`, `mentioned` per date+engine. Add a JS map after fetching:

```ts
  const trend = (trendRows as any[] || []).map(r => ({
    ...r,
    score: r.total ? Math.round(((r.cited + 0.5 * r.mentioned) / r.total) * 100) : 0,
  }));
```

and return `trend` instead of the raw rows.

- [ ] **Step 6: Typecheck, test, commit**

```bash
npx tsc --noEmit && npm test
git add datawise-seo-insight-main/workers/src/routes/ai-tracking.ts datawise-seo-insight-main/workers/src/index.ts
git commit -m "feat(ai-tracking): citations + recommendations in payload, lazy answer endpoint, 20-query cap, trend score"
```

---

### Task 5: SPA lib + types

**Files:**
- Modify: `src/lib/ai-tracking.ts`

- [ ] **Step 1: Extend types.**

```ts
export interface AICitation { domain: string; url: string | null; position: number }
export interface AIRecommendation { title: string; body: string; priority: 'high' | 'medium' | 'low' }
```

In `AIEngineResult` add: `check_id?: number; citations?: AICitation[];`
In `AITrackedQuery` add: `recommendation?: AIRecommendation;`
In `AITrendPoint` add: `score?: number;`

- [ ] **Step 2: Add fetcher.**

```ts
export async function fetchAIAnswer(checkId: number) {
  return api<{ answer_text: string | null }>(`/api/rank-tracking/ai/checks/${checkId}/answer`);
}
```

(match the existing `api()` usage style in this file; if the file's helpers are untyped, follow them.)

- [ ] **Step 3: Commit**

```bash
git add datawise-seo-insight-main/src/lib/ai-tracking.ts
git commit -m "feat(ai-tracking): SPA types + answer fetcher for panel redesign"
```

---

### Task 6: SPA components

**Files:**
- Create: `src/components/rank-tracking/ai/VerdictStrip.tsx`
- Create: `src/components/rank-tracking/ai/RecommendationBlock.tsx`
- Create: `src/components/rank-tracking/ai/QueryCard.tsx`
- Create: `src/components/rank-tracking/ai/CitedTermsTab.tsx`
- Create: `src/components/rank-tracking/ai/ShareOfVoiceFooter.tsx`
- Modify: `src/components/rank-tracking/AIVisibilityPanel.tsx` (becomes the orchestrator: settings popover + tabs + data fetching stay here; rendering moves to the new components)

Implementation contracts (follow the approved mockup `.superpowers/brainstorm/71954-1781097250/content/design-final-v2.html` for visual treatment; white cards, #005232 accents, existing chip palette):

- [ ] **Step 1: `VerdictStrip`** — props `{ queries: AITrackedQuery[]; trend: AITrendPoint[]; engines: AIEngine[] }`. Computes: score (cited=1, mentioned=0.5 over latest results across enabled engines), cited/mentioned query counts, per-engine `cited+mentioned/total`, delta vs previous run date, sparkline (reuse recharts `LineChart` minimal, as other panels do). Three cards in a flex row.

- [ ] **Step 2: `RecommendationBlock`** — props `{ recommendation: AIRecommendation }`. Green `bg-[#005232] text-white rounded-xl p-4` block with uppercase "What to do" label, bold title, body text. Priority renders a small chip (high = white on red-ish accent, medium amber, low neutral).

- [ ] **Step 3: `QueryCard`** — props `{ query: AITrackedQuery; engines: AIEngine[]; onDelete: (id: string) => void }`. Collapsed row: query text + per-engine `StatusBadge` (move the existing `StatusBadge` from AIVisibilityPanel into this file) + chevron. Expanded (local `useState`): `RecommendationBlock`, two-column per-engine citation lists (`"<Engine> cited instead of you"` when absent, `"<Engine> citations"` otherwise; user's domain row highlighted with `bg-emerald-100`, "show all" beyond 5), and per-engine "Read full answer" buttons that call `fetchAIAnswer(check_id)` on first click and render the text in a scrollable `max-h-64` pre-wrap div, with a "not stored for older checks" fallback when null.

- [ ] **Step 4: `CitedTermsTab`** — props `{ domain: string; trackedQueryTexts: Set<string>; onTrack: (text: string) => Promise<void> }`. On mount (tab is rendered only when active, so mount = lazy): `fetchLlmSearch({ target: [{ domain, include_subdomains: true }], limit: 50 })` from `src/lib/llm-mentions.ts`. Render table: question, platform, `ai_search_volume`, first source URL path belonging to the user's domain, and a Track button (outline, disabled "Tracked" when `trackedQueryTexts.has(question.toLowerCase())`). Sort by `ai_search_volume` desc. Show 10 rows + "Show all N". Loading skeleton + empty state ("No AI answers citing {domain} found yet in the database").

- [ ] **Step 5: `ShareOfVoiceFooter`** — props `{ share: AIShareOfVoiceRow[]; domain: string }`. One line of the top 5 domains (`domain (citations)`), user's row bolded green with rank, "Full leaderboard" toggle revealing the full list with proportion bars (existing data from `fetchAIReport`).

- [ ] **Step 6: Rewrite `AIVisibilityPanel.tsx`** — keeps: enable/disable, settings popover (engines, brand terms), Run check button, data loading (`fetchAITracking`, `fetchAIReport`). New layout: `VerdictStrip`, then a two-tab switcher (`Tracked queries (N)` / `Terms you're cited for`), tab 1 = `QueryCard` list + existing add-query input, tab 2 = `CitedTermsTab` (its `onTrack` calls the existing `addAIQueries(project.id, [{ text, source: 'discovery' }])` then refetches), then `ShareOfVoiceFooter`. Delete the old matrix table and old trend chart JSX (trend now lives in the strip).

- [ ] **Step 7: Build + commit**

```bash
cd datawise-seo-insight-main && npm run build
git add datawise-seo-insight-main/src/components/rank-tracking/ai/ datawise-seo-insight-main/src/components/rank-tracking/AIVisibilityPanel.tsx datawise-seo-insight-main/src/lib/ai-tracking.ts
git commit -m "feat(ai-visibility): panel redesign with verdict strip, query cards, discovery tab"
```

---

### Task 7: Ship to staging + verify

- [ ] **Step 1:** `cd workers && npx tsc --noEmit && npm test && npm run deploy` → capture new version id for the rollback trail (previous: `809719ea`).
- [ ] **Step 2:** `git push -u origin feat/ai-visibility-panel-v2 && git push origin feat/ai-visibility-panel-v2:staging --force` → wait for the staging workflow to succeed.
- [ ] **Step 3:** Browser walk on `staging.datawise-118.pages.dev`: open a rank project with AI tracking enabled, run a check, verify: score math matches D1 (`SELECT status, COUNT(*) ... GROUP BY status` for the project's latest checks), expanded card shows citations with own domain highlighted, "Read full answer" returns text for fresh checks and the fallback for old ones, discovery tab loads terms and Track adds one (visible in tab 1 and in `ai_tracked_queries` with source 'discovery'), SoV footer matches `handleAIReport` share data.
- [ ] **Step 4:** Open PR into `production` (stacked on PR #49; note merge order #47 → #49 → this).
