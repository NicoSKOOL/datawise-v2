# AI Engines v2: real ChatGPT and Gemini answers across tracker, Instant Check, dashboard

Date: 2026-09-06
Status: approved in brainstorm (Nico), pending implementation plan
Branch: `feat/ai-engines-v2` off `production` (`79c8e79`, after PR #137)
Related: `docs/specs/2026-06-09-ai-visibility-tracker-design.md`, PR #137 (LLM model resolver), audit artifact "DataForSEO AI Optimization Gap Audit" (2026-09-06)

## 1. Problem

Every ChatGPT check in the app (AI Visibility Tracker cron and manual checks, Instant Check, dashboard GEO card) calls DataForSEO's LLM Responses API with `gpt-4o`, a 2024 API model, and treats its answer as "what ChatGPT says". Real ChatGPT users in 2026 see gpt-5.x with the consumer search layer. Members are paying for a proxy that does not match the product their customers use.

Three separate code paths call engines and read answers (`ai.ts` Instant Check handlers, `ai.ts` `handleVisibilityCheck`, `ai-tracking.ts` `callEngine` + `parseEngineResponse`). They drifted: the dashboard card tests a field AI Mode items do not carry, so its Google column is effectively always false; task-level DataForSEO errors inside HTTP 200 land as `no_answer` in the tracker.

DataForSEO's LLM Scraper (ChatGPT since 2025, Gemini since 2026-02-26) returns the real interface answer with cited sources, retrieved-but-uncited pages, named brand entities, ads, and fan-out queries, honors location and language, and costs a flat $0.004 per live check.

## 2. Decisions (from brainstorm, 2026-09-06)

| Decision | Choice |
|---|---|
| Primary goal | Truth: checks reflect what real ChatGPT and Gemini users see |
| Surfaces | Tracker (cron + manual), Instant Check, dashboard GEO card, all through one engine layer |
| Engines | `google_ai_mode`, `chatgpt` (scraper), `gemini` (scraper), `perplexity` (LLM Responses). Claude removed. |
| Locale | Tracker follows the project's `location_code` + `language_code`. Instant Check keeps its own picker. |
| Statuses | `cited`, `mentioned`, `retrieved` (new), `absent`, `no_answer`, plus `error` |
| Cron delivery | Live scraper calls (standard queue deferred; saving is ~$1.70/week at current cap) |
| Rollout | Staging first. New worker path gated behind KV flag `ai-engines-v2` until verified. |
| Approach | A: one engine layer with a normalized answer |

## 3. Engine layer (`workers/src/ai-engines/`)

### 3.1 Types (`types.ts`)

```ts
export type EngineId = 'google_ai_mode' | 'chatgpt' | 'gemini' | 'perplexity';
export const ALL_ENGINES: EngineId[] = ['google_ai_mode', 'chatgpt', 'gemini', 'perplexity'];

export interface Locale { location_code: number; language_code: string }

export interface AnswerSource { url: string | null; domain: string; title: string | null; position: number }
export interface AnswerBrand { name: string; category: string | null; urls: string[] }
export interface AnswerAd { domain: string | null; advertiser: string | null; rendered: boolean }

export interface NormalizedAnswer {
  engine: EngineId;
  model: string | null;          // what the provider reports; null for AI Mode
  answerText: string;            // plain text for matching (10k cap applied by caller)
  answerMarkdown: string;        // for display
  cited: AnswerSource[];         // sources the engine attributed the answer to
  retrieved: AnswerSource[];     // pages fetched during search but not cited
  brands: AnswerBrand[];         // named brand entities (ChatGPT only today)
  ads: AnswerAd[];               // sponsored placements seen in the answer
  fanOut: string[];              // sub-queries the engine ran
}

export interface EngineAdapter {
  id: EngineId;
  buildRequest(env: DataForSeoEnv, query: string, locale: Locale): Promise<{ endpoint: string; body: Record<string, unknown>[] }>;
  parse(raw: unknown): NormalizedAnswer;
}
```

### 3.2 Adapters

| Engine | Endpoint | Request | cited | retrieved | brands | ads | model |
|---|---|---|---|---|---|---|---|
| chatgpt | `POST /ai_optimization/chat_gpt/llm_scraper/live/advanced` | `keyword`, `location_code`, `language_code` | `result.sources[]` | `result.search_results[]` | `result.brand_entities[]` (+ per-item) | items of type `chat_gpt_ad` (`is_rendered`) | `result.model` |
| gemini | `POST /ai_optimization/gemini/llm_scraper/live/advanced` | `keyword`, `location_code`, `language_code` | `result.sources[]` (+ per `gemini_text` item) | none | none | none | `result.model` |
| google_ai_mode | `POST /serp/google/ai_mode/live/advanced` | `keyword`, `location_code`, `language_code`, `device: desktop`, `os: windows` | `references[]` on `ai_overview`/`ai_mode` items and nested elements | none | none | `ai_overview_paid_element` items | null |
| perplexity | `POST /ai_optimization/perplexity/llm_responses/live` | `user_prompt`, `model_name` via `resolveModel(env,'perplexity')`, `web_search_country_iso_code` from locale, `max_output_tokens: 2048` | `items[].sections[].annotations[]` | none | none | none | `result.model_name` |

Text: ChatGPT and Gemini use `result.markdown` (fallback: concatenated item markdown). AI Mode concatenates `text`/`markdown` of AI Mode elements. Perplexity concatenates section `text`. `answerText` strips markdown syntax for matching.

Sources are deduped by URL (fallback domain), positions assigned in encounter order, domains normalized (lowercase, no `www.`).

`web_search_country_iso_code` for Perplexity: a full `location_code -> ISO` table for the countries the app's location picker offers (`src/lib/dataForSeoLocations.ts`), generated into `workers/src/ai-engines/country-codes.ts`. Unknown codes fall back to `US`.

### 3.3 Runner (`index.ts`)

```ts
export async function runEngine(env, engine: EngineId, query: string, locale: Locale,
  opts: { ttlSeconds: number; timeoutMs: number }): Promise<NormalizedAnswer>
```

- Builds the request, calls `dataforseoRequestCached` (KV key already hashes endpoint + body, so locale differences never collide).
- Throws `EngineTaskError` when `getTaskError(raw)` is non-null. Callers map it to status `error` (tracker) or HTTP 502 with the DataForSEO message (routes). This replaces today's behavior where a 40xxx inside a 200 parses to `no_answer`.
- Default cache TTL 6 days / timeout 60s for the tracker (unchanged), 1h / 90s for Instant Check.

### 3.4 Removed

- `handleClaudeSearch`, `handleGeminiSearch` and their routes. `handleChatGPTSearch`, `handlePerplexitySearch`, `handleGoogleAIMode` stay for one release, reimplemented on top of `runEngine`, then removed.
- `src/components/LLMEngineTab.tsx` (orphaned).
- `parseEngineResponse` / `callEngine` / `buildEngineRequest` in `ai-tracking.ts`, replaced by the engine layer.

## 4. Classification (`workers/src/ai-engines/classify.ts`)

```ts
export type CheckStatus = 'cited' | 'mentioned' | 'retrieved' | 'absent' | 'no_answer';
export interface Classification {
  status: CheckStatus;
  citation_position: number | null;
  cited_url: string | null;
  retrieved_url: string | null;
  answer_excerpt: string | null;
  matched_brand: string | null;     // brand entity or term that triggered `mentioned`
}
export function classify(answer: NormalizedAnswer, projectDomain: string, brandTerms: string[]): Classification
```

Priority, first match wins:

1. `cited`: a `cited` source domain matches the project domain (`domainsMatch`: equal or subdomain either way). Position and URL recorded. Excerpt: sentence containing the citation marker when the engine gives text spans, otherwise first 300 characters of the answer.
2. `mentioned`: any brand entity name equals a brand term (case-insensitive, trimmed) or any brand entity URL domain matches the project domain; otherwise a brand term (length >= 3) matches `\bterm\b` case-insensitively in `answerText`. Excerpt: 60 chars before to 100 after the match (current behavior).
3. `retrieved`: a `retrieved` page domain matches the project domain. URL recorded in `retrieved_url`.
4. `no_answer`: `answerText` empty and no cited and no retrieved.
5. `absent`.

## 5. Storage (D1, additive migration `2026-09-06-ai-engines-v2.sql`)

```sql
ALTER TABLE ai_visibility_checks ADD COLUMN model TEXT;
ALTER TABLE ai_visibility_checks ADD COLUMN location_code INTEGER;
ALTER TABLE ai_visibility_checks ADD COLUMN language_code TEXT;
ALTER TABLE ai_visibility_checks ADD COLUMN retrieved_url TEXT;
ALTER TABLE ai_check_citations ADD COLUMN kind TEXT NOT NULL DEFAULT 'cited';  -- 'cited' | 'retrieved'
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

- Applied to production before the worker deploy with the manual command in memory `feedback_prod_d1_migrations`. Mirrored in `schema.sql` the same day.
- Old rows: `model` null marks pre-cutover checks. Statuses unchanged.
- Per check, store up to 30 cited + 30 retrieved citations (kind set), all brand entities (cap 50).
- `status` CHECK constraints: none exist today; the column is free text. Readers gain `retrieved`.

## 6. Tracker changes (`workers/src/routes/ai-tracking.ts`)

- `ALL_AI_ENGINES` re-exported from the engine layer. Projects with `ai_engines` null get all four; projects with an explicit list keep it (no silent Gemini billing). The settings PATCH validates against the four ids.
- Locale from the project row (`location_code` default 2840, `language_code` default `en`).
- `MAX_CHECKS_PER_SCHEDULED_RUN` 600 -> 1000. Cron summary log adds `projects_skipped_by_budget`.
- Task-level DataForSEO errors recorded as `error` with the message in the console log.
- `answer_excerpt` populated for cited and retrieved as in section 4.
- Report (`handleAIReport`): trend rows add `retrieved`; score stays `(cited + 0.5 * mentioned) / total`. Share of voice unchanged (cited only).
- Recommendations (`ai-recommendations.ts`): `EngineCheck.status` gains `retrieved`; new play "Fetched but not cited" ranked between `absent` and `mentioned`: "{engine} pulled {url} while answering but did not cite it. Add a 40-60 word answer capsule at the top of that page for \"{query}\" and a stat with a source."
- Feature flag: `runChecksForProject` and the manual check route use the engine layer only when KV `ai-engines-v2` is set; otherwise the legacy path (kept intact during rollout). The flag and legacy path are deleted in a follow-up PR after one clean Monday run in production.

## 7. Routes

- New `POST /api/ai/engine-check` (credit-gated): body `{ engine, query, location_code?, language_code?, brand_domain?, brand_terms?[] }`. Returns `{ answer: NormalizedAnswer, classification: Classification | null, cost }`. 1h KV cache, 90s timeout. Task errors -> 502 `{ error, detail }`.
- `POST /api/ai/visibility-check` (dashboard card): same 3 keywords, now 4 engines through `runEngine` + `classify`; `engines_total: 4`; an engine counts as visible when status is `cited` or `mentioned`. Uses the project locale when the domain maps to a project, else US/EN.
- `/api/ai/chatgpt-search`, `/api/ai/perplexity`, `/api/ai/google-ai-mode`: unchanged for one release (raw DataForSEO passthrough) so an already-open tab keeps working; removed in the follow-up PR together with the flag. The new SPA never calls them.
- `/api/ai/claude-search`, `/api/ai/gemini-search`: removed now (no caller, both broken before PR #137).

## 8. Frontend

- `src/lib/ai-tracking.ts`: `AIEngine` gains `gemini`; labels ("Gemini", short "Gemini"), color `#4285F4`-adjacent within the palette, logo in `EngineLogo.tsx`; `AI_ENGINE_ORDER` = google_ai_mode, chatgpt, gemini, perplexity. `CheckStatus` gains `retrieved`.
- New `src/lib/ai-engines.ts`: `fetchEngineCheck()` client + `NormalizedAnswer` type mirror.
- New `src/components/ai-visibility/EngineResultPanel.tsx`: verdict header (cited at #N / mentioned via {brand} / retrieved / absent / no answer), answer markdown, cited sources list (your domain highlighted), retrieved pages list, brand chips, "Sponsored results present" badge with advertiser domains, fan-out queries, export hook (existing `aiVisibility` export adapter fed from the normalized answer).
- `src/pages/AIOverview.tsx`: four tabs (Google AI Mode, ChatGPT, Gemini, Perplexity), each rendering `EngineResultPanel` from `fetchEngineCheck`. The three hand-written tab bodies and `extractAISearchResponse` are deleted. Location picker stays; default location aligned to 2840 (US) like the rest of the app. Persistent state keys keep their prefix so saved inputs survive.
- Performance tab: `AnswerStatusMatrix` renders `retrieved` (amber, between mentioned and absent) with tooltip "fetched, not cited"; `KpiRail` adds a retrieved count tile only when > 0; engine picker lists Gemini; trend tooltip shows "API model" for runs whose checks have `model` null and "Real {engine}" otherwise, so the cutover week's jump is explained.
- Dashboard `GEOVisibilityCard`: reads `engines_total` from the response (4) and shows Gemini.
- Deploy guard (`scripts/deploy-pages-production.mjs`): add markers for `EngineResultPanel` and the four Instant Check tabs so a bundle missing them is refused.

## 9. Testing

TDD throughout (worker vitest, SPA vitest where present).

- Adapter parsers: one fixture per engine captured from a real DataForSEO response (`workers/src/ai-engines/__fixtures__/`), asserting cited/retrieved/brands/ads/fanOut/model/text. Fixtures are trimmed to the fields the parser reads plus one unrelated field to prove tolerance.
- `classify`: each status, priority order, brand entity match by name and by URL, term regex, excerpt shapes, `no_answer`.
- `runEngine`: throws `EngineTaskError` on task-level error; cache hit skips fetch (fetch stubbed, KV faked as in `llm-models.test.ts`).
- Migration: applied to a local SQLite via the existing `test-support/d1.ts`, then insert a check with `retrieved` and a `retrieved` citation and read back.
- Routes: `engine-check` happy path, 400 on bad engine, 502 on task error; `visibility-check` marks Google visible when AI Mode references contain the domain (the bug this fixes).
- Tracker: `runChecksForProject` with a stubbed `runEngine` records `retrieved`, `error` on task error, uses project locale, respects the flag.
- Frontend: `EngineResultPanel` renders each verdict; `AnswerStatusMatrix` renders `retrieved`.
- Manual on staging (Nico's project): enable Gemini, add a prompt, run a manual check, see four rows with statuses and sources; Instant Check four tabs; dashboard card shows 4 engines.

## 10. Rollout

1. Merge PR #137 (done 2026-09-06, tag `prod-2026-09-06-2326`, worker `1daf3f9f`).
2. Implement on `feat/ai-engines-v2` with TDD; full worker suite green.
3. Apply the D1 migration to production (additive; old worker ignores the columns).
4. Deploy the worker (`npm run deploy` from `workers/`). With `ai-engines-v2` unset, cron and manual checks run the legacy path; `engine-check` is additive.
5. Push the branch to `staging` (`git push origin feat/ai-engines-v2:staging --force`), verify at `https://staging.datawise-118.pages.dev`.
6. Set KV `ai-engines-v2` = `1`, run a manual check on staging, inspect D1 rows.
7. On Nico's "yes": merge PR into `production` (SPA auto-deploys), tag `prod-<UTC>`, append tag + worker version to `DEPLOY.md`.
8. After the next Monday cron runs clean: follow-up PR removes the flag, the legacy tracker path, and the three per-engine Instant Check routes.

Rollback: unset the KV flag (tracker reverts to legacy instantly, no deploy); `wrangler rollback` to `1daf3f9f` for the worker; Pages rollback for the SPA. The D1 columns are additive and safe to leave.

## 11. Cost

- Scraper: $0.004 per live check (ChatGPT, Gemini). AI Mode SERP: unchanged. Perplexity: $0.0006 + tokens (unchanged).
- Monday run at the 1000-call cap: about $4 if every call were a scraper call. Today's gpt-4o web-search calls cost more per check, so the weekly bill goes down or stays flat while adding an engine.
- Instant Check: unchanged credit gating (1 credit per engine check).

## 12. Out of scope (later sub-projects)

- Brand Tracker: July 2026 LLM Mentions endpoints (weekly new/lost, Top Mentioned Brands, Lite, renames).
- Tracker UX: suggested prompts, weekly digest email, alerts.
- Standard-queue delivery for the cron.
- Ads-based "competitor is sponsoring this prompt" badge in the tracker (ads are parsed and shown in Instant Check only).
