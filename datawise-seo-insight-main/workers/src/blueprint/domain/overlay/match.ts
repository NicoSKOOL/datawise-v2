// Pure, deterministic matching of an existing site's URLs to the planned pages
// stage 15 produced. Feeds stage 16 overlay_existing_site's Create / Update /
// Keep / Consolidate assignment. No network, clock, or randomness: given the same
// inputs (in any order) it returns the same result, which is what lets the
// overlay inventory be persisted and re-derived reproducibly.
//
// Tokenization note: we compare a URL's path tokens against a planned page's
// slug tokens, and (when present) an existing title's tokens against the planned
// title + primary keyword. All four are tokenized with the SAME slug normalizer
// (normalizeSlug: ascii-fold, lowercase, split on '/' and '-') rather than the
// locale-sensitive keyword normalizer. Using one locale-free tokenizer is
// deliberate: path segments and titles must produce comparable token sets, and a
// locale-dependent case-fold would make a path token and a title token for the
// same word fail to match. normalizeSlug is imported and reused, not reinvented.

import { normalizeSlug } from '../slug';
import type { PlannedPage } from '../page-plan/types';

// ---------------------------------------------------------------------------
// Match weights (module-local, documented constants).
//
// These are NOT ruleset thresholds: the ruleset (domain/page-plan/ruleset.ts,
// overlay block) pins keepMatchScoreMin / matchScoreMin, which are hashed by the
// drift test. The path-vs-title BLEND below is an internal scoring detail of how
// a single [0,1] match score is composed, not a decision threshold, so it lives
// here as a documented constant. Changing a decision boundary means editing the
// ruleset; changing how the score is blended means editing here.
//
// Path overlap is weighted above title overlap: a URL's path is a far more stable
// signal of what a page IS than its (rewritable, often brand-suffixed) <title>.
// When an existing page has no title at all, the title component is dropped and
// the path component is renormalized to carry the whole score (weight 1.0) rather
// than penalizing the page for a missing title.
// ---------------------------------------------------------------------------
const PATH_WEIGHT = 0.6;
const TITLE_WEIGHT = 0.4;

export interface ExistingPageInput {
  url: string;
  title: string | null;
}

// Jaccard overlap of two token sets, in [0,1]. Two empty sets overlap 0 (no
// evidence either way), never 1.
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function slugTokens(text: string): Set<string> {
  return new Set(
    normalizeSlug(text)
      .split(/[/-]/)
      .filter(Boolean)
  );
}

function urlPathTokens(rawUrl: string): Set<string> {
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    pathname = rawUrl;
  }
  return slugTokens(pathname);
}

function plannedTitleTokens(planned: PlannedPage): Set<string> {
  const tokens = slugTokens(planned.title);
  if (planned.primaryKeyword) {
    for (const t of slugTokens(planned.primaryKeyword)) tokens.add(t);
  }
  return tokens;
}

// Composite match score in [0,1] for one existing URL against one planned page.
// path-token jaccard blended with title-token jaccard; when the existing page has
// no title the score is path-only (title weight renormalized away).
export function scorePageMatch(existing: ExistingPageInput, planned: PlannedPage): number {
  const pathScore = jaccard(urlPathTokens(existing.url), slugTokens(planned.slug));
  if (existing.title === null) {
    return pathScore;
  }
  const titleScore = jaccard(slugTokens(existing.title), plannedTitleTokens(planned));
  return pathScore * PATH_WEIGHT + titleScore * TITLE_WEIGHT;
}

// ---------------------------------------------------------------------------
// Assignment output shapes (ready for Task 18 to persist / fold onto the plan).
// ---------------------------------------------------------------------------

// Overlay only ever assigns these three to a planned page; consolidate is a
// property of an EXISTING url (it proposes to fold into a planned page), carried
// on ExistingPageMatch below.
export type OverlayRecommendation = 'create' | 'update' | 'keep';

export interface PlannedPageMatch {
  logicalId: string;
  recommendation: OverlayRecommendation;
  // The existing URL that matched this page (keep/update), or null (create).
  matchedUrl: string | null;
  // The score behind a keep/update, or null for create.
  matchScore: number | null;
}

export interface ExistingPageMatch {
  url: string;
  // The planned page this URL was matched to one-to-one (keep/update), else null.
  matchedLogicalPageId: string | null;
  // The score behind either the one-to-one match or, for an unmatched URL, the
  // consolidation proposal below. Null when the URL matched nothing above the floor.
  matchScore: number | null;
  // For an unmatched URL that still overlaps a planned page above the floor: the
  // planned page it proposes to consolidate INTO. Never the URL's own matched
  // page (an unmatched URL has none, but the guard is explicit). Null otherwise.
  consolidateTargetLogicalId: string | null;
}

export interface OverlayMatchResult {
  plannedPages: PlannedPageMatch[];
  existingPages: ExistingPageMatch[];
}

export interface OverlayMatchThresholds {
  keepMatchScoreMin: number;
  matchScoreMin: number;
}

interface Pair {
  existingIndex: number;
  plannedIndex: number;
  score: number;
  url: string;
  logicalId: string;
}

// Total order over candidate pairs: highest score first, then url asc, then
// logicalId asc. Makes greedy assignment independent of input order.
function comparePairs(a: Pair, b: Pair): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.url !== b.url) return a.url < b.url ? -1 : 1;
  if (a.logicalId !== b.logicalId) return a.logicalId < b.logicalId ? -1 : 1;
  return 0;
}

// Greedy, deterministic one-to-one assignment of existing URLs to planned pages,
// then classification into Create / Update / Keep with Consolidate proposals for
// the leftover existing URLs.
export function assignMatches(
  existingPages: ExistingPageInput[],
  plannedPages: PlannedPage[],
  thresholds: OverlayMatchThresholds
): OverlayMatchResult {
  const { keepMatchScoreMin, matchScoreMin } = thresholds;

  // All eligible (score >= floor) pairs, best-first. Pairs below the floor are
  // never one-to-one matches; a below-floor existing URL becomes a consolidate
  // candidate or stays unmatched.
  const pairs: Pair[] = [];
  for (let e = 0; e < existingPages.length; e++) {
    for (let p = 0; p < plannedPages.length; p++) {
      const score = scorePageMatch(existingPages[e], plannedPages[p]);
      if (score >= matchScoreMin) {
        pairs.push({
          existingIndex: e,
          plannedIndex: p,
          score,
          url: existingPages[e].url,
          logicalId: plannedPages[p].logicalId,
        });
      }
    }
  }
  pairs.sort(comparePairs);

  const existingToPlanned = new Array<number>(existingPages.length).fill(-1);
  const plannedToExisting = new Array<number>(plannedPages.length).fill(-1);
  const matchScores = new Array<number>(existingPages.length).fill(0);

  for (const pair of pairs) {
    if (existingToPlanned[pair.existingIndex] !== -1) continue;
    if (plannedToExisting[pair.plannedIndex] !== -1) continue;
    existingToPlanned[pair.existingIndex] = pair.plannedIndex;
    plannedToExisting[pair.plannedIndex] = pair.existingIndex;
    matchScores[pair.existingIndex] = pair.score;
  }

  // Per-planned-page recommendation.
  const plannedResult: PlannedPageMatch[] = plannedPages.map((planned, p) => {
    const e = plannedToExisting[p];
    if (e === -1) {
      return { logicalId: planned.logicalId, recommendation: 'create', matchedUrl: null, matchScore: null };
    }
    const score = matchScores[e];
    const recommendation: OverlayRecommendation = score >= keepMatchScoreMin ? 'keep' : 'update';
    return { logicalId: planned.logicalId, recommendation, matchedUrl: existingPages[e].url, matchScore: score };
  });

  // Per-existing-URL result. Matched URLs report their planned page + score.
  // Unmatched URLs get a consolidate proposal: the best planned page at or above
  // the floor, tiebroken by logicalId, never the URL's own matched page.
  const existingResult: ExistingPageMatch[] = existingPages.map((existing, e) => {
    const matchedPlanned = existingToPlanned[e];
    if (matchedPlanned !== -1) {
      return {
        url: existing.url,
        matchedLogicalPageId: plannedPages[matchedPlanned].logicalId,
        matchScore: matchScores[e],
        consolidateTargetLogicalId: null,
      };
    }
    let bestLogicalId: string | null = null;
    let bestScore = -1;
    for (let p = 0; p < plannedPages.length; p++) {
      if (p === matchedPlanned) continue; // never self (matchedPlanned is -1 here; defensive)
      const score = scorePageMatch(existing, plannedPages[p]);
      if (score < matchScoreMin) continue;
      if (score > bestScore || (score === bestScore && bestLogicalId !== null && plannedPages[p].logicalId < bestLogicalId)) {
        bestScore = score;
        bestLogicalId = plannedPages[p].logicalId;
      }
    }
    if (bestLogicalId === null) {
      return { url: existing.url, matchedLogicalPageId: null, matchScore: null, consolidateTargetLogicalId: null };
    }
    return {
      url: existing.url,
      matchedLogicalPageId: null,
      matchScore: bestScore,
      consolidateTargetLogicalId: bestLogicalId,
    };
  });

  return { plannedPages: plannedResult, existingPages: existingResult };
}
