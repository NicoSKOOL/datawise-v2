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

// Maps zoom for a geo-grid point. Desktop Google Maps only returns businesses
// visible in the viewport, and the left results panel hides anything more than
// ~400px west of the centre. So the grid's east edge column (business to the
// west) silently dropped out when the zoom was picked from radius alone: at
// 53N the cut-off was 4.5-5km at 13z and 9-10km at 12z, doubling per zoom
// (measured live 2026-09-25, report d0c90bb4). Pick the tightest zoom whose
// visible half-width at this latitude clears the radius with margin. At US
// latitudes this reproduces the old 15/14/13/12z buckets.
const VISIBLE_WEST_PX = 380; // measured cut-off 391-434px, keep a safety margin
const EDGE_MARGIN = 1.1;
export function zoomForRadius(radiusKm: number, latitude: number): string {
  const lat = Number.isFinite(latitude) ? Math.min(Math.abs(latitude), 85) : 0;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (let z = 15; z > 10; z--) {
    const metersPerPx = (156543.03392 * cosLat) / 2 ** z;
    if ((VISIBLE_WEST_PX * metersPerPx) / 1000 >= radiusKm * EDGE_MARGIN) return `${z}z`;
  }
  return '10z';
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

// Review-count baselines. Every velocity number (dashboard card, Reviews tab,
// period report) must use the same rule: current count minus the count
// observed closest to the period start. A sample is only accepted within a
// tolerance of the target date; the old "newest row at or before the start,
// however old" fallback turned a 7-day report into a 34-day delta.
export interface ReviewCountSample { count: number | null; at: string }

function sampleMs(at: string): number {
  return Date.parse(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`);
}

export function pickBaselineCount(samples: ReviewCountSample[], targetMs: number, toleranceMs: number): number | null {
  let best: { count: number; dist: number } | null = null;
  for (const s of samples) {
    if (s.count == null) continue;
    const t = sampleMs(s.at);
    if (!Number.isFinite(t)) continue;
    const dist = Math.abs(t - targetMs);
    if (dist > toleranceMs) continue;
    if (!best || dist < best.dist) best = { count: s.count, dist };
  }
  return best ? best.count : null;
}

export function baselineToleranceMs(periodDays: number): number {
  return Math.max(2, periodDays * 0.25) * 86400000;
}

export function reviewVelocityFromSamples(
  samples: ReviewCountSample[],
  currentCount: number | null,
  periodDays: number,
  nowMs: number = Date.now(),
): { current: number | null; previous: number | null } {
  const day = 86400000;
  const tol = baselineToleranceMs(periodDays);
  const start = pickBaselineCount(samples, nowMs - periodDays * day, tol);
  const prevStart = pickBaselineCount(samples, nowMs - 2 * periodDays * day, tol);
  const v = computeVelocity({ currentCount, startOfPeriodCount: start, startOfPreviousPeriodCount: prevStart });
  // Review counts can dip (Google removals, a stale sample); gains never go negative.
  return {
    current: v.current == null ? null : Math.max(0, v.current),
    previous: v.previous == null ? null : Math.max(0, v.previous),
  };
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
  userStats?: { rating: number | null; reviews: number | null } | null,
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
  // place_id/cid), so synthesize its row from per-point positions. Top 3 share
  // counts top-3 points; avg_position covers every found point so it matches
  // the scan summary (geogrid_scans.avg_position) shown next to the table.
  if (userBusinessName) {
    const found = points.filter(p => p.position != null).map(p => p.position as number);
    const top3 = found.filter(p => p <= 3);
    if (top3.length > 0) {
      competitors.push({
        name: userBusinessName,
        appearances: top3.length,
        total_points: totalPoints,
        avg_position: Math.round((found.reduce((s, p) => s + p, 0) / found.length) * 10) / 10,
        best_position: Math.min(...found),
        rating: userStats?.rating ?? null,
        reviews: userStats?.reviews ?? null,
        is_user: true,
      });
    }
  }

  competitors.sort((a, b) =>
    b.appearances - a.appearances || (a.avg_position ?? 99) - (b.avg_position ?? 99));
  return competitors.slice(0, 10);
}

// Rows stored before 2026-09-25 carry a top-3-only user average and no
// rating/reviews. Normalise at read time (no history rewrite): the user row's
// average follows the scan summary, and missing rating/reviews come from the
// latest review snapshot.
export function withUserRowFacts(
  competitors: AggregatedCompetitor[],
  facts: { avgPosition: number | null; rating: number | null; reviews: number | null },
): AggregatedCompetitor[] {
  return competitors.map(c => c.is_user ? {
    ...c,
    avg_position: facts.avgPosition ?? c.avg_position,
    rating: c.rating ?? facts.rating,
    reviews: c.reviews ?? facts.reviews,
  } : c);
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

// LLM output that may arrive wrapped in code fences, prefaced with prose, or
// carrying trailing commas. Best-effort extraction of the first JSON object so
// a minor formatting deviation does not blank the whole panel. Returns the
// parsed value, or null if nothing parseable is found.
export function extractJsonObject(raw: string): unknown | null {
  if (typeof raw !== 'string') return null;
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidates: string[] = [];
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  candidates.push(cleaned);
  const relax = (s: string) => s.replace(/,\s*([}\]])/g, '$1'); // trailing commas
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
    try { return JSON.parse(relax(c)); } catch { /* try next */ }
  }
  return null;
}

// Models label sentiment freely ("neutral", "Positive", "mixed/neutral"). Map
// everything onto the three buckets the UI understands instead of rejecting
// the whole response over one stray label (the reason themes went blank for
// DeepSeek/OpenRouter users).
function normalizeSentiment(s: unknown): 'positive' | 'negative' | 'mixed' {
  const v = typeof s === 'string' ? s.trim().toLowerCase() : '';
  if (v === 'positive' || v === 'negative' || v === 'mixed') return v;
  if (v.startsWith('pos')) return 'positive';
  if (v.startsWith('neg')) return 'negative';
  return 'mixed'; // neutral, mixed/neutral, unknown -> mixed
}

// Tolerant validation of the LLM JSON. Returns null only when nothing usable
// remains (caller responds 502 with a retry hint). Individual malformed themes
// are dropped rather than failing the whole set; sentiments are normalized; a
// missing summary is tolerated. Out-of-range review_indexes are dropped,
// quotes capped at 2, themes capped at 8.
export function validateReviewThemes(
  raw: unknown,
  reviewCount: number
): { summary: string; themes: ReviewThemeResult[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { summary?: unknown; themes?: unknown };
  if (!Array.isArray(obj.themes)) return null;

  const themes: ReviewThemeResult[] = [];
  for (const t of obj.themes as Array<Record<string, unknown>>) {
    if (!t || typeof t !== 'object') continue;
    if (typeof t.theme !== 'string' || !t.theme.trim()) continue;
    const indexes = Array.isArray(t.review_indexes)
      ? (t.review_indexes as unknown[]).filter(
          (i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < reviewCount
        )
      : [];
    const quotes = Array.isArray(t.quotes)
      ? (t.quotes as unknown[]).filter((q): q is string => typeof q === 'string').slice(0, 2)
      : [];
    themes.push({
      theme: t.theme.trim(),
      sentiment: normalizeSentiment(t.sentiment),
      mention_count: typeof t.mention_count === 'number' ? t.mention_count : indexes.length,
      quotes,
      review_indexes: indexes,
    });
  }
  if (themes.length === 0) return null;
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  return { summary, themes: themes.slice(0, 8) };
}
