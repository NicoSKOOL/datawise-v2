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
import { buildPagePlan } from '../domain/page-plan/engine';
import type { PagePlanResult, PagePlanStats } from '../domain/page-plan/engine';
import { loadPagePlanFacts } from './page-plan-facts';
import { loadGapStageNames } from './run-status';
import { BlueprintApiError, isAccountWideProviderError } from '../domain/api-errors';
import { BlueprintValidationError } from '../domain/errors';
import { safeErrorMessage } from '../providers/dataforseo/envelope';
import type { PlannedPage, PagePlanCluster, PagePlanBriefFacts } from '../domain/page-plan/types';
import type { BlueprintWarning, KeywordClusterSummary, NormalizedProjectBrief } from '../contracts/types';
import type { ResolvedMarket } from '../providers/dataforseo/catalogs';
import { fetchTextResource, fetchPageTitle, SiteFetchError } from '../providers/site-fetch/fetcher';
import { parseRobotsTxt, parseSitemapXml, selectTitleFetchCandidates } from '../domain/overlay/sitemap';
import { assignMatches } from '../domain/overlay/match';
import type { ExistingPageInput } from '../domain/overlay/match';
import { fetchOwnRankedUrls } from '../providers/dataforseo/site-pages';
import { composeBlueprint } from '../domain/validate/compose';
import type { OverlayResult } from '../domain/validate/compose';
import { validateComposed } from '../domain/validate/rules';
import type { ValidationIssue, ServiceLocationCheck } from '../domain/validate/rules';

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

// =====================================================================
// Stage 15: build_page_plan (Task 16) -- REQUIRED
// =====================================================================

// keyword_clusters.page_candidate + decision_reason write-back: 3 bound params
// per UPDATE, one statement per cluster (plain UPDATE by id, rerun-safe). Well
// under D1's 100-param ceiling; the row-budget guard documents the intent.
const PAGE_CANDIDATE_PARAMS_PER_ROW = 3;
assertRowBudget(1, PAGE_CANDIDATE_PARAMS_PER_ROW, 'keyword_clusters page_candidate write-back');

// decision_reason is a compact, operator-facing string persisted per cluster;
// cap it so one pathologically long reason chain cannot bloat the row.
const MAX_DECISION_REASON_CHARS = 500;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Writes the full page-plan JSON to R2 and mints (or reuses) its artifacts row,
// mirroring providers/embeddings/workers-ai.ts's artifact-row parity: the
// storage key is deterministic per run, so a rerun overwrites the same object
// and finds the existing artifacts row instead of writing a duplicate.
async function persistPagePlanArtifact(
  ctx: StageContext,
  organizationId: string,
  rawJson: string,
): Promise<{ artifactId: string; storageKey: string; byteSize: number }> {
  const storageKey = `runs/${ctx.runId}/page-plan.json`;
  await ctx.env.BLUEPRINT_ARTIFACTS.put(storageKey, rawJson);

  const byteSize = new TextEncoder().encode(rawJson).byteLength;
  const existing = await ctx.d1
    .prepare(`SELECT id FROM artifacts WHERE run_id = ? AND storage_key = ? ORDER BY created_at ASC LIMIT 1`)
    .bind(ctx.runId, storageKey)
    .first<{ id: string }>();
  if (existing) return { artifactId: existing.id, storageKey, byteSize };

  const artifactId = newId('art');
  const sha256 = await sha256Hex(rawJson);
  await ctx.d1
    .prepare(
      `INSERT INTO artifacts
        (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
       VALUES (?, ?, ?, 'page_plan', ?, ?, 'application/json', ?, 0, ?)`,
    )
    .bind(artifactId, organizationId, ctx.runId, storageKey, sha256, byteSize, nowIso())
    .run();
  return { artifactId, storageKey, byteSize };
}

// Single-writer write-back of each cluster's placement onto keyword_clusters:
// page_candidate = the placement target logical id (the dedicated page's own id
// or the parent it folded into), decision_reason = the concise reason chain.
// Plain UPDATEs by cluster id, batched, so a rerun is idempotent.
async function persistPageCandidates(
  d1: D1Database,
  placements: PagePlanResult['placements'],
): Promise<void> {
  if (placements.length === 0) return;
  const statements: D1PreparedStatement[] = [];
  for (const p of placements) {
    const reason = p.reasons.join(' ').slice(0, MAX_DECISION_REASON_CHARS);
    statements.push(
      d1
        .prepare(`UPDATE keyword_clusters SET page_candidate = ?, decision_reason = ? WHERE id = ?`)
        .bind(p.targetLogicalId, reason, p.clusterId),
    );
  }
  await runBatchedStatements(d1, statements);
}

export interface BuildPagePlanOutput {
  stage: 'build_page_plan';
  artifactId: string;
  storageKey: string;
  planByteSize: number;
  pageCount: number;
  skeletonPageCount: number;
  dedicatedPageCount: number;
  sectionCount: number;
  faqCount: number;
  clustersPlaced: number;
  demotedPageCount: number;
  cannibalizedCount: number;
  serviceLocationBlockedCount: number;
  totalAddressableVolume: number | null;
  pageBudget: number;
  pages: Array<{ logicalId: string; pageType: string; slug: string; parentLogicalId: string | null }>;
  warnings: string[];
  rulesetVersion: string;
}

// Real build_page_plan (Phase 4 Task 16). REQUIRED stage (stages.ts): a throw
// fails the whole run. No paid provider calls here (pure deterministic planning
// over already-collected evidence), so budget machinery is untouched.
//
// Even a run with zero clusters produces a valid minimal plan (the brief-derived
// skeleton), never a skip: this stage is REQUIRED and always emits a plan. The
// full plan (up to the user's page budget of pages, too large for a stage output
// row) goes to R2 + an artifacts row for stages 18/19; the stage output carries
// a compact summary.
export const buildPagePlanHandler: StageHandler = async (ctx: StageContext) => {
  const rulesetVersion = rulesetVersionForStage('build_page_plan');

  const project = await ctx.d1
    .prepare(`SELECT organization_id FROM projects WHERE id = ?`)
    .bind(ctx.projectId)
    .first<{ organization_id: string }>();
  if (!project) {
    throw new BlueprintApiError('internal_error', safeErrorMessage('internal_error'));
  }

  const facts = await loadPagePlanFacts(ctx.d1, ctx.runId, ctx.normalizedBrief);
  const plan = buildPagePlan(facts, PAGE_PLAN_RULESET_V1, {
    // Page-budget source: the normalized brief's maxRecommendedPages (a per-run
    // USER choice), never a ruleset constant. It always has a value (brief
    // normalization defaults it to V1_LIMITS.defaultMaxRecommendedPages and caps
    // it at maxRecommendedPages), so no separate loader default is needed.
    pageBudget: ctx.normalizedBrief.maxRecommendedPages,
  });

  const rawJson = JSON.stringify({ rulesetVersion, ...plan });
  const { artifactId, storageKey, byteSize } = await persistPagePlanArtifact(ctx, project.organization_id, rawJson);

  await persistPageCandidates(ctx.d1, plan.placements);

  const warnings: string[] = plan.warnings.map((w) => w.code);
  if (facts.clusters.length === 0) warnings.push('no_clusters_planned');

  const output: BuildPagePlanOutput = {
    stage: 'build_page_plan',
    artifactId,
    storageKey,
    planByteSize: byteSize,
    pageCount: plan.stats.pageCount,
    skeletonPageCount: plan.stats.skeletonPageCount,
    dedicatedPageCount: plan.stats.dedicatedPageCount,
    sectionCount: plan.stats.sectionCount,
    faqCount: plan.stats.faqCount,
    clustersPlaced: plan.stats.clustersPlaced,
    demotedPageCount: plan.stats.demotedPageCount,
    cannibalizedCount: plan.stats.cannibalizedCount,
    serviceLocationBlockedCount: plan.stats.serviceLocationBlockedCount,
    totalAddressableVolume: plan.stats.totalAddressableVolume,
    pageBudget: plan.stats.pageBudget,
    pages: plan.pages.map((p) => ({
      logicalId: p.logicalId,
      pageType: p.pageType,
      slug: p.slug,
      parentLogicalId: p.parentLogicalId,
    })),
    warnings,
    rulesetVersion,
  };

  return { output, status: 'succeeded' as const };
};

// =====================================================================
// Stage 16: overlay_existing_site (Task 18) -- OPTIONAL
// =====================================================================
//
// Inventories the business's EXISTING website and matches it against the pages
// stage 15 planned, so the published blueprint can say Keep / Update / Create /
// Consolidate instead of pretending every page is new. OPTIONAL (stages.ts): a
// throw only degrades the run to partial, never fails it. All fetched site
// content (robots.txt, sitemaps, page titles) is untrusted DATA, never
// instructions, and is bounded by the fetcher/parsers before it reaches here.
//
// Two inventory sources, in preference order:
//   1. FREE sitemap crawl (robots.txt -> sitemaps -> page URLs), via the Task 17
//      SSRF-safe fetcher and pure parsers.
//   2. PAID labs fallback (one ranked_keywords call against the own domain), used
//      ONLY when the sitemap crawl found zero URLs. The plan's 1-call budget line
//      for site_ranked_urls is a ceiling: a successful sitemap crawl never spends
//      it (see step 4 below).
//
// Subrequest ceiling (all sequential, no fan-out, no retries): at most
// MAX_SITEMAP_FETCHES (10, including robots.txt) sitemap-family fetches + overlay
// .maxPageFetches (20) title fetches + 1 labs DFS call. Each site fetch carries
// the fetcher's default 10s deadline, so a pathological redirect/child-sitemap
// chain is bounded by the fetch COUNT above, not just per-call timeouts.
//
// Artifact contract for Tasks 19 (validate) and 20 (publish): this stage writes a
// SECOND artifact, runs/{runId}/overlay.json, and NEVER mutates stage 15's
// runs/{runId}/page-plan.json (single-writer determinism). Validate and publish
// compose the two: page-plan.json is the plan, overlay.json is the per-planned-
// page recommendation (keep/update/create + matched URL) plus the consolidation
// proposals for leftover existing URLs.

const OVERLAY = PAGE_PLAN_RULESET_V1.overlay;

// Hard cap on sitemap-family fetches per run, robots.txt inclusive. A
// sitemapindex can legally chain into thousands of child sitemaps; this bounds
// how many we will actually pull. Page URLs have their own ceiling
// (OVERLAY.maxSitemapUrls); this bounds the recursion frontier's network cost.
const MAX_SITEMAP_FETCHES = 10;

// existing_pages writes 9 columns; at 9 params/row D1's 100-bound-parameter
// ceiling allows 11 rows per statement (11 * 9 = 99).
const EXISTING_PAGE_PARAMS_PER_ROW = 9;
const EXISTING_PAGE_ROWS_PER_STATEMENT = 11;
assertRowBudget(EXISTING_PAGE_ROWS_PER_STATEMENT, EXISTING_PAGE_PARAMS_PER_ROW, 'existing_pages insert');

// discovered_via provenance (schema CHECK: 'sitemap' | 'robots' | 'labs').
// 'robots' = the page came from a sitemap that robots.txt pointed us at.
// 'sitemap' = robots.txt listed no sitemap, so the page came from the
// well-known /sitemap.xml fallback. 'labs' = the paid ranked_keywords fallback.
type DiscoveredVia = 'sitemap' | 'robots' | 'labs';

// Subdomain-aware registrable-domain match (reuses domainMatches/hostFromUrl
// above): an off-domain URL sitting in a sitemap (a syndication partner, a CDN
// host) is dropped so the inventory only ever contains the project's own pages.
function urlOnDomain(rawUrl: string, domain: string): boolean {
  const host = hostFromUrl(rawUrl);
  if (host === null) return false;
  return domainMatches(host, domain);
}

// Map a SiteFetchError to a compact, machine-readable warning code; a non-fetch
// error degrades to a generic code rather than leaking a raw message.
function siteFetchWarning(kind: string, err: unknown): string {
  if (err instanceof SiteFetchError) return `${kind}_fetch_${err.reason}`;
  return `${kind}_fetch_error`;
}

interface SitemapOrigin {
  url: string;
  origin: 'sitemap' | 'robots';
}

// FREE sitemap-based inventory: robots.txt -> its Sitemap: directives (or the
// /sitemap.xml fallback) -> page URLs, recursing bounded into sitemapindex
// children. Returns discovered page URLs (deduped, first-origin wins) tagged with
// their provenance. Every fetch failure becomes a warning, never a throw: a
// bot-challenged or missing sitemap must not fail this optional stage.
async function crawlSitemapInventory(
  site: string,
  domain: string,
  maxUrls: number,
  warnings: string[]
): Promise<Map<string, 'sitemap' | 'robots'>> {
  const collected = new Map<string, 'sitemap' | 'robots'>();
  const seenSitemaps = new Set<string>();
  const frontier: SitemapOrigin[] = [];
  let fetches = 0;

  // 1: robots.txt (counts as the first sitemap-family fetch).
  const robotsUrl = new URL('/robots.txt', site).href;
  fetches++;
  try {
    const res = await fetchTextResource(robotsUrl);
    if (res.status < 400) {
      for (const sm of parseRobotsTxt(res.body)) {
        if (!seenSitemaps.has(sm)) {
          seenSitemaps.add(sm);
          frontier.push({ url: sm, origin: 'robots' });
        }
      }
    }
  } catch (err) {
    warnings.push(siteFetchWarning('robots', err));
  }

  // 2: /sitemap.xml fallback when robots.txt listed no sitemap.
  if (frontier.length === 0) {
    const fallback = new URL('/sitemap.xml', site).href;
    seenSitemaps.add(fallback);
    frontier.push({ url: fallback, origin: 'sitemap' });
  }

  // 3: bounded crawl of the sitemap frontier.
  while (frontier.length > 0 && fetches < MAX_SITEMAP_FETCHES && collected.size < maxUrls) {
    const { url: sitemapUrl, origin } = frontier.shift()!;
    fetches++;
    let res;
    try {
      res = await fetchTextResource(sitemapUrl);
    } catch (err) {
      warnings.push(siteFetchWarning('sitemap', err));
      continue;
    }
    if (res.status >= 400) {
      warnings.push(`sitemap_http_${res.status}`);
      continue;
    }
    const parsed = parseSitemapXml(res.body, maxUrls);
    for (const pageUrl of parsed.urls) {
      if (collected.size >= maxUrls) break;
      if (!urlOnDomain(pageUrl, domain)) continue; // drop off-domain entries
      if (!collected.has(pageUrl)) collected.set(pageUrl, origin);
    }
    for (const child of parsed.childSitemaps) {
      if (!seenSitemaps.has(child)) {
        seenSitemaps.add(child);
        frontier.push({ url: child, origin });
      }
    }
  }

  return collected;
}

interface TitleFetch {
  title: string | null;
  status: number | null;
}

// Load stage 15's page plan back from R2. build_page_plan is REQUIRED and runs
// before this stage, so the object must exist; a null here is a broken pipeline
// precondition, surfaced as an internal error (which, this stage being optional,
// degrades the run to partial rather than failing it).
async function loadPagePlanPages(ctx: StageContext): Promise<PlannedPage[]> {
  const storageKey = `runs/${ctx.runId}/page-plan.json`;
  const obj = await ctx.env.BLUEPRINT_ARTIFACTS.get(storageKey);
  if (!obj) {
    throw new BlueprintApiError('internal_error', safeErrorMessage('internal_error'));
  }
  const raw = await obj.text();
  const parsed = JSON.parse(raw) as { pages?: PlannedPage[] };
  return parsed.pages ?? [];
}

interface ExistingPageRow {
  url: string;
  title: string | null;
  discoveredVia: DiscoveredVia;
  httpStatus: number | null;
  matchedLogicalPageId: string | null;
  matchScore: number | null;
}

// Rerun-safe reset-then-apply of the run's existing_pages rows, mirroring
// persistParsedPages: every attempt fully REPLACES the run's rows so a retry
// never accumulates duplicates (and never trips UNIQUE(run_id, url)). Chunked
// multi-row INSERTs stay under D1's bound-parameter ceiling.
async function persistExistingPages(d1: D1Database, runId: string, rows: ExistingPageRow[]): Promise<void> {
  await d1.prepare(`DELETE FROM existing_pages WHERE run_id = ?`).bind(runId).run();
  if (rows.length === 0) return;

  const statements: D1PreparedStatement[] = [];
  for (const rowsChunk of chunk(rows, EXISTING_PAGE_ROWS_PER_STATEMENT)) {
    const placeholders = rowsChunk.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
    const args: unknown[] = [];
    for (const r of rowsChunk) {
      args.push(
        newId('exp'),
        runId,
        r.url,
        null, // canonical_url: not derived in V1 (we never fetch a rel=canonical)
        r.title,
        r.discoveredVia,
        r.httpStatus,
        r.matchedLogicalPageId,
        r.matchScore
      );
    }
    statements.push(
      d1
        .prepare(
          `INSERT INTO existing_pages
            (id, run_id, url, canonical_url, title, discovered_via, http_status, matched_logical_page_id, match_score)
           VALUES ${placeholders}`
        )
        .bind(...args)
    );
  }
  await runBatchedStatements(d1, statements);
}

// Writes overlay.json to R2 and mints (or reuses) its artifacts row, mirroring
// persistPagePlanArtifact's parity exactly: deterministic per-run key, so a
// rerun overwrites the same object and finds the existing row instead of
// duplicating it. Kind 'overlay' distinguishes it from the 'page_plan' artifact.
async function persistOverlayArtifact(
  ctx: StageContext,
  organizationId: string,
  rawJson: string
): Promise<{ artifactId: string; storageKey: string; byteSize: number }> {
  const storageKey = `runs/${ctx.runId}/overlay.json`;
  await ctx.env.BLUEPRINT_ARTIFACTS.put(storageKey, rawJson);

  const byteSize = new TextEncoder().encode(rawJson).byteLength;
  const existing = await ctx.d1
    .prepare(`SELECT id FROM artifacts WHERE run_id = ? AND storage_key = ? ORDER BY created_at ASC LIMIT 1`)
    .bind(ctx.runId, storageKey)
    .first<{ id: string }>();
  if (existing) return { artifactId: existing.id, storageKey, byteSize };

  const artifactId = newId('art');
  const sha256 = await sha256Hex(rawJson);
  await ctx.d1
    .prepare(
      `INSERT INTO artifacts
        (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
       VALUES (?, ?, ?, 'overlay', ?, ?, 'application/json', ?, 0, ?)`
    )
    .bind(artifactId, organizationId, ctx.runId, storageKey, sha256, byteSize, nowIso())
    .run();
  return { artifactId, storageKey, byteSize };
}

export interface OverlayExistingSiteOutput {
  stage: 'overlay_existing_site';
  // Present (and true) only on the greenfield short-circuit.
  skipped?: boolean;
  reason?: string;
  urlsDiscovered: { sitemap: number; robots: number; labs: number };
  titleFetches: { attempted: number; blocked: number; failed: number };
  matches: { keep: number; update: number; create: number; consolidate: number; unmatchedExisting: number };
  warnings: string[];
  rulesetVersion: string;
}

function emptyOverlayOutput(extra: Partial<OverlayExistingSiteOutput>): OverlayExistingSiteOutput {
  return {
    stage: 'overlay_existing_site',
    urlsDiscovered: { sitemap: 0, robots: 0, labs: 0 },
    titleFetches: { attempted: 0, blocked: 0, failed: 0 },
    matches: { keep: 0, update: 0, create: 0, consolidate: 0, unmatchedExisting: 0 },
    warnings: [],
    rulesetVersion: rulesetVersionForStage('overlay_existing_site'),
    ...extra,
  };
}

// Real overlay_existing_site (Phase 4 Task 18). OPTIONAL stage.
export const overlayExistingSiteHandler: StageHandler = async (ctx: StageContext) => {
  const rulesetVersion = rulesetVersionForStage('overlay_existing_site');
  const warnings: string[] = [];

  // 1: greenfield skip. No existing site to overlay -> clean skip (succeeded),
  // never a failure. websiteUrl is the crawl base; websiteDomain is the
  // registrable-domain filter + the labs target.
  const site = ctx.normalizedBrief.websiteUrl;
  const domain = ctx.normalizedBrief.websiteDomain;
  if (!site || !domain) {
    const output = emptyOverlayOutput({ skipped: true, reason: 'greenfield' });
    return { output, status: 'succeeded' as const };
  }

  // Load stage 15's planned pages once (used for both title-candidate ranking
  // and the match step).
  const plannedPages = await loadPagePlanPages(ctx);

  // 2: free sitemap inventory.
  const inventory = new Map<string, DiscoveredVia>();
  const sitemapUrls = await crawlSitemapInventory(site, domain, OVERLAY.maxSitemapUrls, warnings);
  for (const [url, via] of sitemapUrls) inventory.set(url, via);

  // 3: title enrichment on the highest-overlap candidates (a no-op when the
  // crawl found nothing). A blocked page or a failed fetch keeps a null title.
  const titleByUrl = new Map<string, TitleFetch>();
  let titleAttempted = 0;
  let titleBlocked = 0;
  let titleFailed = 0;
  const candidates = selectTitleFetchCandidates([...inventory.keys()], plannedPages, OVERLAY.maxPageFetches);
  for (const url of candidates) {
    titleAttempted++;
    try {
      const res = await fetchPageTitle(url);
      if (res.blocked) titleBlocked++;
      titleByUrl.set(url, { title: res.blocked ? null : res.title, status: res.status });
    } catch (err) {
      titleFailed++;
      warnings.push(siteFetchWarning('title', err));
    }
  }

  // 4: paid labs fallback, ONLY when the free crawl yielded zero URLs. A
  // successful crawl never spends the DFS call (the plan line is a ceiling). A
  // per-call provider throw here (network, timeout, invalid response) is CAUGHT
  // into inventory_limited, not propagated: this is an optional-stage last-resort
  // fallback, and the stage's own semantics already treat "the fallback learned
  // nothing" as a partial result, so catching yields a cleaner, still-truthful
  // outcome than letting the throw degrade the run with no structured output. We
  // NEVER report "the site has no pages" as a finding: zero inventory from all
  // sources is a warning, and every planned page simply stays `create`.
  //
  // The ONE class of error that is NOT swallowed is an account-wide provider
  // wall (isAccountWideProviderError: budget_exceeded, provider_quota_exhausted,
  // provider_rate_limited). Those are not "the fallback learned nothing" -- they
  // are a run/account-level condition that the retry_wait path exists to handle,
  // and swallowing one would misattribute a budget/rate wall as a content gap
  // and foreclose the retry. It is rethrown so the stage lands in retry_wait/
  // fail with the true code (same rule collect_competitor_evidence follows).
  if (inventory.size === 0) {
    warnings.push('inventory_limited');
    const market = await loadStageOutput<ResolvedMarket>(ctx.d1, ctx.runId, 'resolve_market');
    if (market) {
      try {
        const costs = await loadDfsCostEstimates(ctx.env.KV);
        const own = await fetchOwnRankedUrls(ctx, market, domain, costs);
        for (const o of own) {
          if (!urlOnDomain(o.url, domain)) continue;
          if (!inventory.has(o.url)) inventory.set(o.url, 'labs');
        }
      } catch (err) {
        if (isAccountWideProviderError(err)) throw err;
        // Per-call fallback error; inventory stays empty -> the stage degrades
        // to partial below. Only per-call errors are swallowed (see above).
      }
    }
  }

  // 5: match the inventory against the planned pages.
  const existingInputs: ExistingPageInput[] = [...inventory.keys()]
    .sort()
    .map((url) => ({ url, title: titleByUrl.get(url)?.title ?? null }));
  const matchResult = assignMatches(existingInputs, plannedPages, {
    keepMatchScoreMin: OVERLAY.keepMatchScoreMin,
    matchScoreMin: OVERLAY.matchScoreMin,
  });
  const existingByUrl = new Map(matchResult.existingPages.map((e) => [e.url, e]));

  // 6a: persist existing_pages (reset-then-apply). match_score is the ONE-TO-ONE
  // match's score; a consolidate-only URL carries no matched page here (its
  // proposal lives in the overlay artifact), so its match_score stays NULL.
  const rows: ExistingPageRow[] = [...inventory.keys()].sort().map((url) => {
    const match = existingByUrl.get(url);
    const title = titleByUrl.get(url);
    const matchedLogicalPageId = match?.matchedLogicalPageId ?? null;
    return {
      url,
      title: title?.title ?? null,
      discoveredVia: inventory.get(url)!,
      httpStatus: title?.status ?? null,
      matchedLogicalPageId,
      matchScore: matchedLogicalPageId !== null ? match?.matchScore ?? null : null,
    };
  });
  await persistExistingPages(ctx.d1, ctx.runId, rows);

  // 6b: overlay artifact (the second, additive artifact; page-plan.json is never
  // mutated). Consolidations are the leftover existing URLs that overlap a
  // planned page above the floor but did not win a one-to-one match.
  const project = await ctx.d1
    .prepare(`SELECT organization_id FROM projects WHERE id = ?`)
    .bind(ctx.projectId)
    .first<{ organization_id: string }>();
  if (!project) {
    throw new BlueprintApiError('internal_error', safeErrorMessage('internal_error'));
  }
  const overlayArtifact = {
    rulesetVersion,
    plannedPages: matchResult.plannedPages.map((p) => ({
      logicalId: p.logicalId,
      recommendation: p.recommendation,
      matchedUrl: p.matchedUrl,
      matchScore: p.matchScore,
    })),
    consolidations: matchResult.existingPages
      .filter((e) => e.consolidateTargetLogicalId !== null)
      .map((e) => ({
        existingUrl: e.url,
        consolidateTargetLogicalId: e.consolidateTargetLogicalId,
        matchScore: e.matchScore,
      })),
  };
  await persistOverlayArtifact(ctx, project.organization_id, JSON.stringify(overlayArtifact));

  // 7: counts + semantics.
  let keep = 0;
  let update = 0;
  let create = 0;
  for (const p of matchResult.plannedPages) {
    if (p.recommendation === 'keep') keep++;
    else if (p.recommendation === 'update') update++;
    else create++;
  }
  let consolidate = 0;
  let unmatchedExisting = 0;
  for (const e of matchResult.existingPages) {
    if (e.consolidateTargetLogicalId !== null) consolidate++;
    else if (e.matchedLogicalPageId === null) unmatchedExisting++;
  }
  let sitemapCount = 0;
  let robotsCount = 0;
  let labsCount = 0;
  for (const via of inventory.values()) {
    if (via === 'sitemap') sitemapCount++;
    else if (via === 'robots') robotsCount++;
    else labsCount++;
  }

  const output: OverlayExistingSiteOutput = {
    stage: 'overlay_existing_site',
    urlsDiscovered: { sitemap: sitemapCount, robots: robotsCount, labs: labsCount },
    titleFetches: { attempted: titleAttempted, blocked: titleBlocked, failed: titleFailed },
    matches: { keep, update, create, consolidate, unmatchedExisting },
    warnings,
    rulesetVersion,
  };

  // Succeeded when ANY inventory was collected (even partially, with warnings).
  // Partial ONLY when we learned nothing about the existing site: the sitemap
  // crawl was empty (inventory_limited) AND the labs fallback also errored or
  // returned nothing, leaving zero inventory rows.
  const status = inventory.size === 0 ? ('partial' as const) : ('succeeded' as const);
  return { output, status };
};

// =====================================================================
// Stage 18: validate_blueprint (Task 19) -- REQUIRED
// =====================================================================
//
// The last gate before publish. Composes stage 15's page plan with stage 16's
// overlay into the final blueprint, runs validateBlueprintGraph + the manual
// deterministic validators (handoff Manual §Stage 16 `validate_blueprint`), and
// either throws BlueprintValidationError (blocking issues found -> the run fails
// PERMANENTLY, and because publish_blueprint runs strictly after this REQUIRED
// stage, an invalid blueprint NEVER publishes) or succeeds with the non-blocking
// warnings persisted on the stage output for publish/summary to surface.
//
// No paid provider calls (pure composition + rules over already-collected
// artifacts + facts). BlueprintValidationError maps to a permanent, non-retryable
// failure in process-run.ts (retrying an invalid blueprint can never make it
// valid; only a new run over a changed brief can), the same terminal path
// resolve_market's unsupported-language throw already uses.

interface FullPagePlan {
  pages: PlannedPage[];
  warnings: BlueprintWarning[];
  stats: PagePlanStats;
}

// Loads stage 15's full page-plan.json from R2 (pages + engine warnings +
// stats). build_page_plan is REQUIRED and runs before this stage, so a missing
// object is a broken pipeline precondition surfaced as internal_error (which, as
// a non-BlueprintValidationError throw, takes the generic retry/fail path).
async function loadFullPagePlan(ctx: StageContext): Promise<FullPagePlan> {
  const storageKey = `runs/${ctx.runId}/page-plan.json`;
  const obj = await ctx.env.BLUEPRINT_ARTIFACTS.get(storageKey);
  if (!obj) {
    throw new BlueprintApiError('internal_error', safeErrorMessage('internal_error'));
  }
  const parsed = JSON.parse(await obj.text()) as {
    pages?: PlannedPage[];
    warnings?: BlueprintWarning[];
    stats?: PagePlanStats;
  };
  return {
    pages: parsed.pages ?? [],
    warnings: parsed.warnings ?? [],
    // pageBudget/totalAddressableVolume live in stats; a plan without stats is a
    // malformed artifact, but default defensively so validation never crashes on
    // a read (the page-budget rule then compares against the real value).
    stats:
      parsed.stats ??
      ({
        pageCount: parsed.pages?.length ?? 0,
        skeletonPageCount: 0,
        dedicatedPageCount: 0,
        sectionCount: 0,
        faqCount: 0,
        clustersPlaced: 0,
        demotedPageCount: 0,
        cannibalizedCount: 0,
        serviceLocationBlockedCount: 0,
        totalAddressableVolume: null,
        pageBudget: parsed.pages?.length ?? 0,
      } satisfies PagePlanStats),
  };
}

// Loads stage 16's overlay.json from R2, or null when absent. Overlay is
// OPTIONAL: greenfield briefs and overlay-skipped runs have no object, and
// validate composes with a null overlay (every planned page defaults to create).
async function loadOverlayArtifact(ctx: StageContext): Promise<OverlayResult | null> {
  const storageKey = `runs/${ctx.runId}/overlay.json`;
  const obj = await ctx.env.BLUEPRINT_ARTIFACTS.get(storageKey);
  if (!obj) return null;
  return JSON.parse(await obj.text()) as OverlayResult;
}

// doorway.ts's Service/ServiceArea/KeywordClusterSummary from the page-plan
// facts projection, filling the fields the doorway evaluators never read with
// safe defaults. Same adapters build_page_plan uses at mint time, so the
// re-check sees identical inputs (determinism).
function serviceForDoorway(svc: PagePlanBriefFacts['services'][number]): NormalizedProjectBrief['services'][number] {
  return { id: svc.id, name: svc.name, normalizedName: svc.normalizedName, description: null, synonyms: [], priority: svc.priority };
}
function areaForDoorway(
  area: PagePlanBriefFacts['serviceAreas'][number],
  countryIso: string,
): NormalizedProjectBrief['serviceAreas'][number] {
  return { id: area.id, city: area.city, region: area.region, countryIso, radiusKm: null, isPrimary: area.isPrimary, uniqueProof: area.uniqueProof };
}
function clusterSummaryFor(cluster: PagePlanCluster): KeywordClusterSummary {
  return {
    id: cluster.clusterId,
    label: cluster.label,
    keywordCount: 1,
    totalSearchVolume: cluster.addressableVolume,
    hasLocalizedEvidence: cluster.hasLocalizedEvidence,
  };
}

// Resolves each composed service_location page back to the service/area/cluster
// build_page_plan minted it from (via its owner cluster), so the doorway re-check
// runs on the exact same inputs. A page whose owner cluster / service / area does
// not resolve is omitted (never guessed), so an unresolvable page cannot false-
// block: only a positively-detected guardrail breach on a resolved page blocks.
function buildServiceLocationChecks(
  pages: ReturnType<typeof composeBlueprint>['pages'],
  facts: { brief: PagePlanBriefFacts; clusters: PagePlanCluster[] },
): ServiceLocationCheck[] {
  const clusterById = new Map(facts.clusters.map((c) => [c.clusterId, c]));
  const serviceById = new Map(facts.brief.services.map((s) => [s.id, s]));
  const areaById = new Map(facts.brief.serviceAreas.map((a) => [a.id, a]));

  const checks: ServiceLocationCheck[] = [];
  for (const page of pages) {
    if (page.pageType !== 'service_location') continue;
    if (page.ownerClusterId === null) continue;
    const cluster = clusterById.get(page.ownerClusterId);
    if (!cluster || cluster.serviceId === null || cluster.serviceAreaId === null) continue;
    const svc = serviceById.get(cluster.serviceId);
    const area = areaById.get(cluster.serviceAreaId);
    if (!svc || !area) continue;
    checks.push({
      logicalId: page.logicalId,
      service: serviceForDoorway(svc),
      area: areaForDoorway(area, facts.brief.countryIso),
      cluster: clusterSummaryFor(cluster),
    });
  }
  return checks;
}

export interface ValidateBlueprintOutput {
  stage: 'validate_blueprint';
  pageCount: number;
  // Always 0 on a succeeded run (a non-empty blocking set throws instead).
  blockingCount: 0;
  warnings: ValidationIssue[];
  warningCount: number;
  byRecommendation: { keep: number; update: number; create: number; consolidate: number };
  addressableDemandTotal: number | null;
  rulesetVersion: string;
}

// Real validate_blueprint (Phase 4 Task 19). REQUIRED stage.
export const validateBlueprintHandler: StageHandler = async (ctx: StageContext) => {
  const rulesetVersion = rulesetVersionForStage('validate_blueprint');

  const plan = await loadFullPagePlan(ctx);
  const overlay = await loadOverlayArtifact(ctx);
  const composed = composeBlueprint(plan.pages, overlay);

  // Doorway re-check inputs: reload the same facts build_page_plan planned over
  // (deterministic from D1), map service_location pages back to their owner
  // cluster's service/area.
  const facts = await loadPagePlanFacts(ctx.d1, ctx.runId, ctx.normalizedBrief);
  const serviceLocationChecks = buildServiceLocationChecks(composed.pages, facts);

  // Upstream skipped/partial stages, disclosed as warnings. validate_blueprint's
  // own in-flight row is never a gap (loadGapStageNames only counts terminal
  // skipped/partial/optional-failed rows), but filter it out defensively and
  // sort for a deterministic warning order.
  const gapStages = (await loadGapStageNames(ctx.d1, ctx.runId))
    .filter((s) => s !== 'validate_blueprint')
    .sort();

  const { blocking, warnings } = validateComposed(composed, PAGE_PLAN_RULESET_V1, {
    pageBudget: plan.stats.pageBudget,
    engineWarnings: plan.warnings,
    gapStages,
    overlayPresent: overlay !== null,
    mode: ctx.normalizedBrief.mode,
    serviceLocationChecks,
  });

  // Blocking issues -> permanent failure: the invalid blueprint must never
  // publish. BlueprintValidationError carries the blocking issues as fieldErrors
  // (path = subject, message = "[code] message"); process-run.ts persists the
  // first as the stage's safe_error_message (our own validation text, safe) and
  // fails this REQUIRED stage immediately with no retry cycles.
  if (blocking.length > 0) {
    throw new BlueprintValidationError(
      'invalid_input',
      blocking.map((i) => ({ path: i.subject, message: `[${i.code}] ${i.message}` })),
    );
  }

  const byRecommendation = { keep: 0, update: 0, create: 0, consolidate: 0 };
  for (const p of composed.pages) byRecommendation[p.recommendation]++;
  // Consolidations are existing-URL proposals (never a planned-page recommendation
  // in V1); count them at the URL level.
  byRecommendation.consolidate = composed.consolidations.length;

  const output: ValidateBlueprintOutput = {
    stage: 'validate_blueprint',
    pageCount: composed.pages.length,
    blockingCount: 0,
    warnings,
    warningCount: warnings.length,
    byRecommendation,
    addressableDemandTotal: plan.stats.totalAddressableVolume ?? null,
    rulesetVersion,
  };

  return { output, status: 'succeeded' as const };
};
