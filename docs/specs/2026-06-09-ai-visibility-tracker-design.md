# AI Visibility Tracker — Design

Date: 2026-06-09. Approved in conversation before implementation.

## Goal

Turn the one-shot AI engine checks (Google AI Mode, ChatGPT, Perplexity) into persistent, scheduled tracking attached to rank-tracking projects, so users see whether their AI search visibility is improving over time, distinguishing cited (linked as a source) from mentioned (brand named in the answer text).

## Decisions

- Tracked AI queries live on existing `seo_projects` (no new top-level entity).
- Each project tracks up to 10 active AI queries: tracked keywords reused as-is and/or custom natural-language prompts.
- Scheduled runs are weekly for all tiers (single cron, Monday 06:00 UTC). Scheduled runs cost no user credits; manual "Check now" stays credit-gated.
- Engines selectable per project (default all three: Google AI Mode, ChatGPT, Perplexity). Max 10 queries x 3 engines = 30 DataForSEO calls per project per week.
- Cost controls: cross-user KV dedup via `dataforseoRequestCached` (6-day TTL), skip-if-fresh (24h), global per-run check cap, KV kill switch `ai-tracking-paused`.

## Data model (D1, additive migration)

- `seo_projects` + `ai_tracking_enabled INTEGER DEFAULT 0`, `ai_brand_terms TEXT` (JSON array), `ai_engines TEXT` (JSON array, NULL = all).
- `ai_tracked_queries(id, project_id, query_text, source 'keyword'|'custom', keyword_id, is_active, created_at)`.
- `ai_visibility_checks(id, query_id, engine, status 'cited'|'mentioned'|'absent'|'no_answer'|'error', citation_position, cited_url, answer_excerpt, run_type 'scheduled'|'manual', checked_at)` — the time series.
- `ai_check_citations(id, check_id, domain, url, position)` — every cited source incl. competitors; powers share of voice.

## Detection

Parse the DataForSEO response: collect answer text from `text` fields and citations from `annotations`/`references` arrays (fallback: item-level `url`/`source_url`). Cited = project domain among citations (store position + URL). Mentioned = brand term word-boundary match in answer text. No answer = empty answer and no citations. Else absent.

## API (worker, under /api/rank-tracking)

- `GET/PATCH projects/:id/ai` — settings + query list with latest status per engine.
- `POST projects/:id/ai/queries`, `DELETE ai-queries/:id` — manage queries (cap 10).
- `POST projects/:id/ai/check` — manual run (credit-gated).
- `GET projects/:id/ai/report?period=N` — trend series per engine + share of voice.

## Cron

New cron `0 6 * * 1` in wrangler.toml; `runScheduledAIChecks(env)` in scheduled().

## Frontend

`AIVisibilityPanel` rendered in the rank-tracking project detail view: enable toggle, brand terms, engine selection, query list with per-engine status matrix, trend chart (% of queries cited per engine), share of voice top domains, manual check button. Standalone AI Visibility pages unchanged.

## Out of scope (later phases)

Alerts/digest emails, AI referral traffic measurement, fan-out prompt generation, unified per-keyword view joining rank + GSC + AI.
