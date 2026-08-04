import type { NormalizedProjectBrief, KeywordEvidence } from '../../contracts/types';
import type { SearchIntent } from '../../contracts/enums';
// Type-only import from providers/: KeywordEnrichment is the exact shape
// providers/dataforseo/evidence-readback.ts's loadKeywordEnrichmentFromArtifacts
// already returns (Task 6, landed). Re-declaring an identical structural type
// here just to avoid a cross-layer import would drift the moment either side
// changes a field; `import type` is erased at compile time (no runtime
// dependency, no bundle coupling), and workers/src/blueprint's own boundary
// script (scripts/check-blueprint-boundary.mjs) only polices imports of the
// blueprint module from OUTSIDE it, not internal domain/providers direction,
// so this does not violate any enforced rule.
import type { KeywordEnrichment } from '../../providers/dataforseo/evidence-readback';
import { scoreKeywordRelevance, scoreKeywordOpportunity } from '../score';
import { detectLanguageMismatch } from './language';
import { buildSeedQueries } from '../seeds';
import { normalizeKeyword } from '../keyword';
import { V1_LIMITS } from '../../contracts/limits';
import type { ClusterRuleset } from './ruleset';

// The subset of the keywords table's columns this stage actually reads.
// Deliberately NOT the full 20-column row: relevance_score/opportunity_score/
// language_code/is_language_mismatch/excluded_reason are write-only outputs
// of this stage (always recomputed fresh every run, never read back in), so
// they have no reason to appear here -- only the enrichment-mergeable fields
// (first-non-null semantics: this stage must know their CURRENT null-ness to
// decide whether to fill them) and the two scoring inputs Phase 3 already
// populated (search_volume, keyword_difficulty).
export interface KeywordRowLite {
  id: string;
  normalizedKeyword: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  coreKeyword: string | null;
  mainIntent: SearchIntent | null;
  intentProbabilities: Record<string, number> | null;
  monthlySearches: Array<{ year: number; month: number; searchVolume: number }> | null;
  serpItemTypes: string[] | null;
  avgReferringDomains: number | null;
  paidCompetition: number | null;
}

// Per-keyword field updates the handler turns into an `UPDATE keywords SET
// ... WHERE id = ?`. The seven enrichment fields are optional: present only
// when this keyword actually got a new value out of the enrichment merge
// (step 1). The other five are always present: they are unconditionally
// recomputed every run (never gated on the row's current value), so there is
// nothing to omit.
export interface KeywordUniverseUpdate {
  coreKeyword?: string | null;
  mainIntent?: SearchIntent | null;
  intentProbabilities?: Record<string, number> | null;
  monthlySearches?: Array<{ year: number; month: number; searchVolume: number }> | null;
  serpItemTypes?: string[] | null;
  avgReferringDomains?: number | null;
  paidCompetition?: number | null;
  relevanceScore: number;
  opportunityScore: number | null;
  languageCode: string | null;
  isLanguageMismatch: boolean;
  excludedReason: 'excluded_topic' | 'language_mismatch' | 'relevance_cap' | null;
}

export interface UniverseNormalizationPlan {
  updates: Array<{ keywordId: string; fields: KeywordUniverseUpdate }>;
  serviceLinks: Array<[keywordId: string, serviceId: string]>;
  serviceAreaLinks: Array<[keywordId: string, serviceAreaId: string]>;
  // Keywords that name a US state or major city (cluster-v3 geo lexicon) NOT
  // matching any brief service area. NOT excluded here: stage 8 only FLAGS them,
  // and the Phase D adjudicator makes the actual out_of_area exclusion call
  // (its hard rule forbids excluding any keyword that token-matches a brief
  // service area). The handler surfaces this list on the normalize stage output
  // JSON so the adjudicator can read it back with loadStageOutput. Sorted by
  // keywordId; matchedGeoTerms sorted, so the payload is deterministic.
  geoCandidates: Array<{ keywordId: string; matchedGeoTerms: string[] }>;
  counters: {
    total: number;
    retained: number;
    excluded: number;
    languageMismatches: number;
    enriched: number;
  };
}

// Same full-token-match predicate domain/score.ts's excluded-topic penalty
// uses (scoreKeywordRelevance), mirrored here rather than imported because
// score.ts computes it inline as part of a larger score, not as its own
// exported function. The keyword's own tokens are already lowercase
// (normalizeKeyword output). `text` is lowercased here (like score.ts's
// tokenOverlap does) rather than assumed pre-lowercased: excludedTopics and
// service normalizedName/synonyms ARE lowercased by brief normalization
// (domain/brief.ts), but service area `city` is only trimmed, never
// case-folded (domain/brief.ts's ServiceAreaInput parsing keeps the user's
// original casing, e.g. "Austin") -- so this function cannot assume any of
// its callers already did that work.
function allTokensPresent(text: string, keywordTokens: ReadonlySet<string>): boolean {
  const textTokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  return textTokens.length > 0 && textTokens.every((t) => keywordTokens.has(t));
}

function matchesExcludedTopic(keywordTokens: ReadonlySet<string>, brief: NormalizedProjectBrief): boolean {
  return brief.excludedTopics.some((topic) => allTokensPresent(topic, keywordTokens));
}

// True when `termTokens` appear as a contiguous run inside `tokens` (in order).
// Multi-word geo terms ("san antonio", "north carolina") only match when their
// words are adjacent, so "san jose antonio" never matches "san antonio". Pure.
function containsConsecutive(tokens: readonly string[], termTokens: readonly string[]): boolean {
  if (termTokens.length === 0 || tokens.length < termTokens.length) return false;
  for (let i = 0; i + termTokens.length <= tokens.length; i++) {
    let matches = true;
    for (let j = 0; j < termTokens.length; j++) {
      if (tokens[i + j] !== termTokens[j]) { matches = false; break; }
    }
    if (matches) return true;
  }
  return false;
}

// Applies the enrichment merge (step 1): first-non-null-wins, field by
// field, against the row's CURRENT values only -- an existing non-null D1
// value is never overwritten, even if the enrichment map has a different
// value for that field (that would silently rewrite evidence a prior run,
// or a different provider call this same run, already committed).
function planEnrichmentFields(
  row: KeywordRowLite,
  enrichment: KeywordEnrichment | undefined
): { fields: Partial<KeywordUniverseUpdate>; wasEnriched: boolean } {
  if (!enrichment) return { fields: {}, wasEnriched: false };
  const fields: Partial<KeywordUniverseUpdate> = {};
  let wasEnriched = false;
  if (row.coreKeyword === null && enrichment.coreKeyword !== null) {
    fields.coreKeyword = enrichment.coreKeyword;
    wasEnriched = true;
  }
  if (row.mainIntent === null && enrichment.mainIntent !== null) {
    fields.mainIntent = enrichment.mainIntent;
    wasEnriched = true;
  }
  if (row.intentProbabilities === null && enrichment.intentProbabilities !== null) {
    fields.intentProbabilities = enrichment.intentProbabilities;
    wasEnriched = true;
  }
  if (row.monthlySearches === null && enrichment.monthlySearches !== null) {
    fields.monthlySearches = enrichment.monthlySearches;
    wasEnriched = true;
  }
  if (row.serpItemTypes === null && enrichment.serpItemTypes !== null) {
    fields.serpItemTypes = enrichment.serpItemTypes;
    wasEnriched = true;
  }
  if (row.avgReferringDomains === null && enrichment.avgReferringDomains !== null) {
    fields.avgReferringDomains = enrichment.avgReferringDomains;
    wasEnriched = true;
  }
  if (row.paidCompetition === null && enrichment.paidCompetition !== null) {
    fields.paidCompetition = enrichment.paidCompetition;
    wasEnriched = true;
  }
  return { fields, wasEnriched };
}

// Deterministic tie-broken comparator for the retention cap: relevance_score
// DESC (nulls last), then search_volume DESC (nulls last), then
// normalized_keyword ASC. Never depends on iteration/insertion order, so the
// same input produces the same ranking on every run (Array.prototype.sort is
// itself stable, but a comparator with no fallback would still leave ties
// resolved by insertion order -- normalized_keyword ASC removes that last
// degree of freedom entirely).
function compareForRetentionCap(
  a: { relevanceScore: number; searchVolume: number | null; normalizedKeyword: string },
  b: { relevanceScore: number; searchVolume: number | null; normalizedKeyword: string }
): number {
  if (a.relevanceScore !== b.relevanceScore) return b.relevanceScore - a.relevanceScore;
  if (a.searchVolume !== b.searchVolume) {
    if (a.searchVolume === null) return 1;
    if (b.searchVolume === null) return -1;
    return b.searchVolume - a.searchVolume;
  }
  return a.normalizedKeyword < b.normalizedKeyword ? -1 : a.normalizedKeyword > b.normalizedKeyword ? 1 : 0;
}

// USER-SEED EXEMPTION, resolution of the brief's open question: the
// `keywords` table has no per-row marker for "this came from a user-declared
// seed" (persistKeywordCandidates, orchestration/research-handlers.ts, only
// ever writes MergedKeyword's normalized_keyword/display_keyword/metrics --
// it never persists MergedKeyword.sources, and SeedQuery provenance is
// captured only as keyword_services/keyword_service_areas join rows, which
// also match plenty of NON-seed keywords discovered via providers). So there
// is nothing on the row itself to read.
//
// Phase 3's own user-seed guarantee (appendMissingUserSeeds,
// research-handlers.ts) is keyed purely off buildSeedQueries(brief, ...)'s
// output, normalized with the exact same normalizeKeyword(query, locale)
// call collect_keyword_evidence uses. This function re-derives that same
// set from the brief alone -- deterministic, no DB read needed -- rather
// than inventing a new column. Any keyword whose normalized form is in this
// set is a user seed by construction, whether or not a provider also
// happened to surface it.
function userSeedNormalizedKeywords(brief: NormalizedProjectBrief): Set<string> {
  const { seeds } = buildSeedQueries(brief, { maxTotalSeeds: V1_LIMITS.maxSeedQueries, includePrimaryAreaSeeds: true });
  const locale = `${brief.languageCode}-${brief.countryIso}`;
  const out = new Set<string>();
  for (const seed of seeds) {
    const normalized = normalizeKeyword(seed.query, locale);
    if (normalized) out.add(normalized);
  }
  return out;
}

export function planUniverseNormalization(input: {
  keywords: KeywordRowLite[];
  enrichment: Map<string, KeywordEnrichment>;
  brief: NormalizedProjectBrief;
  ruleset: ClusterRuleset;
}): UniverseNormalizationPlan {
  const { keywords, enrichment, brief, ruleset } = input;
  const userSeeds = userSeedNormalizedKeywords(brief);

  const serviceLinks: Array<[string, string]> = [];
  const serviceAreaLinks: Array<[string, string]> = [];

  // Geo lexicon (cluster-v3): deduped state + city terms, and the brief's
  // service-area cities as token sets. A matched geo term is "in area" when all
  // of its tokens are present in some brief service area's city (mirrors
  // allTokensPresent, so "austin" matches an "Austin, TX" area). A keyword is a
  // geo_candidate when it matches at least one geo term that is NOT in area.
  const geoTerms = [...new Set([...ruleset.geo.stateTokens, ...ruleset.geo.cityTokens])];
  const briefAreaTokenSets = brief.serviceAreas.map(
    (area) => new Set(area.city.toLowerCase().split(/\s+/).filter(Boolean))
  );
  const termIsBriefArea = (termTokens: readonly string[]): boolean =>
    briefAreaTokenSets.some((set) => termTokens.every((t) => set.has(t)));
  const geoCandidates: Array<{ keywordId: string; matchedGeoTerms: string[] }> = [];

  interface WorkingRow {
    keywordId: string;
    normalizedKeyword: string;
    searchVolume: number | null;
    fields: KeywordUniverseUpdate;
    isUserSeed: boolean;
  }

  const working: WorkingRow[] = [];
  let enrichedCount = 0;
  let languageMismatchCount = 0;

  for (const row of keywords) {
    const tokenList = row.normalizedKeyword.split(' ').filter(Boolean);
    const tokens = new Set(tokenList);

    // Step 0 (cluster-v3): geo_candidate flag. Independent of the exclusion
    // pipeline below -- flagged keywords are NOT excluded here (the adjudicator
    // decides out_of_area later), they only carry the flag on the stage output.
    const outOfAreaTerms = new Set<string>();
    for (const term of geoTerms) {
      const termTokens = term.split(' ');
      const present = termTokens.length === 1 ? tokens.has(term) : containsConsecutive(tokenList, termTokens);
      if (present && !termIsBriefArea(termTokens)) outOfAreaTerms.add(term);
    }
    if (outOfAreaTerms.size > 0) {
      geoCandidates.push({ keywordId: row.id, matchedGeoTerms: [...outOfAreaTerms].sort() });
    }

    // Step 1: enrichment merge (first-non-null-at-row-level).
    const { fields: enrichmentFields, wasEnriched } = planEnrichmentFields(row, enrichment.get(row.normalizedKeyword));
    if (wasEnriched) enrichedCount += 1;

    // Step 2: scores. Built from the row's ALREADY-PERSISTED search_volume/
    // keyword_difficulty (Phase 3 metrics), never from the enrichment map --
    // evidence-readback's KeywordEnrichment carries no search_volume/cpc/
    // difficulty fields of its own.
    const evidenceForScoring: KeywordEvidence = {
      normalizedKeyword: row.normalizedKeyword,
      variants: [row.normalizedKeyword],
      sources: [],
      metrics: { searchVolume: row.searchVolume, cpcUsd: null, difficulty: row.keywordDifficulty },
      evidenceRefs: [],
    };
    const relevance = scoreKeywordRelevance(evidenceForScoring, brief, ruleset.universe.relevanceRules);
    const opportunity = scoreKeywordOpportunity(evidenceForScoring, ruleset.universe.opportunityRules);

    // Step 3: language. Always recomputed (not gated on any existing value):
    // this is the authoritative per-keyword language call, not an
    // enrichment backfill.
    const isMismatch = detectLanguageMismatch(row.normalizedKeyword, brief.languageCode);
    if (isMismatch) languageMismatchCount += 1;
    const languageCode = isMismatch ? null : brief.languageCode;

    // Step 4: service/area linking. Emits every match unconditionally
    // (simpler than diffing against existing join rows); the handler
    // persists these as INSERT OR IGNORE, so a keyword already linked to a
    // service/area from an earlier attempt or a different stage is a no-op,
    // never a duplicate or an error.
    for (const service of brief.services) {
      const names = [service.normalizedName, ...service.synonyms];
      if (names.some((name) => allTokensPresent(name, tokens))) {
        serviceLinks.push([row.id, service.id]);
      }
    }
    for (const area of brief.serviceAreas) {
      if (allTokensPresent(area.city, tokens)) {
        serviceAreaLinks.push([row.id, area.id]);
      }
    }

    // Step 5: exclusion precedence (excluded_topic > language_mismatch >
    // relevance_cap). relevance_cap is decided in a second pass below, once
    // every keyword's rank is known; every other reason is decided here.
    let excludedReason: KeywordUniverseUpdate['excludedReason'] = null;
    if (matchesExcludedTopic(tokens, brief)) {
      excludedReason = 'excluded_topic';
    } else if (isMismatch) {
      excludedReason = 'language_mismatch';
    }

    const fields: KeywordUniverseUpdate = {
      ...enrichmentFields,
      relevanceScore: relevance.total,
      opportunityScore: opportunity?.total ?? null,
      languageCode,
      isLanguageMismatch: isMismatch,
      excludedReason,
    };

    working.push({
      keywordId: row.id,
      normalizedKeyword: row.normalizedKeyword,
      searchVolume: row.searchVolume,
      fields,
      isUserSeed: userSeeds.has(row.normalizedKeyword),
    });
  }

  // Retention cap: applies only to keywords not already excluded by a
  // higher-precedence reason, and never to a user-seed-exempt keyword
  // (exempt from both the numeric cap AND from ever being tagged
  // 'relevance_cap', per this task's brief).
  // filter() already returns a fresh array, so sorting it in place here does
  // not disturb `working`'s own order (which the final `updates` map below
  // still relies on).
  const ranked = working
    .filter((w) => w.fields.excludedReason === null && !w.isUserSeed)
    .sort((a, b) =>
      compareForRetentionCap(
        { relevanceScore: a.fields.relevanceScore, searchVolume: a.searchVolume, normalizedKeyword: a.normalizedKeyword },
        { relevanceScore: b.fields.relevanceScore, searchVolume: b.searchVolume, normalizedKeyword: b.normalizedKeyword }
      )
    );

  const beyondCap = new Set(ranked.slice(ruleset.universe.maxRetained).map((w) => w.keywordId));
  for (const w of working) {
    if (beyondCap.has(w.keywordId)) {
      w.fields.excludedReason = 'relevance_cap';
    }
  }

  const excludedCount = working.filter((w) => w.fields.excludedReason !== null).length;

  geoCandidates.sort((a, b) => (a.keywordId < b.keywordId ? -1 : a.keywordId > b.keywordId ? 1 : 0));

  return {
    updates: working.map((w) => ({ keywordId: w.keywordId, fields: w.fields })),
    serviceLinks,
    serviceAreaLinks,
    geoCandidates,
    counters: {
      total: working.length,
      retained: working.length - excludedCount,
      excluded: excludedCount,
      languageMismatches: languageMismatchCount,
      enriched: enrichedCount,
    },
  };
}
