import type { ConfidenceLabel, SearchIntent } from '../contracts/enums';
import type { NormalizedProjectBrief } from '../contracts/types';
import { normalizeKeyword } from '../domain/keyword';
import type {
  ClusterSerpFacts, CompetitorPageFact, PagePlanBriefFacts, PagePlanCluster, PagePlanFacts,
} from '../domain/page-plan/types';

// Facts loader for stage 15 `build_page_plan`. Assembles the fully-serializable
// PagePlanFacts the pure engine (domain/page-plan/engine.ts) consumes, from this
// run's D1 rows. Every SELECT has a total ORDER BY, and missing evidence is
// preserved as null / absent (never fabricated as 0): the handoff's §2.4
// "missing is not zero" rule, carried all the way into the signal inputs.
//
// Kept out of page-plan-handlers.ts (which owns the parse_competitor_pages
// handler) so the assembly is independently unit-testable against seeded D1,
// mirroring how clustering-handlers.ts keeps its own loaders beside its handler.

const INTENTS = new Set<string>(['transactional', 'commercial', 'informational', 'navigational', 'unknown']);
const CONFIDENCE_LABELS = new Set<string>(['low', 'medium', 'high']);

function asIntent(raw: string | null): SearchIntent | null {
  return raw !== null && INTENTS.has(raw) ? (raw as SearchIntent) : null;
}
function asConfidence(raw: string | null): ConfidenceLabel | null {
  return raw !== null && CONFIDENCE_LABELS.has(raw) ? (raw as ConfidenceLabel) : null;
}

// Normalized tokens of a phrase (>= 2 chars). normalizeKeyword lowercases,
// collapses whitespace, and strips punctuation, so a plain space split yields
// clean tokens comparable across cluster core keywords and competitor titles.
function toTokens(text: string, locale: string): string[] {
  return normalizeKeyword(text, locale).split(' ').filter((t) => t.length >= 2);
}

// ---------------------------------------------------------------------------
// Brief projection
// ---------------------------------------------------------------------------

// PagePlanBriefFacts is the minimal projection the engine + signals need; it is
// a straight, total-ordered slice of the already-normalized brief (no D1 read).
export function briefFactsFrom(brief: NormalizedProjectBrief): PagePlanBriefFacts {
  return {
    businessName: brief.businessName,
    normalizedBusinessName: brief.normalizedBusinessName,
    category: brief.category,
    languageCode: brief.languageCode,
    countryIso: brief.countryIso,
    services: brief.services
      .map((s) => ({ id: s.id, name: s.name, normalizedName: s.normalizedName, priority: s.priority }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    serviceAreas: brief.serviceAreas
      .map((a) => ({ id: a.id, city: a.city, region: a.region, isPrimary: a.isPrimary, uniqueProof: a.uniqueProof.slice() }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface ClusterRow {
  id: string;
  label: string;
  intent: string | null;
  service_id: string | null;
  service_area_id: string | null;
  confidence_label: string | null;
  primary_keyword_id: string | null;
  primary_normalized: string | null;
  primary_core: string | null;
}

interface ClusterVolumeRow {
  cluster_id: string;
  volume_sum: number | null;
  volume_count: number;
}

interface ClusterQueryRow {
  cluster_id: string;
  nk: string | null;
}

interface OrganicItem {
  rank: number | null;
  url: string | null;
}

interface ParsedPageRow {
  cluster_id: string;
  competitor_domain: string | null;
  fetch_state: string;
  headings_json: string | null;
  topics_json: string | null;
}

function parseJson<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

// One row per cluster with its primary keyword's normalized + core forms.
async function loadClusterRows(d1: D1Database, runId: string): Promise<ClusterRow[]> {
  const { results } = await d1
    .prepare(
      `SELECT kc.id AS id, kc.label AS label, kc.intent AS intent,
              kc.service_id AS service_id, kc.service_area_id AS service_area_id,
              kc.confidence_label AS confidence_label, kc.primary_keyword_id AS primary_keyword_id,
              pk.normalized_keyword AS primary_normalized, pk.core_keyword AS primary_core
       FROM keyword_clusters kc
       LEFT JOIN keywords pk ON pk.id = kc.primary_keyword_id
       WHERE kc.run_id = ?
       ORDER BY kc.id ASC`,
    )
    .bind(runId)
    .all<ClusterRow>();
  return results ?? [];
}

// Addressable volume per cluster: SUM of member keyword volumes plus the count
// of members that actually carried a volume. The count is what lets the caller
// return null (no member had a volume) instead of 0 (handoff §2.4).
async function loadClusterVolumes(d1: D1Database, runId: string): Promise<Map<string, ClusterVolumeRow>> {
  const { results } = await d1
    .prepare(
      `SELECT ck.cluster_id AS cluster_id,
              SUM(k.search_volume) AS volume_sum,
              COUNT(k.search_volume) AS volume_count
       FROM cluster_keywords ck
       JOIN keyword_clusters kc ON kc.id = ck.cluster_id
       JOIN keywords k ON k.id = ck.keyword_id
       WHERE kc.run_id = ?
       GROUP BY ck.cluster_id
       ORDER BY ck.cluster_id ASC`,
    )
    .bind(runId)
    .all<ClusterVolumeRow>();
  const map = new Map<string, ClusterVolumeRow>();
  for (const row of results ?? []) map.set(row.cluster_id, row);
  return map;
}

// Representative query per cluster (its primary keyword's normalized form),
// used to look up SERP snapshots. Ordered for stability.
async function loadClusterQueries(d1: D1Database, runId: string): Promise<Map<string, string>> {
  const { results } = await d1
    .prepare(
      `SELECT kc.id AS cluster_id, pk.normalized_keyword AS nk
       FROM keyword_clusters kc
       LEFT JOIN keywords pk ON pk.id = kc.primary_keyword_id
       WHERE kc.run_id = ?
       ORDER BY kc.id ASC`,
    )
    .bind(runId)
    .all<ClusterQueryRow>();
  const map = new Map<string, string>();
  for (const row of results ?? []) {
    if (row.nk !== null) map.set(row.cluster_id, row.nk);
  }
  return map;
}

// Organic SERP URLs keyed by the snapshot keyword's normalized_keyword, merged
// across snapshots (rank ASC nulls-last, url ASC), deduped by url. Same join
// convention parse_competitor_pages' loadSnapshotOrganicByQuery uses. A query
// with no snapshot is simply absent from the map (serp.urls stays null: SERP
// data was never collected, never assumed empty).
async function loadOrganicByQuery(d1: D1Database, runId: string): Promise<Map<string, string[]>> {
  const { results } = await d1
    .prepare(
      `SELECT k.normalized_keyword AS nk, s.organic_json AS organic_json
       FROM serp_snapshots s JOIN keywords k ON k.id = s.keyword_id
       WHERE s.run_id = ? ORDER BY s.id ASC`,
    )
    .bind(runId)
    .all<{ nk: string; organic_json: string | null }>();

  const byQuery = new Map<string, Map<string, OrganicItem>>();
  for (const row of results ?? []) {
    const organic = parseJson<OrganicItem[]>(row.organic_json) ?? [];
    let bucket = byQuery.get(row.nk);
    if (!bucket) {
      bucket = new Map<string, OrganicItem>();
      byQuery.set(row.nk, bucket);
    }
    for (const item of organic) {
      if (typeof item?.url !== 'string' || item.url.length === 0) continue;
      if (!bucket.has(item.url)) bucket.set(item.url, { rank: item.rank ?? null, url: item.url });
    }
  }

  const out = new Map<string, string[]>();
  for (const [nk, bucket] of byQuery) {
    const urls = [...bucket.values()]
      .sort((a, b) => {
        const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
        const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return (a.url ?? '') < (b.url ?? '') ? -1 : (a.url ?? '') > (b.url ?? '') ? 1 : 0;
      })
      .map((i) => i.url!)
      .filter((u): u is string => u.length > 0);
    out.set(nk, urls);
  }
  return out;
}

// Cluster ids with at least one member keyword whose SERP snapshot showed a
// local pack. Used (together with a service-area link) to derive
// hasLocalizedEvidence: real local SERP behavior, not an assumed default.
async function loadLocalPackClusters(d1: D1Database, runId: string): Promise<Set<string>> {
  const { results } = await d1
    .prepare(
      `SELECT DISTINCT ck.cluster_id AS cluster_id
       FROM serp_snapshots s
       JOIN cluster_keywords ck ON ck.keyword_id = s.keyword_id
       JOIN keyword_clusters kc ON kc.id = ck.cluster_id
       WHERE s.run_id = ? AND kc.run_id = ? AND s.local_pack_present = 1
       ORDER BY ck.cluster_id ASC`,
    )
    .bind(runId, runId)
    .all<{ cluster_id: string }>();
  return new Set((results ?? []).map((r) => r.cluster_id));
}

// Parsed competitor pages per cluster, joined to the competitor's domain. A row
// exists for every (cluster, url) parse_competitor_pages attempted; hasParsedData
// separates a real content extract ('parsed') from an empty/blocked/failed fetch
// (evidence absent). Ordered so token sets assemble deterministically.
async function loadCompetitorPageRows(d1: D1Database, runId: string): Promise<ParsedPageRow[]> {
  const { results } = await d1
    .prepare(
      `SELECT p.cluster_id AS cluster_id, c.domain AS competitor_domain,
              p.fetch_state AS fetch_state, p.headings_json AS headings_json, p.topics_json AS topics_json
       FROM parsed_competitor_pages p
       LEFT JOIN competitors c ON c.id = p.competitor_id
       WHERE p.run_id = ?
       ORDER BY p.cluster_id ASC, p.url ASC`,
    )
    .bind(runId)
    .all<ParsedPageRow>();
  return results ?? [];
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function buildCompetitorPageFact(row: ParsedPageRow, locale: string): CompetitorPageFact {
  const headings = parseJson<Array<{ level: number; text: string }>>(row.headings_json) ?? [];
  const topics = parseJson<string[]>(row.topics_json) ?? [];
  const titleHeading = headings.find((h) => h.level === 1) ?? headings[0];
  const titleTokens = titleHeading ? toTokens(titleHeading.text, locale) : [];
  const headingTokenSet = new Set<string>();
  for (const h of headings) for (const t of toTokens(h.text, locale)) headingTokenSet.add(t);
  for (const topic of topics) for (const t of toTokens(topic, locale)) headingTokenSet.add(t);
  return {
    competitorDomain: row.competitor_domain ?? 'unknown',
    hasParsedData: row.fetch_state === 'parsed',
    titleTokens,
    headingTokens: [...headingTokenSet].sort(),
  };
}

// Assembles the full PagePlanFacts for a run: the brief projection plus one
// PagePlanCluster per keyword_clusters row, each carrying its addressable volume
// (null when no member had a volume), SERP URL set (null when uncollected),
// service/area links, localized-evidence flag, and parsed competitor pages.
export async function loadPagePlanFacts(
  d1: D1Database,
  runId: string,
  brief: NormalizedProjectBrief,
): Promise<PagePlanFacts> {
  const locale = `${brief.languageCode}-${brief.countryIso}`;

  const [clusterRows, volumes, queries, organicByQuery, localPackClusters, competitorRows] = await Promise.all([
    loadClusterRows(d1, runId),
    loadClusterVolumes(d1, runId),
    loadClusterQueries(d1, runId),
    loadOrganicByQuery(d1, runId),
    loadLocalPackClusters(d1, runId),
    loadCompetitorPageRows(d1, runId),
  ]);

  const competitorByCluster = new Map<string, CompetitorPageFact[]>();
  for (const row of competitorRows) {
    const list = competitorByCluster.get(row.cluster_id) ?? [];
    list.push(buildCompetitorPageFact(row, locale));
    competitorByCluster.set(row.cluster_id, list);
  }

  const clusters: PagePlanCluster[] = clusterRows.map((row) => {
    const volumeRow = volumes.get(row.id);
    const addressableVolume = volumeRow && volumeRow.volume_count > 0 ? volumeRow.volume_sum : null;
    const primaryKeyword = row.primary_normalized ?? '';
    const coreSource = row.primary_core ?? primaryKeyword;
    const query = queries.get(row.id);
    const serpUrls = query !== undefined && organicByQuery.has(query) ? organicByQuery.get(query)! : null;
    const serp: ClusterSerpFacts = { urls: serpUrls };
    const serviceAreaId = row.service_area_id;

    return {
      clusterId: row.id,
      label: row.label,
      primaryKeywordId: row.primary_keyword_id ?? '',
      primaryKeyword,
      coreTokens: toTokens(coreSource, locale),
      intent: asIntent(row.intent),
      addressableVolume,
      confidence: asConfidence(row.confidence_label),
      serviceId: row.service_id,
      serviceAreaId,
      hasLocalizedEvidence: serviceAreaId !== null && localPackClusters.has(row.id),
      serp,
      competitorPages: competitorByCluster.get(row.id) ?? [],
    };
  });

  return { brief: briefFactsFrom(brief), clusters, overlay: null };
}
