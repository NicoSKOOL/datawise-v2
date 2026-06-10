# AI Search Visibility Panel Redesign

Date: 2026-06-10
Status: approved by Nicolas (brainstorm session, mockup v2)
Builds on: `docs/specs/2026-06-09-ai-visibility-tracker-design.md` (PR #47) and the rank-tracking improvements branch (PR #49).

## Goal

The current AIVisibilityPanel is a pass/fail badge matrix. Users need three answers, in this order:

1. Am I visible in AI search? (verdict)
2. What should I do about the gaps? (actions, rule-based, no LLM)
3. Where am I already cited that I do not know about? (discovery)

The competitive data that justifies the actions (who got cited instead) is already collected in `ai_check_citations` and barely surfaced.

## UI structure (top to bottom, inside the existing panel placement)

### 1. Verdict strip (three tiles)

- **AI Visibility Score**: 0-100. Formula: latest non-error check per tracked query+engine; cited = 1.0, mentioned = 0.5, absent/no_answer = 0; score = round(100 * sum / count). Sparkline of the same score computed per check date from history, plus delta vs the previous run.
- **Queries where you appear**: `N/M` with "cited in X, mentioned in Y" subtitle.
- **By engine**: per-engine `cited+mentioned / total` rows so a weak engine pops out.

### 2. Section tabs

Two tabs inside the panel: **Tracked queries (N)** and **Terms you're cited for (N)**.

### 3. Tracked queries tab: query cards

One card per tracked query. Collapsed: query text + one status chip per enabled engine (existing chip styles, now including position: "Cited #2"). Expanded:

- **"What to do" block** (forest green #005232 background): single highest-priority recommendation for this query (see rules below).
- **Per-engine evidence columns**: for each engine, the citation list from the latest check (top 5 + "show all"), with the user's domain row highlighted when present. Header reads "X cited instead of you" when absent, "X citations" when cited.
- **Full answer expanders**: "Read [engine]'s full answer" reveals the stored answer text, lazily fetched.

### 4. Terms you're cited for tab (discovery)

Source: existing `/api/llm-mentions/search` worker route (DataForSEO LLM Mentions database) scoped to the project domain, enriched with `/api/llm-mentions/keyword-volume`. Lazy-loaded the first time the tab is opened (credit-gated; existing 1h/6h server caches apply).

Table columns: AI query text, platform, AI search volume, your cited page (path), action button:
- **+ Track**: inserts into `ai_tracked_queries` (source 'discovery'), disabled state "Tracked" when the query already exists.
- Sort by AI volume desc by default. "Show all" pagination at 10 rows.

### 5. Share-of-voice footer

One line: top 5 most-cited domains across the project's tracked queries (from the existing `handleAIReport` share data), the user's domain bolded with its rank, and a "Full leaderboard" expander revealing the existing 15-domain list with citation counts and bar widths.

## Recommendation rules (server-side, deterministic, no LLM)

Pure function in `workers/src/routes/ai-tracking.ts`:

```
buildRecommendation(queryText, perEngine: Array<{engine, status, citation_position, citations}>): { title, body, priority }
```

Evaluated per query. Pick the worst engine first (absent > mentioned > cited below #4 > cited top 3). Rules:

1. **Absent on engine E, competitors cited**: classify the top cited URLs by URL path pattern (titles are not stored):
   - path contains `best`, `top`, `vs`, `comparison`, `tools`, `alternatives` -> listicle/comparison. Action: "Publish a comparison page targeting <query> with a feature table and a visible update date."
   - domain in {reddit.com, quora.com, news.ycombinator.com} -> community. Action: "E is citing community threads. Participate in the cited thread(s) with a substantive answer that references your page."
   - domain in {g2.com, capterra.com, clutch.co, trustpilot.com, yelp.com, producthunt.com} -> directory/review. Action: "Get or strengthen your listing on <domains>."
   - otherwise -> editorial/how-to. Action: "Publish an in-depth guide answering <query>; the cited pages are long-form editorial."
   Multiple categories: mention the dominant one, list the rest in one clause.
2. **Mentioned but not cited**: "The AI knows your brand but has no source worth linking. Add citable stats, an FAQ block, and answer capsules to your most relevant page so engines have something to cite."
3. **Cited but position > 3**: "Improve citation rank: refresh the cited page (<url>), add original data, and tighten the answer capsule for <query>."
4. **Cited #1-3 everywhere checked**: "Defend this query. Keep <url> fresh; <competitor> is gaining citations." Competitor = the non-user domain with the largest citation-count increase between the two most recent runs for this query; if history is too short, the top non-user domain in the latest run.
5. **No AI answer on all engines**: informational note, no action.

Priority: rules 1 and 2 are 'high', 3 'medium', 4 and 5 'low'. The card shows one block (the highest priority); the title states which engine it targets ("Win the Perplexity citation").

Recommendation is computed at read time in `handleGetAITracking` from stored checks + citations (no schema change needed for it).

## Backend changes (all additive)

1. **Store full answer text**: new column `ai_visibility_checks.answer_text TEXT` (migration `2026-06-10-ai-checks-answer-text.sql`). Writer stores `parsed.answerText` capped at 10,000 chars. Existing rows stay NULL ("answer not stored for checks before <date>" in UI).
2. **Lazy answer endpoint**: `GET /api/rank-tracking/ai/checks/:id/answer` returns `{ answer_text }`, ownership-checked via query -> project -> user join. Keeps the main panel payload small.
3. **`handleGetAITracking` response additions** per query+engine: `citations` (top 10 from `ai_check_citations` for the latest check), and per query: `recommendation { title, body, priority }`.
4. **Score + trend**: extend `handleAIReport` trend rows (already per date+engine) with the weighted score; SPA computes the strip from it. No new tables.
5. **Query cap**: `MAX_AI_QUERIES_PER_PROJECT` 10 -> 20. Scheduled-run ceiling (`MAX_CHECKS_PER_SCHEDULED_RUN = 600`) unchanged; it remains the cost guard.
6. **Discovery reuse**: no new worker routes; the panel calls the existing `/api/llm-mentions/search` and `/api/llm-mentions/keyword-volume` routes with the project domain. Add `source: 'discovery'` value to `ai_tracked_queries.source` when tracking from the tab.

## SPA changes

- Rewrite `src/components/rank-tracking/AIVisibilityPanel.tsx` into the structure above. Split into subcomponents in `src/components/rank-tracking/ai/`: `VerdictStrip.tsx`, `QueryCard.tsx`, `RecommendationBlock.tsx`, `CitedTermsTab.tsx`, `ShareOfVoiceFooter.tsx` (keeps each file small per the audit's god-component finding).
- Keep existing settings popover (engines, brand terms) and Run-check button unchanged.
- Light theme per brand: white cards, #005232 accents, existing chip palette.

## Out of scope (wave 2 candidates)

- LLM-generated deep-dive advice.
- Alerting on visibility drops.
- Page-level citation analysis (which of your URLs gets cited most).
- Cross-project AI visibility dashboard.

## Verification

- Unit-test `buildRecommendation` against fixture citation sets (one per rule).
- Staging: enable tracking on a real project, run manual check, verify score math against the raw checks in D1, expand cards, open discovery tab and track a term, confirm it appears in tracked queries and is checked on the next run.
- Confirm `/api/llm-mentions/search` cost per discovery-tab load stays within the existing credit gates.
