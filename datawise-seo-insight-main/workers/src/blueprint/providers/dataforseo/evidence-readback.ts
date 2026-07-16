import { SEARCH_INTENTS, type SearchIntent } from '../../contracts/enums';
import { normalizeKeyword } from '../../domain/keyword';
import { parseDfsResponse } from './envelope';
import { dfsCacheKey } from './call';

// Read-only re-parse of DFS response artifacts already persisted to R2 by
// blueprintDfsCall (call.ts step 6, key `runs/{runId}/dfs/{requestHash}.json`).
// Phase 3 only ever persisted 8 of the keywords table's 20 columns; the rest
// (core_keyword, search intent, monthly searches, serp item types, referring
// domains, competition) and every per-keyword ranking URL still live only in
// these raw artifacts. Nothing in this file writes anything: it exists so
// later stages (normalize_keyword_universe, clustering) can pull that data
// back out without re-fetching from DataForSEO.
//
// A call that hits call.ts's KV response cache (step 1-2) never writes an R2
// artifact for that run: its evidence_refs row has artifact_id NULL and
// operation suffixed ':cache', and the response lives only in
// env.KV under dfsCacheKey(request_hash). Production runs are mostly
// warm-cache, so this is the common path, not an edge case -- both readers
// below LEFT JOIN artifacts (not INNER JOIN) and fall back to a KV read,
// keyed off the same request_hash, whenever storage_key is null.

// R2 objects over this size are skipped and counted as missing rather than
// pulled fully into memory -- a single pathological artifact should never be
// able to blow the worker's memory budget for the whole readback pass.
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

export interface KeywordEnrichment {
  coreKeyword: string | null;
  mainIntent: SearchIntent | null;
  intentProbabilities: Record<string, number> | null;
  monthlySearches: Array<{ year: number; month: number; searchVolume: number }> | null;
  serpItemTypes: string[] | null;
  avgReferringDomains: number | null;
  paidCompetition: number | null;
}

export interface EvidenceReadbackResult<T> {
  data: T;
  artifactsRead: number;
  artifactsMissing: number; // evidence_refs rows whose artifact was absent/unparseable/oversized
}

// Enrichment is sourced from both plain keyword-metric calls (keyword_ideas,
// keyword_suggestions, keywords_for_site, keyword_overview,
// bulk_keyword_difficulty -- all evidence_refs.kind = 'keyword_metric') and
// ranked_keywords (kind = 'ranking'), whose items carry the exact same
// keyword_info/keyword_properties/search_intent_info/avg_backlinks_info
// shape. No operation filter is applied within these two kinds: a
// competitor_discovery artifact (also kind = 'ranking') has no `keyword`
// field on its items, so it simply yields zero enrichment matches rather
// than needing to be excluded up front -- see the
// "ignores non-keyword-shaped ranking items" test.
//
// LEFT JOIN (not INNER JOIN): a cache-hit call (call.ts step 1-2) writes an
// evidence_refs row with artifact_id NULL -- there is no artifacts row, let
// alone a storage_key, to INNER JOIN against. request_hash is selected
// alongside storage_key so a null-storage_key row can still be recovered
// from the KV response cache below.
const ENRICHMENT_EVIDENCE_ROWS_SQL = `
  SELECT DISTINCT a.storage_key AS storage_key, e.request_hash AS request_hash
  FROM evidence_refs e
  LEFT JOIN artifacts a ON a.id = e.artifact_id
  WHERE e.run_id = ? AND e.kind IN ('keyword_metric', 'ranking')
  ORDER BY storage_key ASC, request_hash ASC
`;

// Ranking URLs only ever come from ranked_keywords (a cache hit on the exact
// same request re-records the operation as 'ranked_keywords:cache' --
// call.ts step 2 -- so both variants must be read). competitor_discovery is
// also kind = 'ranking' but is a domain-vs-domain competitor list with no
// per-keyword SERP URL on it, so it is excluded by operation here (not left
// to fall out naturally like the enrichment query above, since ranking-URL
// callers need a precise "recognizably a ranked_keywords response" signal).
// Same LEFT JOIN reasoning as the enrichment query above.
const RANKED_KEYWORDS_EVIDENCE_ROWS_SQL = `
  SELECT DISTINCT a.storage_key AS storage_key, e.request_hash AS request_hash
  FROM evidence_refs e
  LEFT JOIN artifacts a ON a.id = e.artifact_id
  WHERE e.run_id = ? AND e.kind = 'ranking' AND e.operation IN ('ranked_keywords', 'ranked_keywords:cache')
  ORDER BY storage_key ASC, request_hash ASC
`;

// One unit of readback work: either a real R2 artifact (storageKey set) or a
// cache-hit evidence_refs row that must be recovered from KV by requestHash
// (storageKey null). request_hash is NOT NULL on every evidence_refs row, so
// it is always present regardless of which branch applies.
interface EvidenceWorkItem {
  storageKey: string | null;
  requestHash: string;
}

async function distinctEvidenceRows(d1: D1Database, runId: string, sql: string): Promise<EvidenceWorkItem[]> {
  const { results } = await d1
    .prepare(sql)
    .bind(runId)
    .all<{ storage_key: string | null; request_hash: string }>();
  return results.map((row) => ({ storageKey: row.storage_key, requestHash: row.request_hash }));
}

// Fetches one artifact's items, applying the size guard and tolerating any
// R2/JSON failure by returning null (counted as missing by the caller). Only
// a genuine D1 error (from distinctEvidenceRows, not this function) is
// allowed to throw -- a single bad artifact must never sink the whole
// readback.
async function fetchArtifactItems(r2: R2Bucket, storageKey: string): Promise<any[] | null> {
  let object: R2ObjectBody | null;
  try {
    object = await r2.get(storageKey);
  } catch {
    return null;
  }
  if (!object) return null;
  if (typeof object.size === 'number' && object.size > MAX_ARTIFACT_BYTES) return null;
  let text: string;
  try {
    text = await object.text();
  } catch {
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return null;
  }
  return parseDfsResponse(parsedJson).items;
}

// Recovers a cache-hit call's items from call.ts's KV response cache. The KV
// value is the exact same raw response envelope call.ts stores to R2 for a
// miss (rawJson = JSON.stringify(response), written in step 7) -- so this
// parses it identically to fetchArtifactItems, just without the R2 size
// guard (KV enforces its own value-size cap upstream). Absent/expired
// (kv.get returns null, TTL elapsed) or unparseable both return null and are
// counted as missing by the caller, same as a gone R2 object.
async function fetchKvCachedItems(kv: KVNamespace, requestHash: string): Promise<any[] | null> {
  let raw: string | null;
  try {
    raw = await kv.get(dfsCacheKey(requestHash));
  } catch {
    return null;
  }
  if (raw == null) return null;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseDfsResponse(parsedJson).items;
}

// Resolves one work item's items, routing to R2 or KV recovery as
// appropriate. `kvCache` dedupes the actual KV fetch by request_hash so N
// evidence_refs rows sharing one cache-hit request (e.g. the same call
// repeated later in the same run once its KV entry is already warm) only
// cost one KV read; each row is still individually counted into
// artifactsRead/artifactsMissing by the caller using this shared result.
async function resolveWorkItemItems(
  r2: R2Bucket,
  kv: KVNamespace,
  workItem: EvidenceWorkItem,
  kvCache: Map<string, any[] | null>
): Promise<any[] | null> {
  if (workItem.storageKey) {
    return fetchArtifactItems(r2, workItem.storageKey);
  }
  if (kvCache.has(workItem.requestHash)) {
    return kvCache.get(workItem.requestHash) ?? null;
  }
  const items = await fetchKvCachedItems(kv, workItem.requestHash);
  kvCache.set(workItem.requestHash, items);
  return items;
}

const SEARCH_INTENT_SET: ReadonlySet<string> = new Set(SEARCH_INTENTS);

// DFS's main_intent label is free text from the provider, not a validated
// enum -- an unexpected label (a new DFS intent value, a typo, a
// non-keyword-shaped item that happens to have a string here) must become
// null instead of being blindly cast to SearchIntent, which would let
// arbitrary strings leak into the keywords.main_intent column as if they
// were one of the five known values.
function normalizeSearchIntent(raw: unknown): SearchIntent | null {
  if (typeof raw !== 'string') return null;
  const lowered = raw.toLowerCase();
  return SEARCH_INTENT_SET.has(lowered) ? (lowered as SearchIntent) : null;
}

function extractMonthlySearches(info: any): KeywordEnrichment['monthlySearches'] {
  if (!Array.isArray(info?.monthly_searches)) return null;
  const out: Array<{ year: number; month: number; searchVolume: number }> = [];
  for (const entry of info.monthly_searches) {
    if (
      typeof entry?.year === 'number' &&
      typeof entry?.month === 'number' &&
      typeof entry?.search_volume === 'number'
    ) {
      out.push({ year: entry.year, month: entry.month, searchVolume: entry.search_volume });
    }
  }
  return out.length > 0 ? out : null;
}

function extractSerpItemTypes(info: any): string[] | null {
  const types = info?.serp_info?.serp_item_types;
  if (!Array.isArray(types)) return null;
  const strings = types.filter((t: unknown): t is string => typeof t === 'string');
  return strings.length > 0 ? strings : null;
}

// DFS's documented keyword_ideas/keyword_suggestions/keyword_overview
// response shape only ever carries intent LABELS (search_intent_info.
// main_intent, .foreign_intent as a string[]) -- no numeric probabilities.
// This reads a hypothetical `probabilities` map defensively in case a future
// endpoint variant adds one, but per the brief's "keep it honest" rule it
// never fabricates a { [label]: 1 } stand-in: today this is null for every
// real artifact.
function extractIntentProbabilities(searchIntentInfo: any): Record<string, number> | null {
  const probs = searchIntentInfo?.probabilities;
  if (!probs || typeof probs !== 'object') return null;
  const out: Record<string, number> = {};
  let any = false;
  for (const [label, value] of Object.entries(probs)) {
    if (typeof value === 'number') {
      out[label] = value;
      any = true;
    }
  }
  return any ? out : null;
}

// Mirrors normalizeKeywordItem's (normalize.ts) flat-vs-keyword_data nesting
// tolerance so this reader works against both keyword_ideas/keyword_
// suggestions-shaped (flat) and ranked_keywords-shaped (nested) artifacts.
function extractKeywordEnrichmentItem(item: any): { keyword: string; enrichment: KeywordEnrichment } | null {
  if (!item || typeof item !== 'object') return null;
  const kd = item.keyword_data ?? item;
  const keyword = kd?.keyword ?? item.keyword;
  if (typeof keyword !== 'string' || keyword.length === 0) return null;

  const info = kd?.keyword_info ?? {};
  const props = kd?.keyword_properties ?? {};
  const searchIntentInfo = kd?.search_intent_info ?? {};
  const backlinks = kd?.avg_backlinks_info ?? {};

  return {
    keyword,
    enrichment: {
      coreKeyword: typeof props?.core_keyword === 'string' ? props.core_keyword : null,
      mainIntent: normalizeSearchIntent(searchIntentInfo?.main_intent),
      intentProbabilities: extractIntentProbabilities(searchIntentInfo),
      monthlySearches: extractMonthlySearches(info),
      serpItemTypes: extractSerpItemTypes(info),
      avgReferringDomains:
        typeof backlinks?.referring_main_domains === 'number' ? backlinks.referring_main_domains : null,
      paidCompetition: typeof info?.competition === 'number' ? info.competition : null,
    },
  };
}

// First-non-null-wins, field by field. `into` is mutated in place; callers
// iterate artifacts in deterministic storage_key order so repeated calls
// against the same map produce a reproducible merge regardless of how many
// times this function runs.
function mergeEnrichmentInto(into: KeywordEnrichment, from: KeywordEnrichment): void {
  into.coreKeyword ??= from.coreKeyword;
  into.mainIntent ??= from.mainIntent;
  into.intentProbabilities ??= from.intentProbabilities;
  into.monthlySearches ??= from.monthlySearches;
  into.serpItemTypes ??= from.serpItemTypes;
  into.avgReferringDomains ??= from.avgReferringDomains;
  into.paidCompetition ??= from.paidCompetition;
}

export async function loadKeywordEnrichmentFromArtifacts(
  d1: D1Database,
  r2: R2Bucket,
  kv: KVNamespace,
  runId: string,
  locale: string
): Promise<EvidenceReadbackResult<Map<string, KeywordEnrichment>>> {
  const workItems = await distinctEvidenceRows(d1, runId, ENRICHMENT_EVIDENCE_ROWS_SQL);
  const data = new Map<string, KeywordEnrichment>();
  const kvCache = new Map<string, any[] | null>();
  let artifactsRead = 0;
  let artifactsMissing = 0;

  for (const workItem of workItems) {
    const items = await resolveWorkItemItems(r2, kv, workItem, kvCache);
    if (items === null) {
      artifactsMissing += 1;
      continue;
    }
    artifactsRead += 1;
    for (const item of items) {
      const extracted = extractKeywordEnrichmentItem(item);
      if (!extracted) continue;
      const normalized = normalizeKeyword(extracted.keyword, locale);
      const existing = data.get(normalized);
      if (existing) {
        mergeEnrichmentInto(existing, extracted.enrichment);
      } else {
        data.set(normalized, extracted.enrichment);
      }
    }
  }

  return { data, artifactsRead, artifactsMissing };
}

// Lowercases the host, strips protocol/query/fragment, and drops a single
// trailing slash while preserving path case (paths ARE case-sensitive on
// most servers; hostnames are not). Returns null for anything that fails to
// parse as a URL instead of throwing -- this reads provider data, which must
// never abort a batch over one malformed URL.
export function normalizeSerpUrl(url: string): string | null {
  if (typeof url !== 'string' || url.trim().length === 0) return null;
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) return null;
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path === '/') path = '';
  return `${host}${path}`;
}

function extractRankingUrlItem(item: any): { keyword: string; url: string } | null {
  if (!item || typeof item !== 'object') return null;
  const kd = item.keyword_data ?? item;
  const keyword = kd?.keyword ?? item.keyword;
  if (typeof keyword !== 'string' || keyword.length === 0) return null;
  // Same path normalizeRankedKeywordItem (competitors.ts) reads for
  // rankingUrl: ranked_serp_element.serp_item.url.
  const rawUrl = item?.ranked_serp_element?.serp_item?.url;
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;
  return { keyword, url: rawUrl };
}

export async function loadCompetitorRankingUrls(
  d1: D1Database,
  r2: R2Bucket,
  kv: KVNamespace,
  runId: string,
  locale: string
): Promise<EvidenceReadbackResult<Map<string, string[]>>> {
  const workItems = await distinctEvidenceRows(d1, runId, RANKED_KEYWORDS_EVIDENCE_ROWS_SQL);
  const byKeyword = new Map<string, Set<string>>();
  const kvCache = new Map<string, any[] | null>();
  let artifactsRead = 0;
  let artifactsMissing = 0;

  for (const workItem of workItems) {
    const items = await resolveWorkItemItems(r2, kv, workItem, kvCache);
    if (items === null) {
      artifactsMissing += 1;
      continue;
    }
    artifactsRead += 1;
    for (const item of items) {
      const extracted = extractRankingUrlItem(item);
      if (!extracted) continue;
      const normalizedUrl = normalizeSerpUrl(extracted.url);
      if (!normalizedUrl) continue;
      const normalizedKeyword = normalizeKeyword(extracted.keyword, locale);
      const set = byKeyword.get(normalizedKeyword) ?? new Set<string>();
      set.add(normalizedUrl);
      byKeyword.set(normalizedKeyword, set);
    }
  }

  const data = new Map<string, string[]>();
  for (const [keyword, urls] of byKeyword) {
    data.set(keyword, [...urls].sort());
  }

  return { data, artifactsRead, artifactsMissing };
}
