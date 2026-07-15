import type { StageContext, StageHandler } from './handlers';
import type { SearchIntent } from '../contracts/enums';
import { PAGE_PLAN_RULESET_V1 } from '../domain/page-plan/ruleset';
import { rulesetVersionForStage } from '../domain/ruleset';
import { detectBotChallenge } from '../domain/bot-challenge';
import { fetchParsedPage } from '../providers/dataforseo/content-parsing';
import type { ParsedPageExtract } from '../providers/dataforseo/content-parsing';
import { loadDfsCostEstimates } from '../providers/dataforseo/costs';
import { chunk, runBatchedStatements, assertRowBudget } from '../db/batch';
import { newId, nowIso } from '../db/util';
import { loadStageOutput } from './stage-io';
import type { CollectCompetitorEvidenceOutput } from './research-handlers';

// Home for Phase 4's page-planning-track stage handlers (parse_competitor_pages
// onward), the same way orchestration/clustering-handlers.ts is the home for
// the clustering track and research-handlers.ts for Phase 3's evidence
// collection. Build_page_plan / overlay_existing_site / validate_blueprint land
// here in later tasks; keeping them out of orchestration/handlers.ts leaves that
// module limited to registration plus the lighter Phase 2 stages it owns.

const PARSE = PAGE_PLAN_RULESET_V1.parse;

// ===== Cluster ranking =====
//
// Intent priority for choosing WHICH clusters to spend competitor-page fetches
// on. Transactional and commercial clusters are the money pages whose competitor
// content matters most to the page-plan engine, so they rank first; the
// remaining intents follow in a fixed, documented order so the ranking is a
// total order. (The brief phrases the top tier as "transactional/commercial
// above local/navigational/informational"; there is no `local` value in the
// SearchIntent enum, so the lower tier is navigational/informational/unknown,
// listed here in that order.) Lower number = ranked earlier.
const INTENT_PRIORITY: Record<SearchIntent, number> = {
  transactional: 0,
  commercial: 1,
  navigational: 2,
  informational: 3,
  unknown: 4,
};
const UNKNOWN_INTENT_RANK = 5;

function intentRank(intent: SearchIntent | null): number {
  if (intent === null) return UNKNOWN_INTENT_RANK;
  return INTENT_PRIORITY[intent] ?? UNKNOWN_INTENT_RANK;
}

export interface RankableCluster {
  id: string;
  intent: SearchIntent | null;
  confidenceScore: number | null;
  totalVolume: number;
}

// Total, deterministic order: intent priority ASC, then confidence DESC, then
// total member volume DESC, then cluster id ASC as the final tiebreak (ids are
// globally unique, so two clusters never compare equal). Pure so it is unit
// tested directly without a database.
export function compareClustersForParsing(a: RankableCluster, b: RankableCluster): number {
  const ia = intentRank(a.intent);
  const ib = intentRank(b.intent);
  if (ia !== ib) return ia - ib;
  const ca = a.confidenceScore ?? 0;
  const cb = b.confidenceScore ?? 0;
  if (cb !== ca) return cb - ca;
  if (b.totalVolume !== a.totalVolume) return b.totalVolume - a.totalVolume;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ===== URL/domain matching =====

// Subdomain-aware registrable-domain match, same shape as competitors.ts's
// isExcludedCompetitorDomain: an organic result on www.rival.com or
// m.rival.com counts as competitor rival.com.
function domainMatches(host: string, competitorDomain: string): boolean {
  return host === competitorDomain || host.endsWith(`.${competitorDomain}`);
}

// Hostname of an organic URL, lowercased and www-stripped for matching. Returns
// null on an unparseable URL (that result is simply not competitor-matchable).
function hostFromUrl(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

// ===== Row shapes =====

interface RankedClusterRow {
  id: string;
  intent: string | null;
  confidence_score: number | null;
  representative_query: string | null;
  total_volume: number | null;
}

interface OrganicItem {
  rank: number | null;
  url: string | null;
  domain: string | null;
}

// One selected (cluster, url) pair. competitorId is the selected competitor the
// URL was attributed to (from the SERP domain match or the topPages source), or
// null when it could not be attributed. Multiple clusters may select the same
// url: each becomes its own row, but the url is fetched only once (see the
// handler's per-url extract cache).
interface SelectedPage {
  clusterId: string;
  url: string;
  competitorId: string | null;
}

type FetchState = 'parsed' | 'empty' | 'blocked' | 'failed';

interface PageOutcome {
  extract: ParsedPageExtract;
  fetchState: FetchState;
  jsRendered: boolean;
}

// parsed_competitor_pages has 15 columns this insert writes (evidence_ref_id is
// always NULL today, see the handler note); at 15 params/row D1's 100-bound-
// parameter ceiling allows at most 6 rows per statement.
const PAGE_PARAMS_PER_ROW = 15;
const PAGE_ROWS_PER_STATEMENT = 6;
assertRowBudget(PAGE_ROWS_PER_STATEMENT, PAGE_PARAMS_PER_ROW, 'parsed_competitor_pages insert');

function parseJson<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ===== Loaders =====

// Ranked clusters for this run: intent + confidence off the cluster row, the
// representative query (its primary keyword's normalized_keyword), and the sum
// of member keyword search volumes. Loaded ordered by id (a stable base order);
// the intent/confidence/volume ranking is applied in TS via
// compareClustersForParsing so it stays pure and unit-testable.
async function loadRankedClusters(d1: D1Database, runId: string): Promise<RankedClusterRow[]> {
  const rows = await d1
    .prepare(
      `SELECT kc.id AS id,
              kc.intent AS intent,
              kc.confidence_score AS confidence_score,
              pk.normalized_keyword AS representative_query,
              COALESCE(SUM(k.search_volume), 0) AS total_volume
       FROM keyword_clusters kc
       LEFT JOIN keywords pk ON pk.id = kc.primary_keyword_id
       LEFT JOIN cluster_keywords ck ON ck.cluster_id = kc.id
       LEFT JOIN keywords k ON k.id = ck.keyword_id
       WHERE kc.run_id = ?
       GROUP BY kc.id
       ORDER BY kc.id ASC`
    )
    .bind(runId)
    .all<RankedClusterRow>();
  return rows.results ?? [];
}

// Selected competitors as a domain -> id map plus the domain list. domain is
// stored already normalized (domain/url.ts normalizeDomain). Ordered by domain
// so the topPages fallback iterates competitors deterministically regardless of
// insertion order.
async function loadSelectedCompetitors(
  d1: D1Database,
  runId: string
): Promise<{ domains: string[]; idByDomain: Map<string, string> }> {
  const rows = await d1
    .prepare(`SELECT id, domain FROM competitors WHERE run_id = ? AND selected = 1 ORDER BY domain ASC`)
    .bind(runId)
    .all<{ id: string; domain: string }>();
  const idByDomain = new Map<string, string>();
  const domains: string[] = [];
  for (const row of rows.results ?? []) {
    idByDomain.set(row.domain, row.id);
    domains.push(row.domain);
  }
  return { domains, idByDomain };
}

// Organic results keyed by the snapshot keyword's normalized_keyword (the same
// key a cluster's representative query is), merged across every snapshot for
// that query (different SERP locations) and sorted by organic rank ASC (nulls
// last) then url ASC, deduped by url. Same normalized-keyword join convention
// refine_clusters' loadLiveSerpEvidence uses.
async function loadSnapshotOrganicByQuery(d1: D1Database, runId: string): Promise<Map<string, OrganicItem[]>> {
  const rows = await d1
    .prepare(
      `SELECT k.normalized_keyword AS nk, s.organic_json AS organic_json
       FROM serp_snapshots s JOIN keywords k ON k.id = s.keyword_id
       WHERE s.run_id = ? ORDER BY s.id ASC`
    )
    .bind(runId)
    .all<{ nk: string; organic_json: string | null }>();

  const byQuery = new Map<string, Map<string, OrganicItem>>();
  for (const row of rows.results ?? []) {
    const organic = parseJson<OrganicItem[]>(row.organic_json) ?? [];
    let bucket = byQuery.get(row.nk);
    if (!bucket) {
      bucket = new Map<string, OrganicItem>();
      byQuery.set(row.nk, bucket);
    }
    for (const item of organic) {
      if (typeof item?.url !== 'string' || item.url.length === 0) continue;
      // First appearance of a url wins its rank; snapshots are visited in a
      // stable id order so this is deterministic.
      if (!bucket.has(item.url)) {
        bucket.set(item.url, { rank: item.rank ?? null, url: item.url, domain: item.domain ?? null });
      }
    }
  }

  const out = new Map<string, OrganicItem[]>();
  for (const [nk, bucket] of byQuery) {
    const items = [...bucket.values()].sort((a, b) => {
      const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return (a.url ?? '') < (b.url ?? '') ? -1 : (a.url ?? '') > (b.url ?? '') ? 1 : 0;
    });
    out.set(nk, items);
  }
  return out;
}

// ===== URL selection =====

// Picks up to PARSE.pagesPerCluster competitor URLs for one cluster. Primary
// source: this run's SERP organic results for the cluster's representative
// query whose registrable domain is one of the selected competitors, in rank
// order. Fallback (only when the primary source yields nothing): the
// collect_competitor_evidence stage's topPages, iterating selected competitors
// in domain order and each competitor's pages in their persisted (DFS relevance)
// order. Deduped within the cluster by url.
function selectClusterUrls(
  cluster: RankedClusterRow,
  organicByQuery: Map<string, OrganicItem[]>,
  competitors: { domains: string[]; idByDomain: Map<string, string> },
  topPagesByDomain: Map<string, string[]>
): SelectedPage[] {
  const picked: SelectedPage[] = [];
  const seen = new Set<string>();

  const query = cluster.representative_query;
  const organic = query ? organicByQuery.get(query) ?? [] : [];
  for (const item of organic) {
    if (picked.length >= PARSE.pagesPerCluster) break;
    if (!item.url || seen.has(item.url)) continue;
    const host = item.domain ? item.domain.toLowerCase() : hostFromUrl(item.url);
    if (host === null) continue;
    const matched = competitors.domains.find((d) => domainMatches(host, d));
    if (!matched) continue;
    seen.add(item.url);
    picked.push({ clusterId: cluster.id, url: item.url, competitorId: competitors.idByDomain.get(matched) ?? null });
  }

  if (picked.length > 0) return picked;

  // Fallback: competitor top pages, competitor-major in domain order.
  for (const domain of competitors.domains) {
    const pages = topPagesByDomain.get(domain) ?? [];
    for (const url of pages) {
      if (picked.length >= PARSE.pagesPerCluster) break;
      if (seen.has(url)) continue;
      seen.add(url);
      picked.push({ clusterId: cluster.id, url, competitorId: competitors.idByDomain.get(domain) ?? null });
    }
    if (picked.length >= PARSE.pagesPerCluster) break;
  }
  return picked;
}

// ===== Fetch + classify =====

function toSignal(extract: ParsedPageExtract): {
  statusCode: number | null;
  textSample: string;
  headingCount: number;
  contentChars: number;
} {
  return {
    statusCode: extract.statusCode,
    textSample: [...extract.headings.map((h) => h.text), ...extract.textBlocks].join(' '),
    headingCount: extract.headings.length,
    contentChars: extract.contentChars,
  };
}

// Whether the first (no-JS) attempt warrants the single JS retry: an empty
// result (below the content-chars threshold), a bot challenge, or a fetch that
// failed with a 4xx/5xx crawl status. A healthy parse (contentChars at or above
// the threshold) never retries.
function needsJsRetry(extract: ParsedPageExtract): boolean {
  if (extract.contentChars < PARSE.minContentChars) return true;
  if (detectBotChallenge(toSignal(extract))) return true;
  return extract.fetchFailed && extract.crawlStatusCode !== null && extract.crawlStatusCode >= 400;
}

// Final classification, precedence: parsed (enough content) > blocked (bot
// challenge) > failed (page did not load) > empty (loaded but thin). Blocked
// outranks failed so an anomalous-success challenge stub is reported as blocked,
// not failed; a real 4xx/5xx (detectBotChallenge false) stays failed.
function classify(extract: ParsedPageExtract): FetchState {
  if (extract.contentChars >= PARSE.minContentChars) return 'parsed';
  if (detectBotChallenge(toSignal(extract))) return 'blocked';
  if (extract.fetchFailed) return 'failed';
  return 'empty';
}

// ===== Persistence =====

// Rerun-safe reset-then-apply, mirroring clustering-handlers.ts's
// persistClusters: every attempt fully REPLACES this run's
// parsed_competitor_pages rows so a retry never accumulates duplicates. The
// rows double as the stage's progress markers; a full reset per attempt is the
// Phase 4 choice (the adapter's 7d KV response cache makes any refetched URL
// free, so a full reset costs nothing in provider calls on retry).
async function persistParsedPages(
  d1: D1Database,
  runId: string,
  rows: Array<{
    clusterId: string;
    competitorId: string | null;
    url: string;
    fetchState: FetchState;
    jsRendered: boolean;
    extract: ParsedPageExtract;
  }>,
  fetchedAt: string
): Promise<void> {
  await d1.prepare(`DELETE FROM parsed_competitor_pages WHERE run_id = ?`).bind(runId).run();
  if (rows.length === 0) return;

  const statements: D1PreparedStatement[] = [];
  for (const rowsChunk of chunk(rows, PAGE_ROWS_PER_STATEMENT)) {
    const placeholders = rowsChunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const args: unknown[] = [];
    for (const r of rowsChunk) {
      args.push(
        newId('pcp'),
        runId,
        r.clusterId,
        r.competitorId,
        r.url,
        r.fetchState,
        r.jsRendered ? 1 : 0,
        r.extract.statusCode,
        JSON.stringify(r.extract.headings),
        JSON.stringify(r.extract.topics),
        JSON.stringify(r.extract.textBlocks),
        JSON.stringify(r.extract.links),
        r.extract.structure ? JSON.stringify(r.extract.structure) : null,
        // evidence_ref_id: the content-parsing adapter (fetchParsedPage) does
        // not surface the per-call evidenceRefId blueprintDfsCall created, so
        // this is left NULL rather than guessed. Wiring it through is a clean
        // follow-up (return the ref id from the adapter).
        null,
        fetchedAt
      );
    }
    statements.push(
      d1
        .prepare(
          `INSERT INTO parsed_competitor_pages
            (id, run_id, cluster_id, competitor_id, url, fetch_state, js_rendered, status_code,
             headings_json, topics_json, text_blocks_json, links_json, structure_json,
             evidence_ref_id, fetched_at)
           VALUES ${placeholders}`
        )
        .bind(...args)
    );
  }
  await runBatchedStatements(d1, statements);
}

export interface ParseCompetitorPagesOutput {
  stage: 'parse_competitor_pages';
  // Present (and true) only on the zero-cluster short-circuit.
  skipped?: boolean;
  reason?: string;
  clustersSelected: number;
  urlsSelected: number;
  parsed: number;
  empty: number;
  blocked: number;
  failed: number;
  jsRetries: number;
  uniqueFetches: number;
  warnings: string[];
  rulesetVersion: string;
}

// Real parse_competitor_pages (Phase 4 Task 14). OPTIONAL stage (stages.ts): a
// throw degrades the run to partial rather than failing it. Fetches bounded
// content extracts of the top competitor pages for the top clusters, as
// evidence for build_page_plan (stage 15) and future brief synthesis. All page
// content is treated strictly as untrusted data, never as instructions.
//
// Subrequest ceiling: worst case is PARSE.maxClusters (10) x PARSE.pagesPerCluster
// (2) = 20 unique URLs, each with at most one JS retry = 40 DFS calls in a single
// queue-consumer invocation, which the Phase 4 plan accepts. The fetch loop is
// deliberately sequential (no Promise.all fan-out) so those calls never spike
// concurrent subrequests.
export const parseCompetitorPagesHandler: StageHandler = async (ctx: StageContext) => {
  const rulesetVersion = rulesetVersionForStage('parse_competitor_pages');

  const clusterRows = await loadRankedClusters(ctx.d1, ctx.runId);

  // Zero clusters (build_provisional_clusters short-circuited on an empty/
  // all-excluded universe): nothing to parse. Reset any stale rows and report a
  // truthful skip.
  if (clusterRows.length === 0) {
    await persistParsedPages(ctx.d1, ctx.runId, [], nowIso());
    const output: ParseCompetitorPagesOutput = {
      stage: 'parse_competitor_pages',
      skipped: true,
      reason: 'no_clusters',
      clustersSelected: 0,
      urlsSelected: 0,
      parsed: 0,
      empty: 0,
      blocked: 0,
      failed: 0,
      jsRetries: 0,
      uniqueFetches: 0,
      warnings: [],
      rulesetVersion,
    };
    return { output, status: 'succeeded' as const };
  }

  const ranked = clusterRows
    .map((r) => ({
      row: r,
      rank: {
        id: r.id,
        intent: (r.intent as SearchIntent | null) ?? null,
        confidenceScore: r.confidence_score,
        totalVolume: r.total_volume ?? 0,
      } satisfies RankableCluster,
    }))
    .sort((a, b) => compareClustersForParsing(a.rank, b.rank))
    .slice(0, PARSE.maxClusters)
    .map((x) => x.row);

  const competitors = await loadSelectedCompetitors(ctx.d1, ctx.runId);
  const organicByQuery = await loadSnapshotOrganicByQuery(ctx.d1, ctx.runId);

  // topPages fallback source (only read if any cluster needs it): domain -> urls
  // from the collect_competitor_evidence stage output.
  const evidence = await loadStageOutput<CollectCompetitorEvidenceOutput>(
    ctx.d1,
    ctx.runId,
    'collect_competitor_evidence'
  );
  const topPagesByDomain = new Map<string, string[]>();
  for (const entry of evidence?.perCompetitor ?? []) {
    topPagesByDomain.set(
      entry.domain,
      entry.topPages.map((p) => p.url).filter((u): u is string => typeof u === 'string' && u.length > 0)
    );
  }

  const selected: SelectedPage[] = [];
  for (const cluster of ranked) {
    selected.push(...selectClusterUrls(cluster, organicByQuery, competitors, topPagesByDomain));
  }

  const warnings: string[] = [];

  // Zero candidate URLs across every selected cluster: nothing was fetchable by
  // design (no competitor SERP hits, no topPages). Succeeded with a warning, not
  // partial.
  if (selected.length === 0) {
    await persistParsedPages(ctx.d1, ctx.runId, [], nowIso());
    warnings.push('no_competitor_urls');
    const output: ParseCompetitorPagesOutput = {
      stage: 'parse_competitor_pages',
      clustersSelected: ranked.length,
      urlsSelected: 0,
      parsed: 0,
      empty: 0,
      blocked: 0,
      failed: 0,
      jsRetries: 0,
      uniqueFetches: 0,
      warnings,
      rulesetVersion,
    };
    return { output, status: 'succeeded' as const };
  }

  const costs = await loadDfsCostEstimates(ctx.env.KV);

  // Fetch each UNIQUE url once (a url two clusters both picked is fetched once
  // and its extract reused for both rows). Sorted for a stable per-attempt scope
  // id so budget reservations line up on retry. Sequential by design.
  const uniqueUrls = [...new Set(selected.map((s) => s.url))].sort();
  const outcomes = new Map<string, PageOutcome>();
  let jsRetries = 0;
  for (let i = 0; i < uniqueUrls.length; i++) {
    const url = uniqueUrls[i];
    // A page-level fetchFailed returns an extract (never throws) and does not
    // sink the stage; a task-level provider throw (quota/malformed) propagates.
    let extract = await fetchParsedPage(ctx, url, false, `p${i}`, costs);
    let jsRendered = false;
    if (needsJsRetry(extract)) {
      extract = await fetchParsedPage(ctx, url, true, `p${i}j`, costs);
      jsRendered = true;
      jsRetries++;
    }
    outcomes.set(url, { extract, fetchState: classify(extract), jsRendered });
  }

  const rows = selected.map((s) => {
    const outcome = outcomes.get(s.url)!;
    return {
      clusterId: s.clusterId,
      competitorId: s.competitorId,
      url: s.url,
      fetchState: outcome.fetchState,
      jsRendered: outcome.jsRendered,
      extract: outcome.extract,
    };
  });

  await persistParsedPages(ctx.d1, ctx.runId, rows, nowIso());

  // Counts are per UNIQUE fetch (one classification per url); they sum to
  // uniqueFetches. urlsSelected counts the (cluster, url) rows persisted.
  let parsed = 0;
  let empty = 0;
  let blocked = 0;
  let failed = 0;
  for (const outcome of outcomes.values()) {
    if (outcome.fetchState === 'parsed') parsed++;
    else if (outcome.fetchState === 'empty') empty++;
    else if (outcome.fetchState === 'blocked') blocked++;
    else failed++;
  }

  // Every selected url failed or was blocked (none parsed, none merely thin):
  // the stage did its job but produced no usable evidence, so it degrades to
  // partial with a warning. Any parsed OR empty result keeps it succeeded.
  const allFailedOrBlocked = parsed === 0 && empty === 0;
  if (allFailedOrBlocked) warnings.push('all_fetches_failed_or_blocked');

  const output: ParseCompetitorPagesOutput = {
    stage: 'parse_competitor_pages',
    clustersSelected: ranked.length,
    urlsSelected: selected.length,
    parsed,
    empty,
    blocked,
    failed,
    jsRetries,
    uniqueFetches: uniqueUrls.length,
    warnings,
    rulesetVersion,
  };

  return { output, status: allFailedOrBlocked ? ('partial' as const) : ('succeeded' as const) };
};
