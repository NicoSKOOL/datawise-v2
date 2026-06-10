# Local Pack Experience Upgrade

Date: 2026-06-10
Status: approved by Nicolas (brainstorm session)
Audience: small business owners and agencies. Export framing: performance over a period of time.
Builds on: existing Local SEO feature (`workers/src/routes/local-seo.ts`, `src/components/local-seo/`).

## Goal

The Local Pack section already pulls rich DataForSEO data (Maps SERP, GBP profile, reviews with owner responses, geo-grid) but discards or under-displays much of it. This wave ships four things:

1. A **Reviews report**: themes, sentiment, response rate trend, rating distribution, review velocity.
2. **Geo-grid upgrades**: radius-derived zoom (fixes hardcoded 17z) and a "Who owns your map" competitor share view.
3. A **period-performance PDF/DOCX export** an agency can hand to a client.
4. **Stats card deltas** for rating trend and review velocity.

## 1. Reviews report

Placement: replaces the header area of the existing `ReviewsSection.tsx`; the existing review list + filters stay underneath unchanged.

### Header strip (four tiles, each with delta vs previous period)

- **Average rating**: GBP all-time figure (`rating.value`), delta from `local_review_snapshots`.
- **Review velocity**: reviews gained this period vs previous period. Source: `local_rank_history.reviews_count` snapshots (already captured on every rank check) plus `local_review_snapshots`.
- **Response rate**: percent of fetched reviews with `owner_answer`, with trend once snapshots accumulate.
- **Unanswered low-star reviews**: count of reviews with rating <= 3 and no owner response. Red styling when > 0.

### Rating distribution

Five horizontal bars (5 stars down to 1). Source: `rating_distribution` from `my_business_info` (currently fetched and ignored). Fallback: compute distribution from the fetched reviews when the field is absent.

### Themes panel (LLM, cached, never blocking)

- One LLM call over the fetched reviews returns: a one-paragraph summary plus 5-8 themes, each `{ theme, sentiment: positive|negative|mixed, mention_count, quotes: [up to 2 short verbatim quotes] }`.
- Endpoint: `POST /api/local-seo/projects/:id/review-themes`. Uses the existing multi-provider LLM abstraction (`workers/src/llm/`), same pattern as geo-grid insights.
- Cache: stored in D1 (`local_review_themes`) keyed by project + a SHA-256 hash of the review IDs/timestamps+texts. Cache hit returns instantly with `generated_at`. Regenerates only when the review set changes or the user clicks Refresh themes.
- The rest of the report renders without it; themes hydrate when ready (skeleton while loading). LLM is never in the critical render path.
- Reviews fetch depth: 20 -> 100 (`handleReviews`), keep `sort_by: newest`, existing 6h KV cache stays.

### Snapshots table

New table `local_review_snapshots` (migration, additive):

```sql
CREATE TABLE local_review_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  rating REAL,
  reviews_count INTEGER,
  fetched_count INTEGER,
  responded_count INTEGER,
  response_rate INTEGER,
  rating_distribution TEXT,  -- JSON {"5":n,"4":n,...}
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_local_review_snapshots_project ON local_review_snapshots(project_id, created_at);
```

Written on every fresh (cache-miss) reviews fetch, at most one row per project per day (upsert-or-skip on same-day row). All trends read from this table.

New table `local_review_themes`:

```sql
CREATE TABLE local_review_themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  reviews_hash TEXT NOT NULL,
  summary TEXT,
  themes TEXT,               -- JSON array
  model TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_local_review_themes_project ON local_review_themes(project_id, created_at);
```

## 2. Geo-grid upgrades

### Radius-derived zoom (bug fix)

`location_coordinate` currently hardcodes `17z` for every grid point regardless of radius. Replace with a zoom derived from `radius_km`:

| radius_km | zoom |
|-----------|------|
| <= 1 | 15z |
| <= 2.5 | 14z |
| <= 5 | 13z |
| > 5 | 12z |

Implemented as a pure helper `zoomForRadius(radiusKm)` with unit tests.

### Map competitor share

Each scan already captures `top_competitors` (top 3) per grid point and stores them only inside the `geogrid_scans.results` JSON blob. Add per-scan aggregation into a queryable table:

```sql
CREATE TABLE geogrid_competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  name TEXT NOT NULL,
  appearances INTEGER NOT NULL,   -- grid points where business appeared in top 3
  total_points INTEGER NOT NULL,
  avg_position REAL,
  best_position INTEGER,
  rating REAL,
  reviews INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_geogrid_competitors_scan ON geogrid_competitors(scan_id);
```

Top 10 competitors per scan (by appearances). Written inside `handleGeoGridScan` after aggregation. Backfill: when rendering an old scan with no rows, aggregate client-side from the JSON blob already returned (no backfill migration needed).

UI: a "Map competitors" list under the geo-grid map: rank, name, share bar (`appearances / total_points` as %), avg position, rating/reviews, and movement vs the previous scan for the same keyword (computed by comparing the two most recent scans' competitor rows). The user's own business is highlighted when present.

Endpoint: extend `handleGeoGridScanDetail` and `handleGeoGridScan` responses with `competitors[]`; add `GET /api/local-seo/projects/:id/geogrid-competitors?keyword=` returning the per-scan series for trend display.

## 3. Period-performance export (PDF + DOCX)

- Reuses `src/lib/export/` (ExportMenu, renderPdf, renderDocx, chartCapture, downloadBlob).
- New adapter `src/lib/export/adapters/localSEO.ts` building a ReportPayload from a new aggregate endpoint.
- New endpoint: `GET /api/local-seo/projects/:id/period-report?days=30` returning:
  - per-keyword: current pack position, position at period start, delta (from `local_rank_history`)
  - best movers and decliners (top 3 each)
  - latest geo-grid scan summary + competitor share + previous scan comparison
  - reviews block: rating, velocity (period vs previous period), response rate + trend, rating distribution, top themes (from cache only, never generates)
  - GBP completeness score + missing items
  - recommended next steps: rule-based list assembled from existing logic (GBP completeness gaps, unanswered low-star reviews, keywords just outside top 3, geo-grid weak corners)
- UI: ExportMenu appears on the local project detail view with a period selector (7/30/90 days, default 30).
- Report tone: written for a business owner/client. Plain-English section intros, deltas called out, no raw tables without context.

## 4. Stats cards

`LocalStatsCards.tsx` gains two deltas: average rating trend and review velocity (this period vs last). Existing keywords-in-pack and avg position cards unchanged.

## Constraints

- All migrations additive; apply to prod D1 via the manual remote command (memory `feedback_prod_d1_migrations`).
- DataForSEO budget: reviews depth 100 is one async task (cost scales per 10 reviews, still cents); geo-grid call volume unchanged.
- No em dashes anywhere in UI copy or report output.
- Light theme, white cards, #005232 accents, existing chip palette.
- LLM output validated as JSON; on parse failure return 502 with a retry hint, never garbage to the UI.
- Worker subrequest limits: unchanged paths except reviews depth (same single task) and one extra D1 write per scan/fetch.

## Out of scope (future waves)

- Review reply drafting (GBP API write integration is a separate plan, see `project_gbp_integration_plan`).
- Scheduled/automatic review refresh cron.
- White-label branding (logo upload) on the export.
- Geo-grid competitor alerting.

## Verification

- Unit tests: `zoomForRadius`, competitor aggregation, snapshot upsert-or-skip, themes cache key.
- Staging: real local project end to end: fetch reviews (verify snapshot row in D1), generate themes (verify cache hit on second load), run geo-grid scan (verify competitor rows + zoom in request), export 30-day PDF and read it.
- Verify prod D1 migrations with a SELECT after applying.
