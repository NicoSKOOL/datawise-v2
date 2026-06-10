# Local Pack Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Local Pack Experience upgrade: a full Reviews report (header tiles with deltas, rating distribution, LLM themes, filterable review list), geo-grid radius-derived zoom plus a "Who owns your map" competitor share view, a period-performance PDF/DOCX export, and stats card deltas, per `docs/specs/2026-06-10-local-pack-experience.md`.

**Architecture:** Three additive D1 tables (`local_review_snapshots`, `local_review_themes`, `geogrid_competitors`) feed new and extended endpoints in `workers/src/routes/local-seo.ts`, with all testable logic extracted to a new pure module `workers/src/routes/local-reviews-analysis.ts` (vitest, same pattern as `ai-recommendations.ts`). The SPA rewrites `ReviewsSection.tsx` into subcomponents under `src/components/local-seo/reviews/`, adds a geo-grid competitors list, and reuses the existing `src/lib/export/` pipeline through a new `localSEO` adapter.

**Tech Stack:** Cloudflare Workers + D1 (manual if-path routing), vitest, multi-provider LLM abstraction (`workers/src/llm/provider.ts`), React 18 + TypeScript + shadcn/Tailwind, React state (no React Query on this page today), jsPDF/docx export pipeline with html2canvas chart capture.

---

## Spec conflicts found while reading the code (flagged, resolutions chosen below)

1. **Reviews endpoint is not project-scoped.** `POST /api/local-seo/reviews` (local-seo.ts:489) takes `place_id`/`cid`/`business_name` only and `handleReviews(request, env)` never sees the user. The spec keys snapshots by `project_id`. Resolution: add optional `project_id` to the request body, pass `user.id` into the handler from index.ts, verify ownership before any snapshot write. `ReviewsSection` gains a `projectId` prop (RankTracking.tsx:729 already has `selectedLocalProject.id` in scope).
2. **Snapshots alone cannot produce the "unanswered low-star reviews" next-step in the period report.** The spec restricts the period-report reviews block to "snapshots + cached themes only", but the spec's `local_review_snapshots` DDL has no unanswered-low-star column. Resolution: add one extra column `unanswered_low_star INTEGER` to the snapshot table (additive, computed from the same fetched reviews at snapshot time). This is the minimal deviation from the spec SQL that makes the spec's own next-steps rule implementable.
3. **Old-scan competitor backfill.** Spec says "aggregate client-side from the JSON blob". The aggregation function already exists server-side (pure module); duplicating it in the SPA invites drift. Resolution: `handleGeoGridScanDetail` aggregates on the fly from the stored JSON when `geogrid_competitors` has no rows for the scan (no rows written, no backfill migration), so the SPA always receives `competitors[]`.
4. **Period selector options.** Spec says "7/30/90 days, default 30". The local project view already renders `PeriodSelector` (RankTracking.tsx:657) with 7/14/30/90, default 30, driving `localReportPeriod`. Resolution: reuse that selector for the export (the extra 14-day option stays; removing it would regress the existing report UI).
5. **SPA type-check baseline.** `npx tsc --noEmit -p tsconfig.json` reports nothing (solution-style tsconfig with `"files": []`). The real check is `-p tsconfig.app.json`, which has pre-existing errors in `src/data/local-citations.ts`, `src/pages/Admin*.tsx`, `src/lib/export/renderDocx.ts`, `src/pages/ContentPlanner.tsx`, `src/pages/ContentTools.tsx`, `src/lib/markdown.ts`. The verification command below filters exactly those.

**SPA verification command (used by Tasks 7-9):**

```sh
cd datawise-seo-insight-main && npx tsc --noEmit -p tsconfig.app.json 2>&1 \
  | grep -vE 'src/data/local-citations\.ts|src/pages/Admin(Activity|PromoCodes|Members|Analytics)\.tsx|src/lib/export/renderDocx\.ts|src/pages/ContentPlanner\.tsx|src/pages/ContentTools\.tsx|src/lib/markdown\.ts|^  '
```

Expected output: empty. Then `npm run build` must succeed.

---

## Task 1: D1 migration + schema.sql

**Files:**
- Create: `datawise-seo-insight-main/workers/migrations/2026-06-10-local-pack-experience.sql`
- Modify: `datawise-seo-insight-main/workers/src/db/schema.sql` (append after the `geogrid_scans` block, ~line 217, before the `feedback_reports` comment)

- [ ] Create `workers/migrations/2026-06-10-local-pack-experience.sql` with exactly:

```sql
-- Local Pack Experience: review snapshots, cached review themes, geo-grid
-- competitor share. Additive only; safe to apply before the worker code that
-- references them. Apply to prod via the manual remote command (memory
-- feedback_prod_d1_migrations), never npm run db:migrate:production.

-- Daily review snapshot per local project, written on cache-miss reviews
-- fetches, at most one row per project per day (enforced in code).
CREATE TABLE IF NOT EXISTS local_review_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  rating REAL,
  reviews_count INTEGER,
  fetched_count INTEGER,
  responded_count INTEGER,
  response_rate INTEGER,
  unanswered_low_star INTEGER,
  rating_distribution TEXT,  -- JSON {"5":n,"4":n,...}
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_local_review_snapshots_project ON local_review_snapshots(project_id, created_at);

-- LLM review-theme analysis cache, keyed by project + SHA-256 of the review set.
CREATE TABLE IF NOT EXISTS local_review_themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  reviews_hash TEXT NOT NULL,
  summary TEXT,
  themes TEXT,               -- JSON array
  model TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_local_review_themes_project ON local_review_themes(project_id, created_at);

-- Per-scan geo-grid competitor aggregation (top 10 by appearances).
CREATE TABLE IF NOT EXISTS geogrid_competitors (
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
CREATE INDEX IF NOT EXISTS idx_geogrid_competitors_scan ON geogrid_competitors(scan_id);
```

- [ ] Append the same three `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` blocks (without the migration header comment, with a one-line `-- Local Pack Experience (2026-06-10)` comment) to `workers/src/db/schema.sql` directly after the `idx_geogrid_scans_project` index line (~line 217).
- [ ] Apply locally: `cd datawise-seo-insight-main/workers && npx wrangler d1 execute datawise-db --local --file=migrations/2026-06-10-local-pack-experience.sql`. Expected: 6 commands executed, no errors. (Prod apply happens manually later via `CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 npx wrangler d1 execute datawise-db --remote --file=migrations/2026-06-10-local-pack-experience.sql`, then verify with `SELECT name FROM sqlite_master WHERE name IN ('local_review_snapshots','local_review_themes','geogrid_competitors');`. Do NOT run that in this task.)
- [ ] Commit: `git add datawise-seo-insight-main/workers/migrations/2026-06-10-local-pack-experience.sql datawise-seo-insight-main/workers/src/db/schema.sql && git commit -m "feat(local): add review snapshots, review themes, geogrid competitors tables"`

---

## Task 2: pure module `local-reviews-analysis.ts` (TDD)

**Files:**
- Create: `datawise-seo-insight-main/workers/src/routes/local-reviews-analysis.test.ts`
- Create: `datawise-seo-insight-main/workers/src/routes/local-reviews-analysis.ts`

- [ ] Write the failing test file `workers/src/routes/local-reviews-analysis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  zoomForRadius,
  ratingDistributionFallback,
  buildSnapshot,
  shouldWriteSnapshot,
  aggregateGeogridCompetitors,
  computeReviewsHash,
  computeVelocity,
  validateReviewThemes,
  type GeoGridPointResult,
} from './local-reviews-analysis';

describe('zoomForRadius', () => {
  it('uses 15z up to 1km', () => {
    expect(zoomForRadius(0.5)).toBe('15z');
    expect(zoomForRadius(1)).toBe('15z');
  });
  it('uses 14z up to 2.5km', () => {
    expect(zoomForRadius(1.1)).toBe('14z');
    expect(zoomForRadius(2.5)).toBe('14z');
  });
  it('uses 13z up to 5km', () => {
    expect(zoomForRadius(3)).toBe('13z');
    expect(zoomForRadius(5)).toBe('13z');
  });
  it('uses 12z above 5km', () => {
    expect(zoomForRadius(10)).toBe('12z');
    expect(zoomForRadius(20)).toBe('12z');
  });
});

describe('ratingDistributionFallback', () => {
  it('counts reviews per star and ignores null ratings', () => {
    const dist = ratingDistributionFallback([
      { rating: 5, owner_response: null }, { rating: 5, owner_response: 'thanks' },
      { rating: 3, owner_response: null }, { rating: 1, owner_response: null },
      { rating: null, owner_response: null },
    ]);
    expect(dist).toEqual({ '5': 2, '4': 0, '3': 1, '2': 0, '1': 1 });
  });
  it('clamps fractional ratings into 1-5', () => {
    expect(ratingDistributionFallback([{ rating: 4.6, owner_response: null }])['5']).toBe(1);
  });
});

describe('buildSnapshot', () => {
  const reviews = [
    { rating: 5, owner_response: 'thanks' },
    { rating: 2, owner_response: null },
    { rating: 3, owner_response: null },
    { rating: 4, owner_response: null },
  ];
  it('computes response rate and unanswered low-star count', () => {
    const snap = buildSnapshot({ rating: 4.2, reviews_count: 120, reviews, rating_distribution: null });
    expect(snap.fetched_count).toBe(4);
    expect(snap.responded_count).toBe(1);
    expect(snap.response_rate).toBe(25);
    expect(snap.unanswered_low_star).toBe(2);
    expect(JSON.parse(snap.rating_distribution)).toEqual({ '5': 1, '4': 1, '3': 1, '2': 1, '1': 0 });
  });
  it('prefers a provided rating_distribution over the fallback', () => {
    const snap = buildSnapshot({ rating: 4.2, reviews_count: 120, reviews, rating_distribution: { '5': 90, '4': 20, '3': 5, '2': 3, '1': 2 } });
    expect(JSON.parse(snap.rating_distribution)['5']).toBe(90);
  });
  it('handles zero reviews without dividing by zero', () => {
    const snap = buildSnapshot({ rating: null, reviews_count: 0, reviews: [], rating_distribution: null });
    expect(snap.response_rate).toBe(0);
    expect(snap.unanswered_low_star).toBe(0);
  });
});

describe('shouldWriteSnapshot', () => {
  const now = new Date('2026-06-10T15:00:00Z');
  it('writes when there is no previous snapshot', () => {
    expect(shouldWriteSnapshot(null, now)).toBe(true);
  });
  it('skips when the last snapshot is from the same UTC day', () => {
    expect(shouldWriteSnapshot('2026-06-10 02:11:00', now)).toBe(false);
  });
  it('writes when the last snapshot is from a previous day', () => {
    expect(shouldWriteSnapshot('2026-06-09 23:59:00', now)).toBe(true);
  });
});

describe('aggregateGeogridCompetitors', () => {
  const comp = (title: string, position: number, rating = 4.5, reviews = 100) =>
    ({ title, rating, reviews, position });
  const points: GeoGridPointResult[] = [
    { position: 1, top_competitors: [comp('Rival A', 2), comp('Rival B', 3)] },
    { position: 4, top_competitors: [comp('Rival A', 1), comp('Rival B', 2), comp('Rival C', 3)] },
    { position: null, top_competitors: [comp('Rival A', 1), comp('Rival C', 2)] },
  ];
  it('aggregates appearances, avg and best position per competitor', () => {
    const out = aggregateGeogridCompetitors(points, 'My Shop');
    const rivalA = out.find(c => c.name === 'Rival A')!;
    expect(rivalA.appearances).toBe(3);
    expect(rivalA.total_points).toBe(3);
    expect(rivalA.avg_position).toBeCloseTo(1.3, 1);
    expect(rivalA.best_position).toBe(1);
    expect(rivalA.rating).toBe(4.5);
    expect(rivalA.is_user).toBe(false);
  });
  it('synthesizes the user business from per-point positions (top 3 only)', () => {
    const out = aggregateGeogridCompetitors(points, 'My Shop');
    const own = out.find(c => c.is_user)!;
    expect(own.name).toBe('My Shop');
    expect(own.appearances).toBe(1); // only the position-1 point is top 3
    expect(own.best_position).toBe(1);
  });
  it('omits the user entry when never in top 3 or no name given', () => {
    expect(aggregateGeogridCompetitors(points, null).some(c => c.is_user)).toBe(false);
    const noTop3: GeoGridPointResult[] = [{ position: 7, top_competitors: [comp('Rival A', 1)] }];
    expect(aggregateGeogridCompetitors(noTop3, 'My Shop').some(c => c.is_user)).toBe(false);
  });
  it('caps the list at 10, sorted by appearances', () => {
    const many: GeoGridPointResult[] = [{
      position: null,
      top_competitors: Array.from({ length: 15 }, (_, i) => comp(`Biz ${i}`, (i % 3) + 1)),
    }];
    const out = aggregateGeogridCompetitors(many, null);
    expect(out.length).toBe(10);
  });
  it('skips competitors with empty titles', () => {
    const out = aggregateGeogridCompetitors([{ position: null, top_competitors: [comp('', 1), comp('Real', 2)] }], null);
    expect(out.map(c => c.name)).toEqual(['Real']);
  });
});

describe('computeReviewsHash', () => {
  const reviews = [
    { date: '2026-06-01T10:00:00Z', text: 'Great service' },
    { date: '2026-05-20T08:00:00Z', text: 'Slow response' },
  ];
  it('is deterministic', async () => {
    expect(await computeReviewsHash(reviews)).toBe(await computeReviewsHash(reviews));
  });
  it('changes when a review text changes', async () => {
    const edited = [reviews[0], { ...reviews[1], text: 'Slow response!!' }];
    expect(await computeReviewsHash(edited)).not.toBe(await computeReviewsHash(reviews));
  });
  it('returns a 64-char hex string', async () => {
    expect(await computeReviewsHash(reviews)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeVelocity', () => {
  it('computes current and previous period gains', () => {
    expect(computeVelocity({ currentCount: 120, startOfPeriodCount: 110, startOfPreviousPeriodCount: 95 }))
      .toEqual({ current: 10, previous: 15 });
  });
  it('returns nulls when baselines are missing', () => {
    expect(computeVelocity({ currentCount: 120, startOfPeriodCount: null, startOfPreviousPeriodCount: null }))
      .toEqual({ current: null, previous: null });
    expect(computeVelocity({ currentCount: 120, startOfPeriodCount: 110, startOfPreviousPeriodCount: null }))
      .toEqual({ current: 10, previous: null });
  });
});

describe('validateReviewThemes', () => {
  const valid = {
    summary: 'Customers love the staff but mention slow scheduling.',
    themes: [
      { theme: 'Friendly staff', sentiment: 'positive', mention_count: 4, quotes: ['so friendly'], review_indexes: [0, 2] },
      { theme: 'Scheduling delays', sentiment: 'negative', mention_count: 2, quotes: ['took weeks', 'never called back', 'extra'], review_indexes: [1, 99] },
    ],
  };
  it('drops out-of-range review indexes and caps quotes at 2', () => {
    const out = validateReviewThemes(valid, 5)!;
    expect(out.themes[1].review_indexes).toEqual([1]);
    expect(out.themes[1].quotes.length).toBe(2);
  });
  it('rejects non-objects and missing fields', () => {
    expect(validateReviewThemes(null, 5)).toBeNull();
    expect(validateReviewThemes('text', 5)).toBeNull();
    expect(validateReviewThemes({ summary: 'x' }, 5)).toBeNull();
    expect(validateReviewThemes({ summary: 'x', themes: [{ theme: 1, sentiment: 'positive' }] }, 5)).toBeNull();
  });
  it('rejects invalid sentiments and caps at 8 themes', () => {
    const bad = { summary: 'x', themes: [{ theme: 'a', sentiment: 'angry', quotes: [], review_indexes: [] }] };
    expect(validateReviewThemes(bad, 5)).toBeNull();
    const many = {
      summary: 'x',
      themes: Array.from({ length: 12 }, (_, i) => ({ theme: `t${i}`, sentiment: 'mixed', mention_count: 1, quotes: [], review_indexes: [0] })),
    };
    expect(validateReviewThemes(many, 5)!.themes.length).toBe(8);
  });
});
```

- [ ] Run it and watch it fail: `cd datawise-seo-insight-main/workers && npm test`. Expected: failure, cannot resolve `./local-reviews-analysis`.
- [ ] Create `workers/src/routes/local-reviews-analysis.ts`:

```ts
// Pure module for the Local Pack Experience wave: review snapshots, rating
// distribution fallback, geo-grid zoom and competitor aggregation, review
// theme validation. No Env, no D1, fully unit-tested in
// local-reviews-analysis.test.ts. See docs/specs/2026-06-10-local-pack-experience.md.

export interface ReviewLike {
  rating: number | null;
  owner_response: string | null;
}

export interface ReviewSnapshot {
  rating: number | null;
  reviews_count: number | null;
  fetched_count: number;
  responded_count: number;
  response_rate: number;       // 0-100 integer
  unanswered_low_star: number; // rating <= 3 with no owner response
  rating_distribution: string; // JSON {"5":n,...}
}

// Radius-derived Maps zoom. Replaces the hardcoded 17z that made every grid
// point search hyper-local regardless of scan radius.
export function zoomForRadius(radiusKm: number): string {
  if (radiusKm <= 1) return '15z';
  if (radiusKm <= 2.5) return '14z';
  if (radiusKm <= 5) return '13z';
  return '12z';
}

export function ratingDistributionFallback(reviews: ReviewLike[]): Record<string, number> {
  const dist: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
  for (const r of reviews) {
    if (r.rating == null) continue;
    const star = String(Math.min(5, Math.max(1, Math.round(r.rating))));
    dist[star]++;
  }
  return dist;
}

export function buildSnapshot(args: {
  rating: number | null;
  reviews_count: number | null;
  reviews: ReviewLike[];
  rating_distribution: Record<string, number> | null;
}): ReviewSnapshot {
  const fetched = args.reviews.length;
  const responded = args.reviews.filter(r => !!r.owner_response).length;
  const unanswered = args.reviews.filter(r => !r.owner_response && r.rating != null && r.rating <= 3).length;
  const dist = args.rating_distribution && Object.keys(args.rating_distribution).length > 0
    ? args.rating_distribution
    : ratingDistributionFallback(args.reviews);
  return {
    rating: args.rating,
    reviews_count: args.reviews_count,
    fetched_count: fetched,
    responded_count: responded,
    response_rate: fetched > 0 ? Math.round((responded / fetched) * 100) : 0,
    unanswered_low_star: unanswered,
    rating_distribution: JSON.stringify(dist),
  };
}

// At most one snapshot row per project per UTC day. lastCreatedAt is the D1
// datetime('now') format: 'YYYY-MM-DD HH:MM:SS'.
export function shouldWriteSnapshot(lastCreatedAt: string | null, now: Date): boolean {
  if (!lastCreatedAt) return true;
  return lastCreatedAt.slice(0, 10) !== now.toISOString().slice(0, 10);
}

export function computeVelocity(args: {
  currentCount: number | null;
  startOfPeriodCount: number | null;
  startOfPreviousPeriodCount: number | null;
}): { current: number | null; previous: number | null } {
  const current = args.currentCount != null && args.startOfPeriodCount != null
    ? args.currentCount - args.startOfPeriodCount
    : null;
  const previous = args.startOfPeriodCount != null && args.startOfPreviousPeriodCount != null
    ? args.startOfPeriodCount - args.startOfPreviousPeriodCount
    : null;
  return { current, previous };
}

// --- Geo-grid competitor aggregation ---

export interface GeoGridPointResult {
  position: number | null;
  top_competitors?: Array<{ title: string; rating: number | null; reviews: number | null; position: number }>;
}

export interface AggregatedCompetitor {
  name: string;
  appearances: number;
  total_points: number;
  avg_position: number | null;
  best_position: number | null;
  rating: number | null;
  reviews: number | null;
  is_user: boolean;
}

export function aggregateGeogridCompetitors(
  points: GeoGridPointResult[],
  userBusinessName?: string | null,
): AggregatedCompetitor[] {
  const totalPoints = points.length;
  const map = new Map<string, { appearances: number; positions: number[]; rating: number | null; reviews: number | null }>();

  for (const point of points) {
    for (const comp of point.top_competitors || []) {
      if (!comp.title) continue;
      let entry = map.get(comp.title);
      if (!entry) {
        entry = { appearances: 0, positions: [], rating: null, reviews: null };
        map.set(comp.title, entry);
      }
      entry.appearances++;
      if (comp.position > 0) entry.positions.push(comp.position);
      if (comp.rating != null) entry.rating = comp.rating;
      if (comp.reviews != null && (entry.reviews == null || comp.reviews > entry.reviews)) entry.reviews = comp.reviews;
    }
  }

  const competitors: AggregatedCompetitor[] = Array.from(map.entries()).map(([name, e]) => ({
    name,
    appearances: e.appearances,
    total_points: totalPoints,
    avg_position: e.positions.length
      ? Math.round((e.positions.reduce((s, p) => s + p, 0) / e.positions.length) * 10) / 10
      : null,
    best_position: e.positions.length ? Math.min(...e.positions) : null,
    rating: e.rating,
    reviews: e.reviews,
    is_user: false,
  }));

  // The scan excludes the target business from top_competitors (filtered by
  // place_id/cid), so synthesize its own top 3 share from per-point positions.
  if (userBusinessName) {
    const ownPoints = points.filter(p => p.position != null && p.position <= 3);
    if (ownPoints.length > 0) {
      const positions = ownPoints.map(p => p.position as number);
      competitors.push({
        name: userBusinessName,
        appearances: ownPoints.length,
        total_points: totalPoints,
        avg_position: Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10,
        best_position: Math.min(...positions),
        rating: null,
        reviews: null,
        is_user: true,
      });
    }
  }

  competitors.sort((a, b) =>
    b.appearances - a.appearances || (a.avg_position ?? 99) - (b.avg_position ?? 99));
  return competitors.slice(0, 10);
}

// --- Review themes (LLM output validation + cache key) ---

export async function computeReviewsHash(
  reviews: Array<{ date: string | null; text: string }>
): Promise<string> {
  const material = reviews.map(r => `${r.date ?? ''}|${r.text}`).join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export interface ReviewThemeResult {
  theme: string;
  sentiment: 'positive' | 'negative' | 'mixed';
  mention_count: number;
  quotes: string[];
  review_indexes: number[];
}

// Strict validation of the LLM JSON. Returns null when the payload is
// unusable (caller responds 502 with a retry hint). Out-of-range
// review_indexes are dropped, quotes capped at 2, themes capped at 8.
export function validateReviewThemes(
  raw: unknown,
  reviewCount: number
): { summary: string; themes: ReviewThemeResult[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { summary?: unknown; themes?: unknown };
  if (typeof obj.summary !== 'string' || !Array.isArray(obj.themes)) return null;

  const themes: ReviewThemeResult[] = [];
  for (const t of obj.themes as Array<Record<string, unknown>>) {
    if (!t || typeof t !== 'object') return null;
    if (typeof t.theme !== 'string' || !['positive', 'negative', 'mixed'].includes(t.sentiment as string)) {
      return null;
    }
    const indexes = Array.isArray(t.review_indexes)
      ? (t.review_indexes as unknown[]).filter(
          (i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < reviewCount
        )
      : [];
    const quotes = Array.isArray(t.quotes)
      ? (t.quotes as unknown[]).filter((q): q is string => typeof q === 'string').slice(0, 2)
      : [];
    themes.push({
      theme: t.theme,
      sentiment: t.sentiment as 'positive' | 'negative' | 'mixed',
      mention_count: typeof t.mention_count === 'number' ? t.mention_count : indexes.length,
      quotes,
      review_indexes: indexes,
    });
  }
  if (themes.length === 0) return null;
  return { summary: obj.summary, themes: themes.slice(0, 8) };
}
```

- [ ] Run `cd datawise-seo-insight-main/workers && npm test`. Expected: all tests pass (the existing `ai-recommendations.test.ts` suite must also still pass).
- [ ] Commit: `git add datawise-seo-insight-main/workers/src/routes/local-reviews-analysis.ts datawise-seo-insight-main/workers/src/routes/local-reviews-analysis.test.ts && git commit -m "feat(local): pure module for review snapshots, geogrid zoom + competitor aggregation (TDD)"`

---

## Task 3: worker reviews changes (depth 100, distribution, daily snapshot, trends)

**Files:**
- Modify: `datawise-seo-insight-main/workers/src/routes/local-seo.ts` (imports ~line 2-9; `handleReviews` lines 489-557)
- Modify: `datawise-seo-insight-main/workers/src/index.ts` (reviews route, line 535-537)

- [ ] In `local-seo.ts`, add the pure-module import after the existing `getLLMProvider` import (line 9):

```ts
import {
  zoomForRadius, aggregateGeogridCompetitors, buildSnapshot, shouldWriteSnapshot,
  ratingDistributionFallback, computeVelocity, computeReviewsHash, validateReviewThemes,
  type AggregatedCompetitor,
} from './local-reviews-analysis';
```

- [ ] Replace the whole `handleReviews` function (lines 489-557) with:

```ts
// POST /api/local-seo/reviews
// Optional project_id (verified against userId) enables daily snapshot writes
// and snapshot-based trends for the Reviews report header tiles.
export async function handleReviews(request: Request, env: Env, userId?: string): Promise<Response> {
  const {
    place_id, cid, business_name, location_code = 2840, language_code = 'en',
    depth = 100, sort_by = 'newest', project_id,
  } = await request.json() as any;
  if (!place_id && !cid && !business_name) return json({ error: 'place_id, cid, or business_name is required' }, 400);

  // Resolve the owning local project (snapshot scope). Silently ignored when
  // missing or not owned: reviews still render without trends.
  let projectId: string | null = null;
  if (project_id && userId) {
    const owned = await env.DB.prepare(
      'SELECT id FROM seo_projects WHERE id = ? AND user_id = ? AND project_type = ?'
    ).bind(project_id, userId, 'local').first();
    if (owned) projectId = project_id;
  }

  const parseSnapshotRow = (row: any) => row
    ? { ...row, rating_distribution: row.rating_distribution ? JSON.parse(row.rating_distribution) : null }
    : null;

  // Snapshot trends for the four header tiles: latest row, the newest row
  // older than 30 days (period start), and the newest row older than 60 days.
  const loadSnapshots = async () => {
    if (!projectId) return { latest: null, period_start: null, previous_period_start: null };
    const latest = await env.DB.prepare(
      `SELECT rating, reviews_count, fetched_count, responded_count, response_rate, unanswered_low_star, rating_distribution, created_at
       FROM local_review_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(projectId).first();
    const periodStart = await env.DB.prepare(
      `SELECT rating, reviews_count, fetched_count, responded_count, response_rate, unanswered_low_star, rating_distribution, created_at
       FROM local_review_snapshots WHERE project_id = ? AND created_at <= datetime('now', '-30 days')
       ORDER BY created_at DESC LIMIT 1`
    ).bind(projectId).first();
    const prevPeriodStart = await env.DB.prepare(
      `SELECT rating, reviews_count, fetched_count, responded_count, response_rate, unanswered_low_star, rating_distribution, created_at
       FROM local_review_snapshots WHERE project_id = ? AND created_at <= datetime('now', '-60 days')
       ORDER BY created_at DESC LIMIT 1`
    ).bind(projectId).first();
    return {
      latest: parseSnapshotRow(latest),
      period_start: parseSnapshotRow(periodStart),
      previous_period_start: parseSnapshotRow(prevPeriodStart),
    };
  };

  // Review-count baselines for velocity: prefer snapshots, fall back to
  // local_rank_history.reviews_count captured on every rank check.
  const loadVelocity = async (currentCount: number | null, snaps: { period_start: any; previous_period_start: any }) => {
    if (!projectId) return { current: null, previous: null };
    let startOfPeriod: number | null = snaps.period_start?.reviews_count ?? null;
    let startOfPrevious: number | null = snaps.previous_period_start?.reviews_count ?? null;
    if (startOfPeriod == null) {
      const row = await env.DB.prepare(
        `SELECT MAX(lrh.reviews_count) as cnt FROM local_rank_history lrh
         JOIN tracked_keywords tk ON tk.id = lrh.keyword_id
         WHERE tk.project_id = ? AND lrh.checked_at < datetime('now', '-30 days') AND lrh.checked_at >= datetime('now', '-60 days')`
      ).bind(projectId).first() as any;
      startOfPeriod = row?.cnt ?? null;
    }
    if (startOfPrevious == null) {
      const row = await env.DB.prepare(
        `SELECT MAX(lrh.reviews_count) as cnt FROM local_rank_history lrh
         JOIN tracked_keywords tk ON tk.id = lrh.keyword_id
         WHERE tk.project_id = ? AND lrh.checked_at < datetime('now', '-60 days') AND lrh.checked_at >= datetime('now', '-90 days')`
      ).bind(projectId).first() as any;
      startOfPrevious = row?.cnt ?? null;
    }
    return computeVelocity({ currentCount, startOfPeriodCount: startOfPeriod, startOfPreviousPeriodCount: startOfPrevious });
  };

  const identifier = place_id || cid || business_name;
  const cacheKey = `gbp-reviews:${identifier}:${sort_by}:${depth}`;
  const cached = await env.KV.get(cacheKey, 'json') as any;
  if (cached) {
    // Snapshots and velocity are project-scoped and never baked into KV.
    const snapshots = await loadSnapshots();
    const velocity = await loadVelocity(cached.reviews_count ?? null, snapshots);
    return json({ ...cached, snapshots, velocity });
  }

  // Reviews API only supports async: task_post then poll task_get
  // place_id and cid are top-level params, not in keyword
  const taskPayload: Record<string, any> = {
    location_code,
    language_code,
    depth,
    sort_by,
  };
  if (place_id) {
    taskPayload.keyword = `place_id:${place_id}`;
  } else if (cid) {
    taskPayload.keyword = `cid:${cid}`;
  } else {
    taskPayload.keyword = business_name;
  }

  const postData = await dataforseoRequest(env, '/business_data/google/reviews/task_post', [taskPayload]);
  const taskId = postData?.tasks?.[0]?.id;

  if (!taskId) return json({ error: 'Failed to create reviews task' }, 500);

  // Poll task_get up to 5 times (2s intervals, 10s max)
  let result: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const getData = await dataforseoGet(env, `/business_data/google/reviews/task_get/${taskId}`);
    const task = getData?.tasks?.[0];
    if (task?.status_code === 20000 && task?.result?.[0]?.items) {
      result = task.result[0];
      break;
    }
  }

  if (!result) return json({ error: 'Reviews task timed out or returned no data' }, 504);

  const reviews = (result.items || []).map((item: any) => ({
    rating: item.rating?.value ?? null,
    text: item.review_text || '',
    author: item.profile_name || 'Anonymous',
    author_image: item.profile_image_url || null,
    date: item.timestamp || null,
    owner_response: item.owner_answer || null,
    owner_response_date: item.owner_timestamp || null,
    is_local_guide: item.is_local_guide ?? false,
    review_images: item.review_images || [],
    review_url: item.review_url || item.url || null,
  }));

  // Rating distribution: my_business_info first (KV-cached GBP profile, then a
  // 1h-cached DFS call), fallback computed from the fetched reviews.
  let ratingDistribution: Record<string, number> | null = null;
  const gbpCached = await env.KV.get(`gbp-profile:${place_id || business_name}`, 'json') as any;
  if (gbpCached?.rating_distribution) {
    ratingDistribution = gbpCached.rating_distribution;
  } else if (place_id || business_name) {
    try {
      const data = await dataforseoRequestCached(env, '/business_data/google/my_business_info/live', [{
        keyword: place_id ? `place_id:${place_id}` : business_name,
        location_code,
        language_code,
      }], { ttlSeconds: LOCAL_GBP_TTL_SECONDS });
      ratingDistribution = data?.tasks?.[0]?.result?.[0]?.rating_distribution ?? null;
    } catch { /* fall back to computed */ }
  }
  if (!ratingDistribution || Object.keys(ratingDistribution).length === 0) {
    ratingDistribution = ratingDistributionFallback(reviews);
  }

  const response = {
    rating: result.rating?.value ?? null,
    reviews_count: result.reviews_count ?? reviews.length,
    place_id: place_id || result.place_id || null,
    rating_distribution: ratingDistribution,
    reviews,
  };

  // Daily snapshot on fresh (cache-miss) fetches: at most one row per project per day.
  if (projectId) {
    const lastRow = await env.DB.prepare(
      'SELECT created_at FROM local_review_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(projectId).first() as any;
    if (shouldWriteSnapshot(lastRow?.created_at ?? null, new Date())) {
      const snap = buildSnapshot({
        rating: response.rating,
        reviews_count: response.reviews_count,
        reviews,
        rating_distribution: ratingDistribution,
      });
      await env.DB.prepare(
        `INSERT INTO local_review_snapshots
           (project_id, rating, reviews_count, fetched_count, responded_count, response_rate, unanswered_low_star, rating_distribution)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        projectId, snap.rating, snap.reviews_count, snap.fetched_count,
        snap.responded_count, snap.response_rate, snap.unanswered_low_star, snap.rating_distribution
      ).run();
    }
  }

  // Cache for 6h (without project-scoped trend fields)
  await env.KV.put(cacheKey, JSON.stringify(response), { expirationTtl: 21600 });

  const snapshots = await loadSnapshots();
  const velocity = await loadVelocity(response.reviews_count, snapshots);
  return json({ ...response, snapshots, velocity });
}
```

- [ ] In `workers/src/index.ts` line 535-537, change the reviews route to pass the user:

```ts
      if (path === '/api/local-seo/reviews' && method === 'POST') {
        return await withCredit(() => handleReviews(request, env, user.id));
      }
```

- [ ] Run `cd datawise-seo-insight-main/workers && npx tsc --noEmit` (worker tsconfig). Expected: no new errors. Run `npm test`. Expected: pass.
- [ ] Code-review verification + curl example against `npm run dev` (needs a session token from the SPA's localStorage `datawise_session_token`):

```sh
curl -s http://localhost:8787/api/local-seo/reviews \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"place_id":"ChIJ...","project_id":"<local project id>","depth":100}' | head -c 800
# Expected: JSON with rating, reviews_count, rating_distribution {"5":..},
# reviews[] (up to 100), snapshots{latest,period_start,previous_period_start}, velocity{current,previous}.
# Then: npx wrangler d1 execute datawise-db --local --command "SELECT project_id, response_rate, unanswered_low_star, created_at FROM local_review_snapshots" -> 1 row.
# Re-run the curl: cached response, still exactly 1 snapshot row (same-day dedupe).
```

- [ ] Commit: `git add datawise-seo-insight-main/workers/src/routes/local-seo.ts datawise-seo-insight-main/workers/src/index.ts && git commit -m "feat(local): reviews depth 100, rating distribution, daily snapshots, header-tile trends"`

---

## Task 4: worker review-themes endpoint (LLM, D1-cached)

**Files:**
- Modify: `datawise-seo-insight-main/workers/src/routes/local-seo.ts` (append new handler after `handleReviews`, ~line 700 post-Task-3)
- Modify: `datawise-seo-insight-main/workers/src/index.ts` (import block lines 71-77; route registration after line 562)

- [ ] Append to `local-seo.ts` (after `handleReviews`):

```ts
// POST /api/local-seo/projects/:id/review-themes
// One LLM call over the fetched reviews -> summary + 5-8 themes with
// review_indexes for theme-to-review tagging. Cached in D1 keyed by
// project + SHA-256 of the review set. Never in the report's critical
// render path: the SPA hydrates themes when this returns.
export async function handleReviewThemes(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const { reviews, llm_config, force = false } = await request.json() as {
    reviews?: Array<{ rating: number | null; text: string; date: string | null; owner_response: string | null }>;
    llm_config?: UserLLMConfig;
    force?: boolean;
  };
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return json({ error: 'reviews array is required' }, 400);
  }

  const project = await env.DB.prepare(
    'SELECT id, name, business_name FROM seo_projects WHERE id = ? AND user_id = ? AND project_type = ?'
  ).bind(projectId, userId, 'local').first() as any;
  if (!project) return json({ error: 'Local project not found' }, 404);

  const reviewsHash = await computeReviewsHash(reviews.map(r => ({ date: r.date, text: r.text })));

  if (!force) {
    const cachedRow = await env.DB.prepare(
      'SELECT summary, themes, model, created_at FROM local_review_themes WHERE project_id = ? AND reviews_hash = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(projectId, reviewsHash).first() as any;
    if (cachedRow) {
      return json({
        summary: cachedRow.summary,
        themes: JSON.parse(cachedRow.themes),
        generated_at: cachedRow.created_at,
        cached: true,
        model: cachedRow.model,
      });
    }
  }

  const numbered = reviews.map((r, i) => {
    const text = (r.text || '(no text)').replace(/\s+/g, ' ').slice(0, 400);
    return `[${i}] ${r.rating ?? '?'} stars | ${r.date ? String(r.date).slice(0, 10) : 'no date'} | ${r.owner_response ? 'responded' : 'no response'} | ${text}`;
  }).join('\n');

  const prompt = `You are a local SEO consultant summarizing Google reviews for ${project.business_name || project.name}.

## Reviews (numbered)
${numbered}

## Instructions
Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "summary": "<one paragraph, 3 to 5 sentences, summarizing what customers say>",
  "themes": [
    {
      "theme": "<short theme name, 2-4 words>",
      "sentiment": "positive" | "negative" | "mixed",
      "mention_count": <number of reviews mentioning this theme>,
      "quotes": ["<up to 2 short verbatim quotes from the reviews>"],
      "review_indexes": [<the [n] indexes of reviews that mention this theme>]
    }
  ]
}

Rules:
- Return 5 to 8 themes, most mentioned first
- review_indexes must only contain index numbers shown in brackets above
- Quotes must be verbatim substrings of review text, 15 words or fewer
- Plain English, written for a business owner
- Never use em dashes in any output text`;

  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
  const provider = getLLMProvider(env, llm_config);

  try {
    const result = await provider.chatComplete(messages, env, llm_config, 4096);
    let raw = result.text.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    let parsed: unknown = null;
    try { parsed = JSON.parse(raw); } catch { /* validated below */ }
    const validated = validateReviewThemes(parsed, reviews.length);
    if (!validated) {
      return json({ error: 'The model returned an unreadable response. Use Refresh themes to retry.' }, 502);
    }

    const model = llm_config?.model || null;
    await env.DB.prepare(
      'INSERT INTO local_review_themes (project_id, reviews_hash, summary, themes, model) VALUES (?, ?, ?, ?, ?)'
    ).bind(projectId, reviewsHash, validated.summary, JSON.stringify(validated.themes), model).run();

    return json({
      summary: validated.summary,
      themes: validated.themes,
      generated_at: new Date().toISOString(),
      cached: false,
      model,
    });
  } catch (err) {
    return json({ error: `LLM error: ${err instanceof Error ? err.message : 'Unknown error'}. Use Refresh themes to retry.` }, 502);
  }
}
```

- [ ] In `workers/src/index.ts`, extend the local-seo import block (lines 71-77) to include the new handler:

```ts
import {
  handleBusinessSearch, handleCreateLocalProject, handleLinkLocalProjectGBP, handleLocalKeywordDiscovery, handleLocalKeywords,
  handleLocalRankCheck, handleLocalProjectReport,
  handleGBPProfile, handleReviews, handleLocalCompetitors, handleLocalKeywordSuggestions,
  handleResolveGBPUrl,
  handleGeoGridScan, handleGeoGridHistory, handleGeoGridScanDetail, handleGeoGridInsights,
  handleReviewThemes, handleGeoGridCompetitorSeries, handleLocalPeriodReport,
} from './routes/local-seo';
```

(`handleGeoGridCompetitorSeries` and `handleLocalPeriodReport` are added in Tasks 5/6; if executing tasks strictly in order, add only `handleReviewThemes` now and extend this line again in Tasks 5 and 6.)

- [ ] Register the route after the geogrid-insights registration (after index.ts line 562):

```ts
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/review-themes$/) && method === 'POST') {
        const projectId = path.split('/')[4];
        return addCors(await handleReviewThemes(request, env, user.id, projectId));
      }
```

- [ ] Run `cd datawise-seo-insight-main/workers && npx tsc --noEmit && npm test`. Expected: clean.
- [ ] Code-review verification + curl against `npm run dev` (needs session token and a BYOK llm_config, same shape GeoGridPanel sends):

```sh
curl -s http://localhost:8787/api/local-seo/projects/$PROJECT_ID/review-themes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reviews":[{"rating":5,"text":"Great staff, very friendly","date":"2026-06-01","owner_response":null},{"rating":2,"text":"Waited two weeks for a callback","date":"2026-05-20","owner_response":null}],"llm_config":{"provider":"openai","api_key":"sk-..."}}'
# Expected: {"summary":"...","themes":[...],"generated_at":"...","cached":false,...}
# Re-run the same curl: identical body except "cached":true and the original generated_at.
```

- [ ] Commit: `git add datawise-seo-insight-main/workers/src/routes/local-seo.ts datawise-seo-insight-main/workers/src/index.ts && git commit -m "feat(local): review-themes endpoint with D1 cache keyed by review-set hash"`

---

## Task 5: worker geo-grid (zoom fix, competitor rows, series endpoint)

**Files:**
- Modify: `datawise-seo-insight-main/workers/src/routes/local-seo.ts` (`handleGeoGridScan` ~line 1043-1118 area: zoom at the `location_coordinate` line, competitor write + response after the scan INSERT; `handleGeoGridScanDetail` ~lines 1137-1161; new `handleGeoGridCompetitorSeries` appended after it)
- Modify: `datawise-seo-insight-main/workers/src/index.ts` (route registration after the review-themes registration; import already extended in Task 4)

- [ ] In `handleGeoGridScan`, replace the hardcoded zoom (currently `location_coordinate: \`${point.lat},${point.lng},17z\`` at ~line 1045):

```ts
      const data = await dataforseoRequest(env, '/serp/google/maps/live/advanced', [{
        keyword: keyword.trim(),
        location_coordinate: `${point.lat},${point.lng},${zoomForRadius(radius)}`,
        language_code: 'en',
        device: 'desktop',
        os: 'windows',
        depth: 20,
      }]);
```

- [ ] In `handleGeoGridScan`, after the `geogrid_scans` INSERT (`.run()` at ~line 1102) and before the final `return json({...})`, add competitor aggregation + persistence, and add `competitors` to the response:

```ts
  // Aggregate "Who owns your map" competitor share and persist top 10.
  const competitors = aggregateGeogridCompetitors(results, project.business_name);
  if (competitors.length > 0) {
    await env.DB.batch(competitors.map(c =>
      env.DB.prepare(
        'INSERT INTO geogrid_competitors (scan_id, name, appearances, total_points, avg_position, best_position, rating, reviews) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(scanId, c.name, c.appearances, c.total_points, c.avg_position, c.best_position, c.rating, c.reviews)
    ));
  }

  return json({
    id: scanId,
    keyword: keyword.trim(),
    grid_size: size,
    radius_km: radius,
    center: { lat: centerLat, lng: centerLng },
    points: results,
    competitors,
    summary: {
      avg_position: avgPosition,
      top3_count: top3Count,
      found_count: foundCount,
      not_found_count: notFoundCount,
    },
    scanned_at: scannedAt,
  });
```

- [ ] Replace `handleGeoGridScanDetail` (lines 1137-1161) with a version that joins `business_name` and returns `competitors[]` (stored rows when present, on-the-fly aggregation from the JSON blob for pre-feature scans, no rows written):

```ts
// GET /api/local-seo/geogrid-scans/:scanId
export async function handleGeoGridScanDetail(env: Env, userId: string, scanId: string): Promise<Response> {
  const scan = await env.DB.prepare(`
    SELECT gs.*, sp.business_name FROM geogrid_scans gs
    JOIN seo_projects sp ON sp.id = gs.project_id
    WHERE gs.id = ? AND sp.user_id = ?
  `).bind(scanId, userId).first() as any;

  if (!scan) return json({ error: 'Scan not found' }, 404);

  const points = JSON.parse(scan.results);

  const { results: compRows } = await env.DB.prepare(
    'SELECT name, appearances, total_points, avg_position, best_position, rating, reviews FROM geogrid_competitors WHERE scan_id = ? ORDER BY appearances DESC'
  ).bind(scanId).all() as { results: any[] };

  // Scans from before this feature have no stored rows: aggregate on the fly
  // from the stored JSON blob (no backfill writes).
  const competitors: AggregatedCompetitor[] = compRows.length > 0
    ? compRows.map(r => ({ ...r, is_user: !!scan.business_name && r.name === scan.business_name }))
    : aggregateGeogridCompetitors(points, scan.business_name);

  return json({
    id: scan.id,
    keyword: scan.keyword,
    grid_size: scan.grid_size,
    radius_km: scan.radius_km,
    center: { lat: scan.center_lat, lng: scan.center_lng },
    points,
    competitors,
    summary: {
      avg_position: scan.avg_position,
      top3_count: scan.top3_count,
      found_count: scan.found_count,
      not_found_count: (scan.grid_size * scan.grid_size) - scan.found_count,
    },
    scanned_at: scan.scanned_at,
  });
}
```

- [ ] Append the series endpoint after `handleGeoGridScanDetail`:

```ts
// GET /api/local-seo/projects/:id/geogrid-competitors?keyword=
// Per-scan competitor series for a keyword, most recent first. The SPA uses
// the two most recent scans to show movement vs the previous scan.
export async function handleGeoGridCompetitorSeries(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id, business_name FROM seo_projects WHERE id = ? AND user_id = ? AND project_type = ?'
  ).bind(projectId, userId, 'local').first() as any;
  if (!project) return json({ error: 'Local project not found' }, 404);

  const url = new URL(request.url);
  const keyword = (url.searchParams.get('keyword') || '').trim();
  if (!keyword) return json({ error: 'keyword query param is required' }, 400);

  const { results: scans } = await env.DB.prepare(
    'SELECT id, scanned_at FROM geogrid_scans WHERE project_id = ? AND keyword = ? ORDER BY scanned_at DESC LIMIT 12'
  ).bind(projectId, keyword).all() as { results: any[] };

  const series: Array<{ scan_id: string; scanned_at: string; competitors: AggregatedCompetitor[] }> = [];
  for (const scan of scans) {
    const { results: rows } = await env.DB.prepare(
      'SELECT name, appearances, total_points, avg_position, best_position, rating, reviews FROM geogrid_competitors WHERE scan_id = ? ORDER BY appearances DESC'
    ).bind(scan.id).all() as { results: any[] };
    series.push({
      scan_id: scan.id,
      scanned_at: scan.scanned_at,
      competitors: rows.map(r => ({ ...r, is_user: !!project.business_name && r.name === project.business_name })),
    });
  }
  return json({ keyword, scans: series });
}
```

- [ ] Register the route in `workers/src/index.ts` after the review-themes registration:

```ts
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/geogrid-competitors$/) && method === 'GET') {
        const projectId = path.split('/')[4];
        return addCors(await handleGeoGridCompetitorSeries(request, env, user.id, projectId));
      }
```

- [ ] Run `cd datawise-seo-insight-main/workers && npx tsc --noEmit && npm test`. Expected: clean.
- [ ] Code-review verification + curl against `npm run dev` (needs session token; the scan spends DFS credits, use a small grid):

```sh
curl -s -X POST http://localhost:8787/api/local-seo/projects/$PROJECT_ID/geogrid \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"keyword":"plumber","grid_size":3,"radius_km":10}'
# Expected: response now includes competitors[] (name, appearances, total_points,
# avg_position, best_position, rating, reviews, is_user).
# Verify zoom in wrangler dev logs: location_coordinate ends in ",12z" for radius 10.
# Then: npx wrangler d1 execute datawise-db --local --command "SELECT name, appearances FROM geogrid_competitors" -> up to 10 rows.
curl -s "http://localhost:8787/api/local-seo/projects/$PROJECT_ID/geogrid-competitors?keyword=plumber" \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"keyword":"plumber","scans":[{"scan_id":"...","scanned_at":"...","competitors":[...]}]}
```

- [ ] Commit: `git add datawise-seo-insight-main/workers/src/routes/local-seo.ts datawise-seo-insight-main/workers/src/index.ts && git commit -m "feat(local): radius-derived geogrid zoom, competitor share rows + series endpoint"`

---

## Task 6: worker period-report endpoint + report velocity for stats cards

**Files:**
- Modify: `datawise-seo-insight-main/workers/src/routes/local-seo.ts` (new `handleLocalPeriodReport` appended at end of file; `handleLocalProjectReport` lines 158-287 gains a `velocity` block)
- Modify: `datawise-seo-insight-main/workers/src/index.ts` (route registration)

- [ ] In `handleLocalProjectReport`, after the `prevRows` query (line 187) add a third window query, and extend the final response (line 286). Insert after line 187:

```ts
  // Period before the previous one: needed for the review-velocity delta on
  // the stats cards (velocity this period vs last period).
  const { results: prev2Rows } = await env.DB.prepare(`
    SELECT lrh.reviews_count
    FROM local_rank_history lrh
    JOIN tracked_keywords tk ON tk.id = lrh.keyword_id
    WHERE tk.project_id = ? AND tk.is_active = 1
      AND lrh.checked_at >= datetime('now', '-' || ? || ' days')
      AND lrh.checked_at < datetime('now', '-' || ? || ' days')
      AND lrh.reviews_count IS NOT NULL
  `).bind(projectId, period * 3, period * 2).all();
```

  and replace the final `return json({ current, previous, trend });` with:

```ts
  const prev2Counts = (prev2Rows as any[]).map(r => r.reviews_count as number);
  const prev2TotalReviews = prev2Counts.length ? Math.max(...prev2Counts) : null;
  const velocity = {
    current: current.total_reviews != null && previous.total_reviews != null
      ? current.total_reviews - previous.total_reviews : null,
    previous: previous.total_reviews != null && prev2TotalReviews != null
      ? previous.total_reviews - prev2TotalReviews : null,
  };

  return json({ current, previous, velocity, trend });
```

- [ ] Append `handleLocalPeriodReport` at the end of `local-seo.ts`:

```ts
// GET /api/local-seo/projects/:id/period-report?days=30
// Aggregate report for the period-performance export. Reviews block reads
// snapshots + cached themes only: never fetches reviews, never calls an LLM.
export async function handleLocalPeriodReport(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id, name, domain, business_name, place_id, location_code FROM seo_projects WHERE id = ? AND user_id = ? AND project_type = ?'
  ).bind(projectId, userId, 'local').first() as any;
  if (!project) return json({ error: 'Local project not found' }, 404);

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10) || 30, 7), 365);

  // --- Keyword movement: first vs latest check inside the window per keyword ---
  const { results: kwRows } = await env.DB.prepare(`
    SELECT tk.id, tk.keyword, lrh.pack_position, lrh.checked_at
    FROM tracked_keywords tk
    JOIN local_rank_history lrh ON lrh.keyword_id = tk.id
    WHERE tk.project_id = ? AND tk.is_active = 1
      AND lrh.checked_at >= datetime('now', '-' || ? || ' days')
    ORDER BY lrh.checked_at ASC
  `).bind(projectId, days).all() as { results: any[] };

  const byKeyword = new Map<string, { keyword: string; first: number | null; last: number | null }>();
  for (const row of kwRows) {
    const entry = byKeyword.get(row.id);
    if (!entry) {
      byKeyword.set(row.id, { keyword: row.keyword, first: row.pack_position, last: row.pack_position });
    } else {
      entry.last = row.pack_position;
    }
  }
  const keywords = Array.from(byKeyword.values()).map(k => ({
    keyword: k.keyword,
    start_position: k.first,
    current_position: k.last,
    // positive = improved (moved up the pack)
    delta: k.first != null && k.last != null ? k.first - k.last : null,
  }));
  const best_movers = keywords.filter(k => (k.delta ?? 0) > 0)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 3);
  const decliners = keywords.filter(k => (k.delta ?? 0) < 0)
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 3);

  // --- Geo-grid: latest scan + previous scan for the same keyword ---
  const latestScan = await env.DB.prepare(
    'SELECT id, keyword, grid_size, avg_position, top3_count, found_count, scanned_at, results FROM geogrid_scans WHERE project_id = ? ORDER BY scanned_at DESC LIMIT 1'
  ).bind(projectId).first() as any;

  let geogrid: any = null;
  let latestPoints: Array<{ row: number; col: number; position: number | null }> = [];
  if (latestScan) {
    latestPoints = JSON.parse(latestScan.results);
    const prevScan = await env.DB.prepare(
      'SELECT avg_position, top3_count, found_count, scanned_at FROM geogrid_scans WHERE project_id = ? AND keyword = ? AND scanned_at < ? ORDER BY scanned_at DESC LIMIT 1'
    ).bind(projectId, latestScan.keyword, latestScan.scanned_at).first() as any;

    const { results: compRows } = await env.DB.prepare(
      'SELECT name, appearances, total_points, avg_position, best_position, rating, reviews FROM geogrid_competitors WHERE scan_id = ? ORDER BY appearances DESC'
    ).bind(latestScan.id).all() as { results: any[] };
    const competitors: AggregatedCompetitor[] = compRows.length > 0
      ? compRows.map(r => ({ ...r, is_user: !!project.business_name && r.name === project.business_name }))
      : aggregateGeogridCompetitors(latestPoints, project.business_name);

    geogrid = {
      latest: {
        scan_id: latestScan.id,
        keyword: latestScan.keyword,
        scanned_at: latestScan.scanned_at,
        avg_position: latestScan.avg_position,
        top3_count: latestScan.top3_count,
        found_count: latestScan.found_count,
        total_points: latestScan.grid_size * latestScan.grid_size,
        competitors,
      },
      previous: prevScan ? {
        avg_position: prevScan.avg_position,
        top3_count: prevScan.top3_count,
        found_count: prevScan.found_count,
        scanned_at: prevScan.scanned_at,
      } : null,
    };
  }

  // --- Reviews block: snapshots + cached themes only ---
  const { results: snapRows } = await env.DB.prepare(`
    SELECT rating, reviews_count, response_rate, unanswered_low_star, rating_distribution, created_at
    FROM local_review_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 120
  `).bind(projectId).all() as { results: any[] };

  let reviews: any = null;
  if (snapRows.length > 0) {
    const latest = snapRows[0];
    const cutoffStart = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const cutoffPrev = new Date(Date.now() - days * 2 * 86400000).toISOString().slice(0, 10);
    const atPeriodStart = snapRows.find(r => r.created_at.slice(0, 10) <= cutoffStart) || null;
    const atPrevStart = snapRows.find(r => r.created_at.slice(0, 10) <= cutoffPrev) || null;
    const velocity = computeVelocity({
      currentCount: latest.reviews_count,
      startOfPeriodCount: atPeriodStart?.reviews_count ?? null,
      startOfPreviousPeriodCount: atPrevStart?.reviews_count ?? null,
    });

    const themesRow = await env.DB.prepare(
      'SELECT summary, themes, created_at FROM local_review_themes WHERE project_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(projectId).first() as any;

    reviews = {
      rating: latest.rating,
      rating_previous: atPeriodStart?.rating ?? null,
      reviews_count: latest.reviews_count,
      response_rate: latest.response_rate,
      response_rate_previous: atPeriodStart?.response_rate ?? null,
      unanswered_low_star: latest.unanswered_low_star,
      rating_distribution: latest.rating_distribution ? JSON.parse(latest.rating_distribution) : null,
      velocity: { current_period: velocity.current, previous_period: velocity.previous },
      themes: themesRow
        ? { summary: themesRow.summary, themes: JSON.parse(themesRow.themes), generated_at: themesRow.created_at }
        : null,
    };
  }

  // --- GBP completeness from the KV-cached profile (no DFS call in this path) ---
  let gbp: any = null;
  const gbpCached = await env.KV.get(`gbp-profile:${project.place_id || project.business_name}`, 'json') as any;
  if (gbpCached?.title) {
    const checks = [
      { label: 'Description', ok: !!(gbpCached.description && gbpCached.description !== gbpCached.address) },
      { label: 'Phone', ok: !!gbpCached.phone },
      { label: 'Website', ok: !!gbpCached.url },
      { label: 'Hours', ok: !!gbpCached.work_time },
      { label: 'Photos', ok: (gbpCached.total_photos ?? 0) > 0 },
      { label: 'Claimed', ok: gbpCached.is_claimed === true },
    ];
    gbp = {
      completeness_pct: Math.round((checks.filter(c => c.ok).length / checks.length) * 100),
      missing: checks.filter(c => !c.ok).map(c => c.label),
    };
  }

  // --- Rule-based next steps ---
  const next_steps: Array<{ title: string; detail: string }> = [];
  if (gbp && gbp.missing.length > 0) {
    next_steps.push({
      title: 'Complete your Google Business Profile',
      detail: `These profile fields look incomplete or could not be verified: ${gbp.missing.join(', ')}. A complete profile is the strongest local ranking signal you control.`,
    });
  }
  if (reviews && (reviews.unanswered_low_star ?? 0) > 0) {
    next_steps.push({
      title: `Respond to ${reviews.unanswered_low_star} low rated review${reviews.unanswered_low_star === 1 ? '' : 's'}`,
      detail: 'Reviews rated 3 stars or below with no owner response hurt trust and conversion. A calm, specific reply to each one shows future customers you listen.',
    });
  }
  const nearTop3 = keywords.filter(k => k.current_position != null && k.current_position >= 4 && k.current_position <= 6);
  if (nearTop3.length > 0) {
    next_steps.push({
      title: 'Push keywords just outside the top 3',
      detail: `${nearTop3.map(k => `"${k.keyword}" (#${k.current_position})`).join(', ')} ${nearTop3.length === 1 ? 'is' : 'are'} within reach of the local pack top 3. Fresh reviews, posts, and category tuning move these fastest.`,
    });
  }
  if (latestScan && latestPoints.length > 0) {
    const gridSize = latestScan.grid_size as number;
    const weakEdges = latestPoints.filter(p =>
      (p.row === 0 || p.row === gridSize - 1 || p.col === 0 || p.col === gridSize - 1) &&
      (p.position == null || p.position > 10)
    ).length;
    if (weakEdges > 0) {
      next_steps.push({
        title: 'Improve visibility at the edges of your service area',
        detail: `Your business is weak or invisible at ${weakEdges} outer grid point${weakEdges === 1 ? '' : 's'} for "${latestScan.keyword}". Location pages, citations, and reviews mentioning those neighborhoods extend your reach.`,
      });
    }
  }

  return json({
    project: { id: project.id, name: project.name, business_name: project.business_name, domain: project.domain },
    days,
    keywords,
    best_movers,
    decliners,
    geogrid,
    reviews,
    gbp,
    next_steps,
  });
}
```

- [ ] Register the route in `workers/src/index.ts` after the geogrid-competitors registration (and make sure `handleLocalPeriodReport` is in the import block):

```ts
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/period-report$/) && method === 'GET') {
        const projectId = path.split('/')[4];
        return addCors(await handleLocalPeriodReport(request, env, user.id, projectId));
      }
```

- [ ] Run `cd datawise-seo-insight-main/workers && npx tsc --noEmit && npm test`. Expected: clean.
- [ ] Code-review verification + curl against `npm run dev` (needs session token):

```sh
curl -s "http://localhost:8787/api/local-seo/projects/$PROJECT_ID/period-report?days=30" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -60
# Expected: project, days:30, keywords[] with start/current/delta, best_movers,
# decliners, geogrid{latest{competitors[]},previous}, reviews (null until a
# snapshot exists), gbp{completeness_pct,missing}, next_steps[].
```

- [ ] Commit: `git add datawise-seo-insight-main/workers/src/routes/local-seo.ts datawise-seo-insight-main/workers/src/index.ts && git commit -m "feat(local): period-report endpoint + review velocity in project report"`

---

## Task 7: SPA Reviews report UI (subcomponents, tiles, distribution, themes, filters)

**Files:**
- Create: `datawise-seo-insight-main/src/components/local-seo/reviews/HeaderTiles.tsx`
- Create: `datawise-seo-insight-main/src/components/local-seo/reviews/RatingDistribution.tsx`
- Create: `datawise-seo-insight-main/src/components/local-seo/reviews/ThemesPanel.tsx`
- Create: `datawise-seo-insight-main/src/components/local-seo/reviews/ReviewFilters.tsx`
- Create: `datawise-seo-insight-main/src/components/local-seo/reviews/ReviewList.tsx`
- Modify: `datawise-seo-insight-main/src/types/local-seo.ts` (ReviewsResponse, lines 106-111; append theme types)
- Modify: `datawise-seo-insight-main/src/lib/local-seo.ts` (`fetchReviews` lines 93-105 gains `project_id`; append `fetchReviewThemes`)
- Modify: `datawise-seo-insight-main/src/components/local-seo/ReviewsSection.tsx` (full rewrite)
- Modify: `datawise-seo-insight-main/src/pages/RankTracking.tsx` (line 729, pass `projectId`)

- [ ] In `src/types/local-seo.ts`, replace `ReviewsResponse` (lines 106-111) and append new types after it:

```ts
export interface ReviewSnapshotRow {
  rating: number | null;
  reviews_count: number | null;
  fetched_count: number | null;
  responded_count: number | null;
  response_rate: number | null;
  unanswered_low_star: number | null;
  rating_distribution: Record<string, number> | null;
  created_at: string;
}

export interface ReviewsResponse {
  rating: number | null;
  reviews_count: number;
  place_id: string | null;
  rating_distribution: Record<string, number> | null;
  reviews: ReviewItem[];
  snapshots: {
    latest: ReviewSnapshotRow | null;
    period_start: ReviewSnapshotRow | null;
    previous_period_start: ReviewSnapshotRow | null;
  };
  velocity: { current: number | null; previous: number | null };
}

export interface ReviewTheme {
  theme: string;
  sentiment: 'positive' | 'negative' | 'mixed';
  mention_count: number;
  quotes: string[];
  review_indexes: number[];
}

export interface ReviewThemesResponse {
  summary: string;
  themes: ReviewTheme[];
  generated_at: string;
  cached: boolean;
  model: string | null;
}
```

- [ ] In `src/lib/local-seo.ts`, add `project_id?: string;` to the `fetchReviews` params interface (after `sort_by?: string;`, line 99) and append after `fetchReviews`:

```ts
export async function fetchReviewThemes(projectId: string, params: {
  reviews: Array<{ rating: number | null; text: string; date: string | null; owner_response: string | null }>;
  llm_config?: { provider: string; api_key: string; model?: string };
  force?: boolean;
}) {
  return api<ReviewThemesResponse>(
    `/api/local-seo/projects/${projectId}/review-themes`,
    { method: 'POST', body: params }
  );
}
```

  and add `ReviewThemesResponse` to the type import at the top of the file.

- [ ] Create `src/components/local-seo/reviews/HeaderTiles.tsx`:

```tsx
import { Star, TrendingUp, MessageSquare, AlertCircle, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import type { ReviewsResponse } from '@/types/local-seo';

interface HeaderTilesProps {
  data: ReviewsResponse;
  responseRate: number;
  unansweredLowStar: number;
  onUnansweredClick: () => void;
}

function Delta({ value, invert = false, suffix = '', decimals = 0 }: { value: number | null; invert?: boolean; suffix?: string; decimals?: number }) {
  if (value == null) {
    return <span className="text-xs text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />no trend yet</span>;
  }
  const rounded = Math.round(Math.abs(value) * 10 ** decimals) / 10 ** decimals;
  if (rounded === 0) {
    return <span className="text-xs text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />0{suffix}</span>;
  }
  const isGood = invert ? value < 0 : value > 0;
  const cls = isGood ? 'text-green-600' : 'text-red-500';
  const Icon = value > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={`text-xs font-medium inline-flex items-center gap-0.5 ${cls}`}>
      <Icon className="h-3 w-3" />{rounded}{suffix}
    </span>
  );
}

// Four header tiles, each with a delta vs the previous period (snapshots).
export default function HeaderTiles({ data, responseRate, unansweredLowStar, onUnansweredClick }: HeaderTilesProps) {
  const periodStart = data.snapshots?.period_start ?? null;
  const ratingDelta = data.rating != null && periodStart?.rating != null
    ? data.rating - periodStart.rating : null;
  const responseRateDelta = periodStart?.response_rate != null
    ? responseRate - periodStart.response_rate : null;
  const velocityDelta = data.velocity?.current != null && data.velocity?.previous != null
    ? data.velocity.current - data.velocity.previous : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="border rounded-lg p-4 bg-white">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5" />Average rating
        </p>
        <p className="text-2xl font-bold mt-1 tabular-nums">{data.rating ?? '--'}</p>
        <Delta value={ratingDelta} decimals={1} />
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" />Review velocity
        </p>
        <p className="text-2xl font-bold mt-1 tabular-nums">
          {data.velocity?.current != null ? `+${data.velocity.current}` : '--'}
        </p>
        <p className="text-[11px] text-muted-foreground">new reviews this period</p>
        <Delta value={velocityDelta} suffix=" vs last period" />
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />Response rate
        </p>
        <p className="text-2xl font-bold mt-1 tabular-nums">{responseRate}%</p>
        <Delta value={responseRateDelta} suffix="%" />
      </div>

      <button
        onClick={onUnansweredClick}
        className={`border rounded-lg p-4 text-left transition-colors ${
          unansweredLowStar > 0
            ? 'bg-red-50 border-red-200 hover:bg-red-100'
            : 'bg-white hover:bg-muted/40'
        }`}
        title="Click to filter to unanswered reviews rated 3 stars or below"
      >
        <p className={`text-xs flex items-center gap-1.5 ${unansweredLowStar > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
          <AlertCircle className="h-3.5 w-3.5" />Unanswered low-star
        </p>
        <p className={`text-2xl font-bold mt-1 tabular-nums ${unansweredLowStar > 0 ? 'text-red-600' : ''}`}>
          {unansweredLowStar}
        </p>
        <p className={`text-[11px] ${unansweredLowStar > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
          {unansweredLowStar > 0 ? 'Click to review and reply' : 'All low-star reviews answered'}
        </p>
      </button>
    </div>
  );
}
```

- [ ] Create `src/components/local-seo/reviews/RatingDistribution.tsx`:

```tsx
import { Star } from 'lucide-react';

interface RatingDistributionProps {
  distribution: Record<string, number> | null;
}

// Five horizontal bars, 5 stars down to 1. Accent #005232.
export default function RatingDistribution({ distribution }: RatingDistributionProps) {
  if (!distribution) return null;
  const total = Object.values(distribution).reduce((s, n) => s + (n || 0), 0);
  if (total === 0) return null;

  return (
    <div id="rating-distribution-export" className="border rounded-lg p-4 bg-white space-y-2">
      <p className="text-xs font-medium text-muted-foreground mb-2">Rating distribution</p>
      {['5', '4', '3', '2', '1'].map((star) => {
        const count = distribution[star] || 0;
        const pct = Math.round((count / total) * 100);
        return (
          <div key={star} className="flex items-center gap-2">
            <span className="w-6 text-xs font-medium tabular-nums flex items-center gap-0.5">
              {star}<Star className="h-2.5 w-2.5 text-yellow-500 fill-yellow-500" />
            </span>
            <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#005232' }} />
            </div>
            <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{count}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] Create `src/components/local-seo/reviews/ThemesPanel.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, Sparkles, AlertCircle } from 'lucide-react';
import type { ReviewThemesResponse } from '@/types/local-seo';

interface ThemesPanelProps {
  themes: ReviewThemesResponse | null;
  loading: boolean;
  error: string | null;
  activeThemeIndex: number | null;
  onThemeClick: (index: number) => void;
  onRefresh: () => void;
}

const SENTIMENT_STYLES: Record<string, string> = {
  positive: 'bg-green-50 text-green-700 border-green-200',
  negative: 'bg-red-50 text-red-600 border-red-200',
  mixed: 'bg-amber-50 text-amber-700 border-amber-200',
};

// LLM theme analysis. Never blocks the rest of the report: skeleton while
// loading, retry hint on failure, hydrates when ready.
export default function ThemesPanel({ themes, loading, error, activeThemeIndex, onThemeClick, onRefresh }: ThemesPanelProps) {
  return (
    <div className="border rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />What customers are saying
        </p>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh themes
        </Button>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <div className="grid grid-cols-2 gap-2 pt-1">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && themes && (
        <>
          <p className="text-sm">{themes.summary}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {themes.themes.map((t, i) => (
              <button
                key={i}
                onClick={() => onThemeClick(i)}
                className={`text-left border rounded-lg p-3 transition-colors ${
                  activeThemeIndex === i
                    ? 'border-[#005232] bg-[#005232]/5'
                    : 'hover:bg-muted/40'
                }`}
                title="Click to filter the review list to this theme"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t.theme}</span>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${SENTIMENT_STYLES[t.sentiment]}`}>
                    {t.sentiment}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{t.mention_count} mentions</p>
                {t.quotes[0] && (
                  <p className="text-xs italic text-muted-foreground mt-1 line-clamp-2">"{t.quotes[0]}"</p>
                )}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Generated {new Date(themes.generated_at).toLocaleString()}{themes.cached ? ' (cached)' : ''}
          </p>
        </>
      )}
    </div>
  );
}
```

- [ ] Create `src/components/local-seo/reviews/ReviewFilters.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Star, X } from 'lucide-react';

export type RatingFilter = 'all' | '5' | '4' | 'low';
export type ResponseFilter = 'all' | 'responded' | 'unanswered';
export type SortOrder = 'newest' | 'oldest' | 'lowest';

export interface ReviewFilterState {
  rating: RatingFilter;
  response: ResponseFilter;
  themeIndex: number | null;
  sort: SortOrder;
}

export const DEFAULT_FILTERS: ReviewFilterState = { rating: 'all', response: 'all', themeIndex: null, sort: 'newest' };

interface ReviewFiltersProps {
  filters: ReviewFilterState;
  activeThemeName: string | null;
  onChange: (filters: ReviewFilterState) => void;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-0.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
        active
          ? 'bg-[#005232] text-white border-[#005232]'
          : 'bg-white hover:bg-muted text-muted-foreground border-border'
      }`}
    >
      {children}
    </button>
  );
}

export default function ReviewFilters({ filters, activeThemeName, onChange }: ReviewFiltersProps) {
  const hasActive = filters.rating !== 'all' || filters.response !== 'all' || filters.themeIndex != null || filters.sort !== 'newest';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Chip active={filters.rating === 'all'} onClick={() => onChange({ ...filters, rating: 'all' })}>All ratings</Chip>
        <Chip active={filters.rating === '5'} onClick={() => onChange({ ...filters, rating: '5' })}>
          5<Star className="h-2.5 w-2.5 fill-current" />
        </Chip>
        <Chip active={filters.rating === '4'} onClick={() => onChange({ ...filters, rating: '4' })}>
          4<Star className="h-2.5 w-2.5 fill-current" />
        </Chip>
        <Chip active={filters.rating === 'low'} onClick={() => onChange({ ...filters, rating: 'low' })}>3 and below</Chip>
      </div>

      <div className="h-4 w-px bg-border" />

      <div className="flex items-center gap-1">
        <Chip active={filters.response === 'all'} onClick={() => onChange({ ...filters, response: 'all' })}>All</Chip>
        <Chip active={filters.response === 'responded'} onClick={() => onChange({ ...filters, response: 'responded' })}>Responded</Chip>
        <Chip active={filters.response === 'unanswered'} onClick={() => onChange({ ...filters, response: 'unanswered' })}>Unanswered</Chip>
      </div>

      {activeThemeName && (
        <button
          onClick={() => onChange({ ...filters, themeIndex: null })}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#005232]/10 text-[#005232] border border-[#005232]/30"
        >
          Theme: {activeThemeName}
          <X className="h-3 w-3" />
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Select value={filters.sort} onValueChange={(v) => onChange({ ...filters, sort: v as SortOrder })}>
          <SelectTrigger className="h-7 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="lowest">Lowest rating first</SelectItem>
          </SelectContent>
        </Select>
        {hasActive && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
            <X className="h-3 w-3 mr-1" />Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] Create `src/components/local-seo/reviews/ReviewList.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { Star, AlertCircle, ExternalLink } from 'lucide-react';
import type { ReviewItem, ReviewTheme } from '@/types/local-seo';

export interface IndexedReview {
  review: ReviewItem;
  index: number; // original index in the fetched array, matches theme review_indexes
}

interface ReviewListProps {
  reviews: IndexedReview[];
  themes: ReviewTheme[] | null;
  reviewsPageUrl: string | null;
}

function StarRating({ rating }: { rating: number | null }) {
  if (rating == null) return null;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`h-3.5 w-3.5 ${i <= rating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-200'}`} />
      ))}
    </div>
  );
}

// Severity left border: red 1 star, orange 2, amber 3.
function severityBorder(rating: number | null): string {
  if (rating == null) return '';
  if (rating <= 1) return 'border-l-4 border-l-red-500';
  if (rating <= 2) return 'border-l-4 border-l-orange-500';
  if (rating <= 3) return 'border-l-4 border-l-amber-500';
  return '';
}

function relativeDate(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? '' : 's'} ago`;
}

export default function ReviewList({ reviews, themes, reviewsPageUrl }: ReviewListProps) {
  if (reviews.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No reviews match the current filters.</p>;
  }

  const themeLabelsFor = (index: number): string[] =>
    (themes || []).filter(t => t.review_indexes.includes(index)).map(t => t.theme);

  return (
    <div className="space-y-3 max-h-[600px] overflow-y-auto">
      {reviews.map(({ review, index }) => {
        const needsResponse = !review.owner_response && review.rating != null && review.rating <= 3;
        const reviewLink = review.review_url || reviewsPageUrl;
        const labels = themeLabelsFor(index);

        return (
          <div key={index} className={`border rounded-lg p-4 space-y-2 bg-white ${severityBorder(review.rating)}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{review.author}</span>
                {review.is_local_guide && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Local Guide</Badge>
                )}
                {review.date && <span className="text-xs text-muted-foreground">{relativeDate(review.date)}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StarRating rating={review.rating} />
                {reviewLink && (
                  <a
                    href={reviewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-[#005232] transition-colors"
                    title="View on Google"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>

            {review.text && <p className="text-sm text-foreground">{review.text}</p>}

            {labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {labels.map((label) => (
                  <span key={label} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#005232]/10 text-[#005232]">
                    {label}
                  </span>
                ))}
              </div>
            )}

            {review.owner_response && (
              <div className="bg-muted rounded-md p-3 mt-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Owner response</p>
                <p className="text-sm">{review.owner_response}</p>
              </div>
            )}

            {needsResponse && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Needs response</span>
                </div>
                {reviewLink && (
                  <a
                    href={reviewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#005232] hover:underline font-medium"
                  >
                    Reply on Google
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] Rewrite `src/components/local-seo/ReviewsSection.tsx`:

```tsx
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, MessageSquare, AlertCircle, ExternalLink } from 'lucide-react';
import { fetchReviews, fetchReviewThemes } from '@/lib/local-seo';
import { getLLMConfig } from '@/lib/chat';
import type { ReviewsResponse, ReviewThemesResponse } from '@/types/local-seo';
import HeaderTiles from './reviews/HeaderTiles';
import RatingDistribution from './reviews/RatingDistribution';
import ThemesPanel from './reviews/ThemesPanel';
import ReviewFilters, { DEFAULT_FILTERS, type ReviewFilterState } from './reviews/ReviewFilters';
import ReviewList, { type IndexedReview } from './reviews/ReviewList';

interface ReviewsSectionProps {
  projectId: string;
  placeId: string | null;
  cid: string | null;
  businessName: string | null;
}

function buildGoogleReviewsUrl(placeId: string | null, businessName: string | null): string | null {
  if (placeId) return `https://search.google.com/local/reviews?placeid=${placeId}`;
  if (businessName) return `https://www.google.com/maps/search/${encodeURIComponent(businessName)}`;
  return null;
}

export default function ReviewsSection({ projectId, placeId, cid, businessName }: ReviewsSectionProps) {
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [themes, setThemes] = useState<ReviewThemesResponse | null>(null);
  const [themesLoading, setThemesLoading] = useState(false);
  const [themesError, setThemesError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReviewFilterState>({ ...DEFAULT_FILTERS });

  const loadThemes = useCallback(async (reviewsData: ReviewsResponse, force = false) => {
    const llmConfig = getLLMConfig();
    if (!llmConfig?.api_key) {
      setThemesError('Add your LLM API key in Settings to see review themes.');
      return;
    }
    setThemesLoading(true);
    setThemesError(null);
    try {
      const result = await fetchReviewThemes(projectId, {
        reviews: reviewsData.reviews.map(r => ({
          rating: r.rating, text: r.text, date: r.date, owner_response: r.owner_response,
        })),
        llm_config: llmConfig,
        force,
      });
      setThemes(result);
    } catch (err) {
      setThemes(null);
      setThemesError(err instanceof Error ? err.message : 'Theme analysis failed. Use Refresh themes to retry.');
    } finally {
      setThemesLoading(false);
    }
  }, [projectId]);

  const loadReviews = useCallback(async () => {
    if (!placeId && !cid && !businessName) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchReviews({
        place_id: placeId || undefined,
        cid: cid || undefined,
        business_name: businessName || undefined,
        depth: 100,
        sort_by: 'newest',
        project_id: projectId,
      });
      setData(result);
      // Themes hydrate after the report renders; never blocking.
      if (result.reviews.length > 0) loadThemes(result);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [placeId, cid, businessName, projectId, loadThemes]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const indexed: IndexedReview[] = useMemo(
    () => (data?.reviews || []).map((review, index) => ({ review, index })),
    [data]
  );

  const responseRate = data && data.reviews.length > 0
    ? Math.round((data.reviews.filter(r => r.owner_response).length / data.reviews.length) * 100)
    : 0;
  const unansweredLowStar = data
    ? data.reviews.filter(r => !r.owner_response && r.rating != null && r.rating <= 3).length
    : 0;

  const filteredReviews = useMemo(() => {
    let list = indexed;
    if (filters.rating === '5') list = list.filter(({ review }) => review.rating === 5);
    else if (filters.rating === '4') list = list.filter(({ review }) => review.rating === 4);
    else if (filters.rating === 'low') list = list.filter(({ review }) => review.rating != null && review.rating <= 3);

    if (filters.response === 'responded') list = list.filter(({ review }) => !!review.owner_response);
    else if (filters.response === 'unanswered') list = list.filter(({ review }) => !review.owner_response);

    if (filters.themeIndex != null && themes) {
      const theme = themes.themes[filters.themeIndex];
      if (theme) {
        const allowed = new Set(theme.review_indexes);
        list = list.filter(({ index }) => allowed.has(index));
      }
    }

    const sorted = [...list];
    if (filters.sort === 'newest') {
      sorted.sort((a, b) => (b.review.date || '').localeCompare(a.review.date || ''));
    } else if (filters.sort === 'oldest') {
      sorted.sort((a, b) => (a.review.date || '').localeCompare(b.review.date || ''));
    } else {
      sorted.sort((a, b) => (a.review.rating ?? 6) - (b.review.rating ?? 6));
    }
    return sorted;
  }, [indexed, filters, themes]);

  if (!placeId && !cid && !businessName) return null;

  const reviewsPageUrl = buildGoogleReviewsUrl(data?.place_id || placeId, businessName);
  const activeThemeName = filters.themeIndex != null && themes ? themes.themes[filters.themeIndex]?.theme ?? null : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Reviews
          </CardTitle>
          <div className="flex items-center gap-2">
            {reviewsPageUrl && (
              <a
                href={reviewsPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-[#005232] hover:underline font-medium"
              >
                View all on Google
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={loadReviews}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data ? (
          <div className="text-center py-4">
            {error ? (
              <div className="flex items-center justify-center gap-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No review data available.</p>
            )}
            <Button variant="outline" size="sm" className="mt-2" onClick={loadReviews}>
              {error ? 'Retry' : 'Load Reviews'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <HeaderTiles
              data={data}
              responseRate={responseRate}
              unansweredLowStar={unansweredLowStar}
              onUnansweredClick={() => setFilters({ ...filters, rating: 'low', response: 'unanswered' })}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <RatingDistribution distribution={data.rating_distribution} />
              <ThemesPanel
                themes={themes}
                loading={themesLoading}
                error={themesError}
                activeThemeIndex={filters.themeIndex}
                onThemeClick={(i) => setFilters({ ...filters, themeIndex: filters.themeIndex === i ? null : i })}
                onRefresh={() => loadThemes(data, true)}
              />
            </div>

            <ReviewFilters filters={filters} activeThemeName={activeThemeName} onChange={setFilters} />

            {(filters.rating !== 'all' || filters.response !== 'all' || filters.themeIndex != null) && (
              <p className="text-xs text-muted-foreground">
                Showing {filteredReviews.length} of {data.reviews.length} reviews
              </p>
            )}

            <ReviewList reviews={filteredReviews} themes={themes?.themes ?? null} reviewsPageUrl={reviewsPageUrl} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] In `src/pages/RankTracking.tsx` line 729, pass the project id:

```tsx
        <ReviewsSection projectId={selectedLocalProject.id} placeId={selectedLocalProject.place_id} cid={selectedLocalProject.cid} businessName={selectedLocalProject.business_name} />
```

- [ ] Verify: run the SPA verification command from the header (tsc filtered + must be empty) and `cd datawise-seo-insight-main && npm run build` (must succeed). UI exercise: `npm run dev`, open a local project, confirm tiles render, the red tile click sets the "3 and below" + "Unanswered" chips, theme click filters the list, severity borders show on 1-3 star reviews. If a browser session is not available to the executor, state that explicitly in the task report.
- [ ] Commit: `git add datawise-seo-insight-main/src/components/local-seo/reviews/HeaderTiles.tsx datawise-seo-insight-main/src/components/local-seo/reviews/RatingDistribution.tsx datawise-seo-insight-main/src/components/local-seo/reviews/ThemesPanel.tsx datawise-seo-insight-main/src/components/local-seo/reviews/ReviewFilters.tsx datawise-seo-insight-main/src/components/local-seo/reviews/ReviewList.tsx datawise-seo-insight-main/src/components/local-seo/ReviewsSection.tsx datawise-seo-insight-main/src/types/local-seo.ts datawise-seo-insight-main/src/lib/local-seo.ts datawise-seo-insight-main/src/pages/RankTracking.tsx && git commit -m "feat(local): reviews report UI with tiles, distribution, themes, filterable list"`

---

## Task 8: SPA geo-grid competitors list + stats card deltas

**Files:**
- Create: `datawise-seo-insight-main/src/components/local-seo/GeoGridCompetitorsList.tsx`
- Modify: `datawise-seo-insight-main/src/types/local-seo.ts` (`GeoGridScanResult` lines 142-151; `LocalProjectReport` lines 54-58; append `GeoGridCompetitor`)
- Modify: `datawise-seo-insight-main/src/lib/local-seo.ts` (append `fetchGeoGridCompetitorSeries`)
- Modify: `datawise-seo-insight-main/src/components/local-seo/GeoGridPanel.tsx` (state + fetch ~lines 26-54; render under map ~line 267)
- Modify: `datawise-seo-insight-main/src/components/local-seo/GeoGridMap.tsx` (line 117, add export capture id)
- Modify: `datawise-seo-insight-main/src/components/local-seo/LocalStatsCards.tsx` (DeltaBadge + velocity card)

- [ ] In `src/types/local-seo.ts`, append after `GeoGridSummary` and extend the two interfaces:

```ts
export interface GeoGridCompetitor {
  name: string;
  appearances: number;
  total_points: number;
  avg_position: number | null;
  best_position: number | null;
  rating: number | null;
  reviews: number | null;
  is_user: boolean;
}

export interface GeoGridCompetitorSeries {
  keyword: string;
  scans: Array<{ scan_id: string; scanned_at: string; competitors: GeoGridCompetitor[] }>;
}
```

  In `GeoGridScanResult` add `competitors?: GeoGridCompetitor[];` after `points: GeoGridPoint[];`. In `LocalProjectReport` add `velocity: { current: number | null; previous: number | null };` after `previous`.

- [ ] In `src/lib/local-seo.ts`, append after `fetchGeoGridInsights` (and add `GeoGridCompetitorSeries` to the type import):

```ts
export async function fetchGeoGridCompetitorSeries(projectId: string, keyword: string) {
  return api<GeoGridCompetitorSeries>(
    `/api/local-seo/projects/${projectId}/geogrid-competitors?keyword=${encodeURIComponent(keyword)}`
  );
}
```

- [ ] Create `src/components/local-seo/GeoGridCompetitorsList.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Star, ArrowUp, ArrowDown, Minus, Users } from 'lucide-react';
import type { GeoGridCompetitor } from '@/types/local-seo';

interface GeoGridCompetitorsListProps {
  competitors: GeoGridCompetitor[];
  previousCompetitors: GeoGridCompetitor[] | null;
  businessName: string | null;
}

function sharePct(c: GeoGridCompetitor): number {
  return c.total_points > 0 ? Math.round((c.appearances / c.total_points) * 100) : 0;
}

function Movement({ current, previous }: { current: GeoGridCompetitor; previous: GeoGridCompetitor | undefined }) {
  if (!previous) {
    return <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />new</span>;
  }
  const diff = sharePct(current) - sharePct(previous);
  if (diff === 0) {
    return <span className="text-[10px] text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />0%</span>;
  }
  const up = diff > 0;
  return (
    <span className={`text-[10px] font-medium inline-flex items-center gap-0.5 ${up ? 'text-green-600' : 'text-red-500'}`}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(diff)}%
    </span>
  );
}

// "Who owns your map": competitor share of grid-point top 3 results for the
// latest scan, with movement vs the previous scan of the same keyword.
export default function GeoGridCompetitorsList({ competitors, previousCompetitors, businessName }: GeoGridCompetitorsListProps) {
  if (!competitors || competitors.length === 0) return null;

  const prevByName = new Map((previousCompetitors || []).map(c => [c.name, c]));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4" />
          Map competitors
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {competitors.map((c, i) => {
          const isOwn = c.is_user || (!!businessName && c.name === businessName);
          const pct = sharePct(c);
          return (
            <div
              key={c.name}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                isOwn ? 'bg-[#005232]/5 border border-[#005232]/40' : ''
              }`}
            >
              <span className="w-5 text-xs font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm truncate ${isOwn ? 'font-semibold text-[#005232]' : 'font-medium'}`}>
                    {c.name}
                  </span>
                  {isOwn && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#005232] text-white shrink-0">You</span>
                  )}
                  <Movement current={c} previous={prevByName.get(c.name)} />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: isOwn ? '#005232' : '#9ca3af' }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">
                    {c.appearances}/{c.total_points} ({pct}%)
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0 w-24">
                <p className="text-xs tabular-nums">
                  {c.avg_position != null ? `avg #${c.avg_position}` : 'avg --'}
                </p>
                <p className="text-[10px] text-muted-foreground flex items-center justify-end gap-0.5">
                  {c.rating != null && (
                    <>
                      <Star className="h-2.5 w-2.5 text-yellow-500 fill-yellow-500" />
                      {c.rating}
                    </>
                  )}
                  {c.reviews != null && <span>({c.reviews})</span>}
                </p>
              </div>
            </div>
          );
        })}
        <p className="text-[10px] text-muted-foreground pt-1">
          Share of grid points where each business appears in the map top 3. Movement compares the previous scan for this keyword.
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] In `GeoGridPanel.tsx`: import the list and series fetcher, track previous-scan competitors, render under the map.
  - Add to the imports (line 9 + 11-12 area):

```tsx
import { runGeoGridScan, fetchGeoGridHistory, fetchGeoGridScan, fetchGeoGridInsights, fetchGeoGridCompetitorSeries } from '@/lib/local-seo';
import type { GeoGridScanResult, GeoGridHistoryItem, LocalTrackedKeyword, GeoGridInsights, GeoGridCompetitor } from '@/types/local-seo';
import GeoGridCompetitorsList from './GeoGridCompetitorsList';
```

  - Add state after `loadingInsights` (line 32):

```tsx
  const [prevCompetitors, setPrevCompetitors] = useState<GeoGridCompetitor[] | null>(null);
```

  - Add a loader and call it whenever a scan result lands (in `handleScan` after `setScanResult(result)`, in `handleLoadScan` after `setScanResult(result)`, and in `loadHistoryAndRestoreLatest` after `setScanResult(result)`):

```tsx
  const loadPrevCompetitors = async (result: GeoGridScanResult) => {
    setPrevCompetitors(null);
    try {
      const series = await fetchGeoGridCompetitorSeries(projectId, result.keyword);
      const prev = series.scans.find(s => s.scan_id !== result.id && s.competitors.length > 0);
      setPrevCompetitors(prev ? prev.competitors : null);
    } catch { /* movement column degrades to "new" */ }
  };
```

  - Render directly under `<GeoGridMap ... />` (after line 267):

```tsx
              {scanResult.competitors && scanResult.competitors.length > 0 && (
                <GeoGridCompetitorsList
                  competitors={scanResult.competitors}
                  previousCompetitors={prevCompetitors}
                  businessName={businessName}
                />
              )}
```

- [ ] In `GeoGridMap.tsx` line 117, add the export capture id to the map wrapper:

```tsx
      <div id="geogrid-map-export" ref={mapRef} className="w-full h-[500px] rounded-lg border z-0 relative" />
```

- [ ] In `LocalStatsCards.tsx`: support decimal deltas and add the Review Velocity card. Replace `DeltaBadge` (lines 9-30) with:

```tsx
function DeltaBadge({ current, previous, invert = false, decimals = 0 }: { current: number | null; previous: number | null; invert?: boolean; decimals?: number }) {
  if (current == null || previous == null || previous === 0) {
    return <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />--</span>;
  }
  const diff = Math.round((current - previous) * 10 ** decimals) / 10 ** decimals;
  if (diff === 0) {
    return <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />0</span>;
  }
  const isGood = invert ? diff < 0 : diff > 0;
  if (isGood) {
    return (
      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 inline-flex items-center gap-0.5">
        <ArrowUp className="h-3 w-3" />{Math.abs(diff)}
      </span>
    );
  }
  return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 inline-flex items-center gap-0.5">
      <ArrowDown className="h-3 w-3" />{Math.abs(diff)}
    </span>
  );
}
```

  Change the Rating card delta (line 84) to `<DeltaBadge current={current.avg_rating} previous={previous.avg_rating} decimals={1} />`, change the grid wrapper (line 38) to `grid-cols-2 lg:grid-cols-6`, and insert a new card between Rating and Movement:

```tsx
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Review Velocity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">
              {report.velocity?.current != null ? `+${report.velocity.current}` : '--'}
            </span>
            <DeltaBadge current={report.velocity?.current ?? null} previous={report.velocity?.previous ?? null} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">reviews gained this period</p>
        </CardContent>
      </Card>
```

  Note `report.velocity` requires destructuring change at line 35: `const { current, previous } = report;` stays; reference velocity via `report.velocity`.

- [ ] Verify: SPA verification command (filtered tsc empty) + `npm run build`. UI exercise: load a local project with a past scan, confirm the Map competitors card renders with share bars and the You highlight, stats row shows the Review Velocity card. If a browser is unavailable, say so.
- [ ] Commit: `git add datawise-seo-insight-main/src/components/local-seo/GeoGridCompetitorsList.tsx datawise-seo-insight-main/src/components/local-seo/GeoGridPanel.tsx datawise-seo-insight-main/src/components/local-seo/GeoGridMap.tsx datawise-seo-insight-main/src/components/local-seo/LocalStatsCards.tsx datawise-seo-insight-main/src/types/local-seo.ts datawise-seo-insight-main/src/lib/local-seo.ts && git commit -m "feat(local): map competitor share list + review velocity stats card"`

---

## Task 9: period-performance export (adapter + ExportMenu on local view)

**Files:**
- Create: `datawise-seo-insight-main/src/lib/export/adapters/localSEO.ts`
- Modify: `datawise-seo-insight-main/src/types/local-seo.ts` (append period-report types)
- Modify: `datawise-seo-insight-main/src/lib/local-seo.ts` (append `fetchLocalPeriodReport`)
- Modify: `datawise-seo-insight-main/src/pages/RankTracking.tsx` (local view header, lines 637-645)

- [ ] Append period-report types to `src/types/local-seo.ts`:

```ts
export interface LocalPeriodKeywordMove {
  keyword: string;
  start_position: number | null;
  current_position: number | null;
  delta: number | null; // positive = improved
}

export interface LocalPeriodReportData {
  project: { id: string; name: string; business_name: string | null; domain: string | null };
  days: number;
  keywords: LocalPeriodKeywordMove[];
  best_movers: LocalPeriodKeywordMove[];
  decliners: LocalPeriodKeywordMove[];
  geogrid: {
    latest: {
      scan_id: string;
      keyword: string;
      scanned_at: string;
      avg_position: number | null;
      top3_count: number;
      found_count: number;
      total_points: number;
      competitors: GeoGridCompetitor[];
    };
    previous: { avg_position: number | null; top3_count: number; found_count: number; scanned_at: string } | null;
  } | null;
  reviews: {
    rating: number | null;
    rating_previous: number | null;
    reviews_count: number | null;
    response_rate: number | null;
    response_rate_previous: number | null;
    unanswered_low_star: number | null;
    rating_distribution: Record<string, number> | null;
    velocity: { current_period: number | null; previous_period: number | null };
    themes: { summary: string; themes: ReviewTheme[]; generated_at: string } | null;
  } | null;
  gbp: { completeness_pct: number; missing: string[] } | null;
  next_steps: Array<{ title: string; detail: string }>;
}
```

- [ ] Append to `src/lib/local-seo.ts` (add `LocalPeriodReportData` to the type import):

```ts
export async function fetchLocalPeriodReport(projectId: string, days = 30) {
  return api<LocalPeriodReportData>(
    `/api/local-seo/projects/${projectId}/period-report?days=${days}`
  );
}
```

- [ ] Create `src/lib/export/adapters/localSEO.ts` (no em dashes anywhere; `--` for empty cells; plain-English intros per the spec's report tone):

```ts
import type { ReportPayload, ReportSection } from '../types';
import type { LocalPeriodReportData, LocalPeriodKeywordMove } from '@/types/local-seo';

interface Args {
  report: LocalPeriodReportData;
  charts?: {
    geoGridPng?: string | null;
    ratingDistributionPng?: string | null;
  };
}

function pos(p: number | null): string {
  return p == null ? 'Not in pack' : `#${p}`;
}

function moveText(k: LocalPeriodKeywordMove): string {
  if (k.delta == null) return '--';
  if (k.delta === 0) return '0';
  return k.delta > 0 ? `Up ${k.delta}` : `Down ${Math.abs(k.delta)}`;
}

export function buildLocalSEOReport({ report, charts }: Args): ReportPayload {
  const sections: ReportSection[] = [];
  const businessLabel = report.project.business_name || report.project.name;
  const periodLabel = `last ${report.days} days`;

  sections.push({
    type: 'paragraph',
    text: `This report covers how ${businessLabel} performed in Google's local results over the ${periodLabel}: map pack rankings, map visibility around your location, and customer reviews. Deltas compare the start of the period to today.`,
  });

  // --- KPI strip ---
  const inPack = report.keywords.filter(k => k.current_position != null).length;
  const top3 = report.keywords.filter(k => k.current_position != null && k.current_position <= 3).length;
  const kpis: Array<{ label: string; value: string; delta?: string; tone?: 'up' | 'down' | 'neutral' }> = [
    { label: 'Tracked Keywords', value: String(report.keywords.length) },
    { label: 'In Local Pack', value: String(inPack) },
    { label: 'Top 3', value: String(top3) },
  ];
  if (report.reviews) {
    kpis.push({
      label: 'Rating',
      value: report.reviews.rating != null ? report.reviews.rating.toFixed(1) : '--',
      delta: report.reviews.rating != null && report.reviews.rating_previous != null
        ? (report.reviews.rating - report.reviews.rating_previous >= 0 ? '+' : '') +
          (Math.round((report.reviews.rating - report.reviews.rating_previous) * 10) / 10)
        : undefined,
      tone: report.reviews.rating != null && report.reviews.rating_previous != null
        ? (report.reviews.rating >= report.reviews.rating_previous ? 'up' : 'down')
        : 'neutral',
    });
  }
  sections.push({ type: 'kpi-grid', items: kpis });

  // --- Keyword movement ---
  sections.push({ type: 'heading', level: 2, text: 'Local Pack Rankings' });
  if (report.keywords.length === 0) {
    sections.push({ type: 'paragraph', text: 'No keyword checks were recorded in this period. Run a local rank check to start tracking movement.' });
  } else {
    sections.push({
      type: 'paragraph',
      text: `Where ${businessLabel} ranked in the map pack at the start of the period vs today.`,
    });
    sections.push({
      type: 'table',
      headers: ['Keyword', 'Period Start', 'Now', 'Change'],
      rows: report.keywords.map(k => [k.keyword, pos(k.start_position), pos(k.current_position), moveText(k)]),
    });
    if (report.best_movers.length > 0) {
      sections.push({
        type: 'callout',
        tone: 'success',
        text: `Biggest gains: ${report.best_movers.map(k => `"${k.keyword}" (${moveText(k)})`).join(', ')}.`,
      });
    }
    if (report.decliners.length > 0) {
      sections.push({
        type: 'callout',
        tone: 'warn',
        text: `Lost ground: ${report.decliners.map(k => `"${k.keyword}" (${moveText(k)})`).join(', ')}.`,
      });
    }
  }

  // --- Geo-grid ---
  if (report.geogrid) {
    const g = report.geogrid.latest;
    sections.push({ type: 'heading', level: 2, text: 'Map Visibility' });
    sections.push({
      type: 'paragraph',
      text: `Latest scan for "${g.keyword}" (${new Date(g.scanned_at).toLocaleDateString()}): found at ${g.found_count} of ${g.total_points} points, in the top 3 at ${g.top3_count} points${g.avg_position != null ? `, average position ${g.avg_position}` : ''}.` +
        (report.geogrid.previous
          ? ` The previous scan found you at ${report.geogrid.previous.found_count} points with ${report.geogrid.previous.top3_count} in the top 3.`
          : ''),
    });
    if (charts?.geoGridPng) {
      sections.push({ type: 'chart', pngDataUrl: charts.geoGridPng, caption: `Map visibility grid for "${g.keyword}"` });
    }
    if (g.competitors.length > 0) {
      sections.push({ type: 'heading', level: 3, text: 'Who owns your map' });
      sections.push({
        type: 'table',
        headers: ['Business', 'Top 3 Share', 'Avg Position', 'Rating', 'Reviews'],
        rows: g.competitors.map(c => [
          c.is_user ? `${c.name} (you)` : c.name,
          `${c.appearances}/${c.total_points} (${c.total_points > 0 ? Math.round((c.appearances / c.total_points) * 100) : 0}%)`,
          c.avg_position == null ? '--' : `#${c.avg_position}`,
          c.rating == null ? '--' : c.rating,
          c.reviews == null ? '--' : c.reviews,
        ]),
        caption: 'Share of grid points where each business appears in the map top 3',
      });
    }
  }

  // --- Reviews ---
  if (report.reviews) {
    const r = report.reviews;
    sections.push({ type: 'heading', level: 2, text: 'Reviews' });
    const velocityText = r.velocity.current_period != null
      ? `You gained ${r.velocity.current_period} review${r.velocity.current_period === 1 ? '' : 's'} this period` +
        (r.velocity.previous_period != null ? ` (previous period: ${r.velocity.previous_period}).` : '.')
      : 'Not enough history yet to measure review velocity.';
    sections.push({
      type: 'paragraph',
      text: `Your rating is ${r.rating ?? '--'} across ${r.reviews_count ?? '--'} reviews. ${velocityText} ${r.response_rate != null ? `You have responded to ${r.response_rate}% of recent reviews.` : ''}`,
    });
    if ((r.unanswered_low_star ?? 0) > 0) {
      sections.push({
        type: 'callout',
        tone: 'warn',
        text: `${r.unanswered_low_star} review${r.unanswered_low_star === 1 ? '' : 's'} rated 3 stars or below ${r.unanswered_low_star === 1 ? 'has' : 'have'} no owner response yet.`,
      });
    }
    if (charts?.ratingDistributionPng) {
      sections.push({ type: 'chart', pngDataUrl: charts.ratingDistributionPng, caption: 'Rating distribution', widthPct: 60 });
    } else if (r.rating_distribution) {
      sections.push({
        type: 'table',
        headers: ['Stars', 'Reviews'],
        rows: ['5', '4', '3', '2', '1'].map(s => [`${s} stars`, r.rating_distribution?.[s] ?? 0]),
      });
    }
    if (r.themes) {
      sections.push({ type: 'heading', level: 3, text: 'What customers are saying' });
      sections.push({ type: 'paragraph', text: r.themes.summary });
      sections.push({
        type: 'list',
        style: 'bullet',
        items: r.themes.themes.map(t => `${t.theme} (${t.sentiment}, ${t.mention_count} mentions)${t.quotes[0] ? `: "${t.quotes[0]}"` : ''}`),
      });
    }
  }

  // --- GBP completeness ---
  if (report.gbp) {
    sections.push({ type: 'heading', level: 2, text: 'Business Profile Health' });
    sections.push({
      type: 'paragraph',
      text: `Your Google Business Profile is ${report.gbp.completeness_pct}% complete based on the fields we can verify.` +
        (report.gbp.missing.length > 0
          ? ` Missing or unverified: ${report.gbp.missing.join(', ')}.`
          : ' All verifiable fields are complete.'),
    });
  }

  // --- Next steps ---
  if (report.next_steps.length > 0) {
    sections.push({ type: 'heading', level: 2, text: 'Recommended Next Steps' });
    sections.push({
      type: 'list',
      style: 'numbered',
      items: report.next_steps.map(s => `${s.title}: ${s.detail}`),
    });
  }

  const to = new Date();
  const from = new Date(to.getTime() - report.days * 86400000);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  return {
    title: `Local Performance Report: ${businessLabel}`,
    subtitle: `Last ${report.days} days`,
    domain: report.project.domain ?? undefined,
    dateRange: { from: fmt(from), to: fmt(to) },
    generatedAt: new Date(),
    sections,
  };
}
```

- [ ] In `src/pages/RankTracking.tsx`, wire the ExportMenu into the local project header (lines 637-645). Add imports near the existing export imports (lines 53-54): `import { buildLocalSEOReport } from '@/lib/export/adapters/localSEO';` and `import { fetchLocalPeriodReport } from '@/lib/local-seo';` (extend the existing `@/lib/local-seo` import at line 22) and ensure `captureElementPng` is already imported (it is, for rank tracking). Replace the header actions block:

```tsx
          <div className="flex items-center gap-2">
            <ExportMenu
              surface="local-seo"
              identifier={selectedLocalProject.business_name || selectedLocalProject.name}
              buildPayload={async () => {
                // Period comes from the page-level selector (7/14/30/90, default 30).
                const periodReport = await fetchLocalPeriodReport(selectedLocalProject.id, localReportPeriod);
                const [geoGridPng, ratingDistributionPng] = await Promise.all([
                  captureElementPng(document.getElementById('geogrid-map-export')),
                  captureElementPng(document.getElementById('rating-distribution-export')),
                ]);
                return buildLocalSEOReport({
                  report: periodReport,
                  charts: { geoGridPng, ratingDistributionPng },
                });
              }}
            />
            <Button variant="outline" onClick={() => setLocalAddKeywordsOpen(true)}>
              Add Keywords
            </Button>
            <Button onClick={handleCheckLocalRankings} disabled={checkingLocal}>
              <RefreshCw className={`h-4 w-4 mr-2 ${checkingLocal ? 'animate-spin' : ''}`} />
              {checkingLocal ? 'Checking...' : 'Check Local Rankings'}
            </Button>
          </div>
```

- [ ] Verify: SPA verification command (filtered tsc empty) + `cd datawise-seo-insight-main && npm run build`. UI exercise: open a local project, pick "Last 30 days" in the period selector, Export as PDF, open the file: title, KPI strip, rankings table, map visibility section with the captured map image, reviews block, next steps, and zero em dashes anywhere. If a browser is unavailable, say so.
- [ ] Commit: `git add datawise-seo-insight-main/src/lib/export/adapters/localSEO.ts datawise-seo-insight-main/src/lib/local-seo.ts datawise-seo-insight-main/src/types/local-seo.ts datawise-seo-insight-main/src/pages/RankTracking.tsx && git commit -m "feat(local): period-performance PDF/DOCX export with period selector"`

---

## Verification (staging end-to-end, from the spec)

Run after all tasks land, on staging with a real local project:

- [ ] Unit tests green: `cd datawise-seo-insight-main/workers && npm test` (zoomForRadius, competitor aggregation, snapshot upsert-or-skip, themes cache key, velocity, theme validation).
- [ ] Fetch reviews in the UI for a real local project; verify a row lands in D1: `SELECT project_id, fetched_count, response_rate, unanswered_low_star, created_at FROM local_review_snapshots ORDER BY created_at DESC LIMIT 3;` Refetch the same day: still one row for today.
- [ ] Reviews report renders: four header tiles (deltas show "no trend yet" until snapshots accumulate), rating distribution bars, theme cards hydrate after load; clicking the red tile applies "3 and below" + "Unanswered"; clicking a theme filters the list; Clear filters resets.
- [ ] Generate themes, reload the page: second load returns instantly with `cached: true` and the original `generated_at` (verify a single row in `local_review_themes` per hash). Refresh themes forces a new row.
- [ ] Run a geo-grid scan: verify `location_coordinate` in the worker logs ends with the radius-derived zoom (e.g. `,13z` for 5 km, never `17z`); verify up to 10 rows in `geogrid_competitors` for the new scan; Map competitors list renders under the map with the You highlight; loading an old (pre-feature) scan still shows competitors (aggregated from the blob).
- [ ] `GET /api/local-seo/projects/:id/geogrid-competitors?keyword=...` returns the scan series; after a second scan of the same keyword the list shows movement arrows.
- [ ] Export the 30-day PDF and read it end to end: plain-English intros, deltas called out, map image present, reviews block from snapshots/cached themes, GBP completeness, numbered next steps, no em dashes anywhere in the output. Export DOCX once as well.
- [ ] Stats cards: Review Velocity card appears with delta once two periods of data exist; Rating delta shows one decimal.
- [ ] Prod D1 migration applied manually (memory `feedback_prod_d1_migrations`) and verified: `SELECT name FROM sqlite_master WHERE name IN ('local_review_snapshots','local_review_themes','geogrid_competitors');` returns 3 rows.
