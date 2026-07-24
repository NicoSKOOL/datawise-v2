import type { StageContext, StageHandler } from './handlers';
import { SEARCH_INTENTS } from '../contracts/enums';
import type { SearchIntent } from '../contracts/enums';
import type { NormalizedProjectBrief } from '../contracts/types';
import {
  loadKeywordEnrichmentFromArtifacts,
  loadCompetitorRankingUrls,
} from '../providers/dataforseo/evidence-readback';
import { planUniverseNormalization } from '../domain/clustering/universe';
import type { KeywordRowLite } from '../domain/clustering/universe';
import { CLUSTER_RULESET_V2 } from '../domain/clustering/ruleset';
import { normalizeKeyword } from '../domain/keyword';
import { chunk, runBatchedStatements, assertRowBudget } from '../db/batch';
import { buildEmbeddingText, embeddingContentHash } from '../domain/clustering/features';
import type { EmbeddingInput } from '../domain/clustering/features';
import { embedKeywordTexts } from '../providers/embeddings/workers-ai';
import { assertEmbeddingSetCompatible, validateVectors } from '../domain/clustering/embeddings';
import type { KeywordVector } from '../domain/clustering/embeddings';
import { buildKeywordSimilarityGraph } from '../domain/clustering/graph';
import type { KeywordNode } from '../domain/clustering/graph';
import { buildDeterministicClusters } from '../domain/clustering/clusters';
import type { ClusterDraft } from '../domain/clustering/clusters';
import { refineClusters } from '../domain/clustering/refine';
import type { RefineClusterInput, LiveSerpEvidence, AdjudicationCase } from '../domain/clustering/refine';
import { rulesetVersionForStage } from '../domain/ruleset';
import { BlueprintApiError } from '../domain/api-errors';
import { safeErrorMessage } from '../providers/dataforseo/envelope';
import { newId, nowIso } from '../db/util';
import { loadStageOutput } from './stage-io';

// Home for Phase 4's clustering-track stage handlers (normalize_keyword_universe
// onward), the same way orchestration/research-handlers.ts is the home for
// Phase 3's evidence-collection handlers -- keeps orchestration/handlers.ts
// limited to registration plus the lighter Phase 2 stages it already owns.

interface KeywordRow {
  id: string;
  normalized_keyword: string;
  search_volume: number | null;
  keyword_difficulty: number | null;
  core_keyword: string | null;
  main_intent: string | null;
  intent_probabilities_json: string | null;
  monthly_searches_json: string | null;
  serp_features_json: string | null;
  avg_referring_domains: number | null;
  paid_competition: number | null;
}

// Tolerates a corrupt/unexpected JSON column instead of throwing: this
// stage's whole job is to backfill and score keyword data, it must never
// fail the entire batch because one earlier attempt (or a hand-edited row)
// left a malformed JSON blob behind. A parse failure is treated exactly like
// a NULL column -- still eligible to be filled by this run's enrichment
// pass, per the enrichment merge's own first-non-null-at-row-level rule.
function parseJsonColumn<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toKeywordRowLite(row: KeywordRow): KeywordRowLite {
  return {
    id: row.id,
    normalizedKeyword: row.normalized_keyword,
    searchVolume: row.search_volume,
    keywordDifficulty: row.keyword_difficulty,
    coreKeyword: row.core_keyword,
    mainIntent: row.main_intent as SearchIntent | null,
    intentProbabilities: parseJsonColumn<Record<string, number>>(row.intent_probabilities_json),
    monthlySearches: parseJsonColumn<Array<{ year: number; month: number; searchVolume: number }>>(
      row.monthly_searches_json
    ),
    serpItemTypes: parseJsonColumn<string[]>(row.serp_features_json),
    avgReferringDomains: row.avg_referring_domains,
    paidCompetition: row.paid_competition,
  };
}

// One UPDATE statement per keyword (not the multi-row VALUES batching
// research-handlers.ts's keywords INSERT uses): every row's SET list is
// identical, but the values legitimately differ row to row in a way a
// shared VALUES(...) template cannot express cleanly, so this is a plain
// per-row UPDATE, still run through db/batch.ts's runBatchedStatements so
// the whole set (however many keywords this run has) is capped at
// STATEMENTS_PER_BATCH statements per underlying d1.batch() call.
//
// COALESCE(?, column) for the seven enrichment-mergeable columns implements
// planUniverseNormalization's first-non-null-at-row-level contract directly
// in SQL: KeywordUniverseUpdate only ever sets one of these fields to a real
// (non-null) value, never explicitly back to null, so binding `undefined`
// (field not present on this keyword's plan) as SQL NULL and letting
// COALESCE fall through to the column's own current value is exactly
// "leave whatever is already there alone". The other five columns
// (relevance_score/opportunity_score/language_code/is_language_mismatch/
// excluded_reason) are unconditionally recomputed every run, so they are
// plain direct assignments, never COALESCE.
function buildKeywordUpdateStatements(
  d1: D1Database,
  updates: ReturnType<typeof planUniverseNormalization>['updates']
): D1PreparedStatement[] {
  return updates.map((u) =>
    d1
      .prepare(
        `UPDATE keywords SET
          core_keyword = COALESCE(?, core_keyword),
          main_intent = COALESCE(?, main_intent),
          intent_probabilities_json = COALESCE(?, intent_probabilities_json),
          monthly_searches_json = COALESCE(?, monthly_searches_json),
          serp_features_json = COALESCE(?, serp_features_json),
          avg_referring_domains = COALESCE(?, avg_referring_domains),
          paid_competition = COALESCE(?, paid_competition),
          relevance_score = ?,
          opportunity_score = ?,
          language_code = ?,
          is_language_mismatch = ?,
          excluded_reason = ?
         WHERE id = ?`
      )
      .bind(
        u.fields.coreKeyword ?? null,
        u.fields.mainIntent ?? null,
        u.fields.intentProbabilities ? JSON.stringify(u.fields.intentProbabilities) : null,
        u.fields.monthlySearches ? JSON.stringify(u.fields.monthlySearches) : null,
        u.fields.serpItemTypes ? JSON.stringify(u.fields.serpItemTypes) : null,
        u.fields.avgReferringDomains ?? null,
        u.fields.paidCompetition ?? null,
        u.fields.relevanceScore,
        u.fields.opportunityScore,
        u.fields.languageCode,
        u.fields.isLanguageMismatch ? 1 : 0,
        u.fields.excludedReason,
        u.keywordId
      )
  );
}

// keyword_services / keyword_service_areas rows: (keyword_id, other_id), 2
// bound params per row -- same shape and same JOIN_ROWS_PER_STATEMENT budget
// research-handlers.ts's persistJoinRows already established for these exact
// tables (plus keyword_evidence_refs, which this stage does not touch). Not
// imported from there (that function is module-private) because duplicating
// this ~10-line helper keeps this task's diff scoped to files this task
// actually owns, per the brief's "stage specific files only" commit rule,
// rather than widening an already-landed Phase 3 module's exports.
const JOIN_PARAMS_PER_ROW = 2;
const JOIN_ROWS_PER_STATEMENT = 45;
assertRowBudget(JOIN_ROWS_PER_STATEMENT, JOIN_PARAMS_PER_ROW, 'clustering join table insert');

async function persistJoinRows(
  d1: D1Database,
  table: 'keyword_services' | 'keyword_service_areas',
  otherColumn: string,
  rows: Array<[string, string]>
): Promise<void> {
  if (rows.length === 0) return;
  const statements: D1PreparedStatement[] = [];
  for (const rowsChunk of chunk(rows, JOIN_ROWS_PER_STATEMENT)) {
    const placeholders = rowsChunk.map(() => '(?, ?)').join(',');
    const args = rowsChunk.flat();
    statements.push(
      d1.prepare(`INSERT OR IGNORE INTO ${table} (keyword_id, ${otherColumn}) VALUES ${placeholders}`).bind(...args)
    );
  }
  await runBatchedStatements(d1, statements);
}

export interface NormalizeKeywordUniverseOutput {
  stage: 'normalize_keyword_universe';
  total: number;
  retained: number;
  excluded: number;
  languageMismatches: number;
  enriched: number;
  serviceLinksAdded: number;
  areaLinksAdded: number;
  artifactsRead: number;
  artifactsMissing: number;
  // cluster-v3 geo_candidate flags: keywords naming an out-of-area US state or
  // city (NOT excluded here, only flagged). Persisted on this stage output JSON
  // so the Phase D adjudicate_clusters stage can read it back via
  // loadStageOutput<NormalizeKeywordUniverseOutput> and decide out_of_area.
  geoCandidates: Array<{ keywordId: string; matchedGeoTerms: string[] }>;
  rulesetVersion: string;
}

// Real normalize_keyword_universe, not a stub (Phase 4 Task 7). Optional
// stage (stages.ts): a declared evidence gap (artifactsMissing > 0) degrades
// this stage's own status to 'partial' rather than throwing, so a run whose
// R2 artifacts partially expired still gets a scored, capped keyword
// universe for every stage downstream of this one, just with fewer
// enrichment fields backfilled than a fully warm run would have.
//
// serviceLinksAdded/areaLinksAdded report the COUNT OF MATCHES this attempt
// computed (plan.serviceLinks.length / plan.serviceAreaLinks.length), not a
// true "newly inserted this attempt" diff -- INSERT OR IGNORE means a link
// already persisted by an earlier attempt (or discovered independently by
// another stage) silently no-ops rather than erroring, and counting actual
// D1-reported new rows would need a per-statement round trip this batched
// insert deliberately avoids. This mirrors the brief's own "simpler: emit
// all matches" guidance for the plan itself.
export const normalizeKeywordUniverseHandler: StageHandler = async (ctx: StageContext) => {
  const rows = await ctx.d1
    .prepare(
      `SELECT id, normalized_keyword, search_volume, keyword_difficulty, core_keyword, main_intent,
              intent_probabilities_json, monthly_searches_json, serp_features_json,
              avg_referring_domains, paid_competition
       FROM keywords WHERE run_id = ? ORDER BY normalized_keyword ASC`
    )
    .bind(ctx.runId)
    .all<KeywordRow>();
  const keywords = (rows.results ?? []).map(toKeywordRowLite);

  const brief = ctx.normalizedBrief;
  const locale = `${brief.languageCode}-${brief.countryIso}`;
  const { data: enrichment, artifactsRead, artifactsMissing } = await loadKeywordEnrichmentFromArtifacts(
    ctx.d1,
    ctx.env.BLUEPRINT_ARTIFACTS,
    ctx.env.KV,
    ctx.runId,
    locale
  );

  const plan = planUniverseNormalization({ keywords, enrichment, brief, ruleset: CLUSTER_RULESET_V2 });

  const updateStatements = buildKeywordUpdateStatements(ctx.d1, plan.updates);
  await runBatchedStatements(ctx.d1, updateStatements);
  await persistJoinRows(ctx.d1, 'keyword_services', 'service_id', plan.serviceLinks);
  await persistJoinRows(ctx.d1, 'keyword_service_areas', 'service_area_id', plan.serviceAreaLinks);

  const output: NormalizeKeywordUniverseOutput = {
    stage: 'normalize_keyword_universe',
    total: plan.counters.total,
    retained: plan.counters.retained,
    excluded: plan.counters.excluded,
    languageMismatches: plan.counters.languageMismatches,
    enriched: plan.counters.enriched,
    serviceLinksAdded: plan.serviceLinks.length,
    areaLinksAdded: plan.serviceAreaLinks.length,
    artifactsRead,
    artifactsMissing,
    geoCandidates: plan.geoCandidates,
    rulesetVersion: CLUSTER_RULESET_V2.version,
  };

  return { output, status: artifactsMissing > 0 ? ('partial' as const) : ('succeeded' as const) };
};

interface RetainedKeywordRow {
  id: string;
  display_keyword: string;
  core_keyword: string | null;
  normalized_keyword: string;
}

export interface EmbedKeywordFeaturesOutput {
  stage: 'embed_keyword_features';
  model: string;
  dimensions: number;
  vectorCount: number;
  batchCount: number;
  inputHash: string;
  truncatedCount: number;
  artifacts: Array<{ artifactId: string; storageKey: string; count: number }>;
  rulesetVersion: string;
}

// Real embed_keyword_features, not a stub (Phase 4 Task 8). Optional stage
// (stages.ts): embeds every RETAINED keyword (excluded_reason IS NULL --
// normalize_keyword_universe already decided which keywords survive) with
// Workers AI, ordered by normalized_keyword so a retry's chunking lines up
// with providers/embeddings/workers-ai.ts's deterministic per-run,
// per-batch-index R2 keys. A run whose universe exceeds
// CLUSTER_RULESET_V2.embedding.maxBatchesPerRun * batchSize degrades to
// 'partial' (truncatedCount > 0) rather than failing outright -- the
// clustering stages downstream still get a real, just incomplete, feature
// set for this run, matching normalize_keyword_universe's own
// partial-on-gap precedent above.
export const embedKeywordFeaturesHandler: StageHandler = async (ctx: StageContext) => {
  const rows = await ctx.d1
    .prepare(
      `SELECT id, display_keyword, core_keyword, normalized_keyword
       FROM keywords WHERE run_id = ? AND excluded_reason IS NULL ORDER BY normalized_keyword ASC`
    )
    .bind(ctx.runId)
    .all<RetainedKeywordRow>();
  const retained = rows.results ?? [];

  const { contextTemplate } = CLUSTER_RULESET_V2.embedding;
  const brief = { category: ctx.normalizedBrief.category };

  const inputs: EmbeddingInput[] = [];
  for (const row of retained) {
    const text = buildEmbeddingText(
      { displayKeyword: row.display_keyword, coreKeyword: row.core_keyword },
      brief,
      contextTemplate
    );
    const contentHash = await embeddingContentHash(CLUSTER_RULESET_V2.embedding.model, contextTemplate, text);
    inputs.push({ keywordId: row.id, normalizedKeyword: row.normalized_keyword, text, contentHash });
  }

  const result = await embedKeywordTexts(ctx, inputs, CLUSTER_RULESET_V2);

  const output: EmbedKeywordFeaturesOutput = {
    stage: 'embed_keyword_features',
    model: result.model,
    dimensions: result.dimensions,
    vectorCount: result.vectorCount,
    batchCount: result.batches.length,
    inputHash: result.inputHash,
    truncatedCount: result.truncatedCount,
    artifacts: result.batches,
    rulesetVersion: CLUSTER_RULESET_V2.version,
  };

  return { output, status: result.truncatedCount > 0 ? ('partial' as const) : ('succeeded' as const) };
};

// ===== build_provisional_clusters (Phase 4 Task 10) =====
//
// Real handler, not a stub, and a REQUIRED stage (stages.ts): a throw here
// fails the whole run rather than degrading it to partial. That is
// deliberate -- a run with no provisional clusters has nothing for
// refine_clusters/build_page_plan downstream to work with, so this stage
// must never fabricate a clustering result out of missing or malformed
// upstream data.

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

// Small, local, English-only stopword list. Locale-aware stopwords (or a
// per-language list) are a later concern this task's brief explicitly
// deferred -- every run in this codebase today is en-* (V1_LIMITS), so a
// single hardcoded list is honest about what is actually supported rather
// than pretending a real i18n stopword pipeline exists.
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'near', 'by', 'from', 'into', 'is', 'are', 'be', 'my', 'our', 'your', 'you',
  'how', 'what', 'where', 'when', 'why', 'who', 'which', 'this', 'that',
  'these', 'those', 'best', 'top', 'good', 'great', 'vs',
]);

// Tokens used both for the graph's blocking buckets (graph.ts) and for
// brand-token matching below. normalizedKeyword is already whitespace-
// collapsed/lowercased by domain/keyword.ts's normalizeKeyword, so a plain
// space split is safe here.
function tokenizeKeyword(normalizedKeyword: string): string[] {
  return normalizedKeyword
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Registrable-domain label: the first dot-delimited segment, lowercased.
// 'bluedogtraining.com.au' -> 'bluedogtraining', 'bluedogtraining.com' ->
// 'bluedogtraining'. This is a heuristic, not a public-suffix-list lookup
// (no such list is vendored in this codebase) -- good enough for brand-token
// detection, which only needs "the distinctive part of the name", not a
// legally precise registrable domain.
function registrableDomainLabel(domain: string): string | null {
  const trimmed = domain.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  const firstDot = trimmed.indexOf('.');
  const label = firstDot === -1 ? trimmed : trimmed.slice(0, firstDot);
  return label.length >= 2 ? label : null;
}

// Generic-vocabulary tokens drawn straight from the brief: the business's own
// category (e.g. 'Plumber') and every declared service's name/synonyms (e.g.
// 'Drain Cleaning') are, by construction, ordinary industry vocabulary for
// THIS business, never a distinguishing brand signal -- even when one of
// those words also happens to be a substring of the business name itself
// ('Aqua Plumbing' + category 'Plumbing' both containing 'plumbing' is
// exactly this case). Tokenized through the same normalizeKeyword +
// tokenizeKeyword pipeline every keyword and the business name itself go
// through, so the set-subtraction in loadBrandTokens below is comparing like
// with like rather than raw-cased/punctuated brief text against normalized
// keyword tokens.
function briefGenericTokens(brief: NormalizedProjectBrief, locale: string): Set<string> {
  const tokens = new Set<string>();
  const addAll = (raw: string) => {
    for (const t of tokenizeKeyword(normalizeKeyword(raw, locale))) tokens.add(t);
  };
  addAll(brief.category);
  for (const service of brief.services) {
    addAll(service.normalizedName);
    for (const synonym of service.synonyms) addAll(synonym);
  }
  return tokens;
}

// Brand tokens = the business's own name tokens (stopword-filtered, same as
// every keyword's tokens, MINUS any token that is also generic industry
// vocabulary per briefGenericTokens -- a generic category/service word that
// happens to appear inside the business name is not what makes that name
// distinctive, so it must never make an otherwise-generic keyword look
// branded) plus every SELECTED competitor's registrable domain label
// (unaffected by the generic-token subtraction: a competitor's domain label
// is a different business's name, so brief-generic overlap there is
// coincidental, not the business's own generic self-description). isBranded
// below is a purely lexical test (a keyword contains one of these tokens as
// a full token); it is not intent-aware by itself -- the
// branded_navigational_x_generic constraint (constraints.ts) is what
// combines isBranded with intent === 'navigational'.
async function loadBrandTokens(
  d1: D1Database,
  runId: string,
  businessTokens: readonly string[],
  genericTokens: ReadonlySet<string>
): Promise<Set<string>> {
  const tokens = new Set<string>();
  for (const t of businessTokens) {
    if (!genericTokens.has(t)) tokens.add(t);
  }
  const rows = await d1
    .prepare(`SELECT domain FROM competitors WHERE run_id = ? AND selected = 1 ORDER BY domain ASC`)
    .bind(runId)
    .all<{ domain: string }>();
  for (const row of rows.results ?? []) {
    const label = registrableDomainLabel(row.domain);
    if (label) tokens.add(label);
  }
  return tokens;
}

function toValidatedIntent(raw: string | null): SearchIntent | null {
  if (raw === null) return null;
  return (SEARCH_INTENTS as readonly string[]).includes(raw) ? (raw as SearchIntent) : null;
}

interface ClusterableKeywordRow {
  id: string;
  display_keyword: string;
  normalized_keyword: string;
  core_keyword: string | null;
  main_intent: string | null;
  search_volume: number | null;
  relevance_score: number | null;
}

// Same JOIN-through-keywords shape for both keyword_services and
// keyword_service_areas: neither join table carries run_id of its own, so
// every reader in this module (this one included) reaches the run's rows
// through keywords.run_id. Restricted to excluded_reason IS NULL because
// only retained keywords ever become graph nodes -- an excluded keyword's
// join rows (if any survive from an earlier attempt) are irrelevant here.
async function loadKeywordJoinMap(
  d1: D1Database,
  runId: string,
  table: 'keyword_services' | 'keyword_service_areas',
  otherColumn: string
): Promise<Map<string, string[]>> {
  const { results } = await d1
    .prepare(
      `SELECT ${table}.keyword_id AS keyword_id, ${table}.${otherColumn} AS other_id
       FROM ${table}
       JOIN keywords k ON k.id = ${table}.keyword_id
       WHERE k.run_id = ? AND k.excluded_reason IS NULL
       ORDER BY ${table}.keyword_id ASC, ${table}.${otherColumn} ASC`
    )
    .bind(runId)
    .all<{ keyword_id: string; other_id: string }>();
  const map = new Map<string, string[]>();
  for (const row of results ?? []) {
    const list = map.get(row.keyword_id) ?? [];
    list.push(row.other_id);
    map.set(row.keyword_id, list);
  }
  return map;
}

// evidenceRefIds per cluster (score_breakdown_json) is the union of every
// member keyword's keyword_evidence_refs rows -- read once here for every
// retained keyword rather than per cluster, since the same keyword can be a
// member of only one cluster anyway but this avoids N+1 queries either way.
async function loadKeywordEvidenceRefMap(d1: D1Database, runId: string): Promise<Map<string, string[]>> {
  const { results } = await d1
    .prepare(
      `SELECT ker.keyword_id AS keyword_id, ker.evidence_ref_id AS evidence_ref_id
       FROM keyword_evidence_refs ker
       JOIN keywords k ON k.id = ker.keyword_id
       WHERE k.run_id = ? AND k.excluded_reason IS NULL
       ORDER BY ker.keyword_id ASC, ker.evidence_ref_id ASC`
    )
    .bind(runId)
    .all<{ keyword_id: string; evidence_ref_id: string }>();
  const map = new Map<string, string[]>();
  for (const row of results ?? []) {
    const list = map.get(row.keyword_id) ?? [];
    list.push(row.evidence_ref_id);
    map.set(row.keyword_id, list);
  }
  return map;
}

// The exact shape embed_keyword_features (workers-ai.ts) persists at each
// artifact's storageKey. Re-declared here (not imported) because
// workers-ai.ts's own StoredEmbeddingBatch type is module-private.
interface StoredEmbeddingBatchLike {
  model: string;
  dimensions: number;
  template: string;
  vectors: KeywordVector[];
}

// Loads every vector this run's embed_keyword_features attempt wrote,
// re-validates the set exactly the way workers-ai.ts validates a fresh
// response (Task 8 review follow-up), and additionally asserts the merged
// set's actual dimensions match stage9.dimensions (the value that stage
// itself recorded) -- a mismatch there means the R2 objects and the stage's
// own bookkeeping have drifted apart, which is a data-integrity throw, not
// a soft warning.
//
// Design decision (pre-resolved by the brief, recorded here for anyone
// reading this later): this does NOT assert dimensions === 1024
// (CLUSTER_RULESET_V2.embedding.dimensions) as a hard throw. Production
// bge-m3 output is 1024-wide, but every test in this codebase's suite runs
// against a fake Workers AI binding that returns 32-wide vectors (see
// test-support/env.ts's FAKE_AI_DIMENSIONS) -- asserting against the
// ruleset's pinned width here would make every clustering test that
// exercises a real embed_keyword_features attempt fail. So the self-
// consistency check (vectors vs. the stage's own recorded width) throws,
// but a self-consistent width that merely disagrees with the ruleset's
// pinned width degrades to a warning surfaced on this stage's own
// output_json (`warnings: ['unexpected_embedding_dimensions']`) instead.
async function loadStageVectors(
  r2: R2Bucket,
  stage9: EmbedKeywordFeaturesOutput
): Promise<{ vectorsById: Map<string, number[]>; dimensions: number; unexpectedDimensions: boolean }> {
  const sortedArtifacts = stage9.artifacts
    .slice()
    .sort((a, b) => (a.storageKey < b.storageKey ? -1 : a.storageKey > b.storageKey ? 1 : 0));

  const batchMetas: Array<{ model: string; dimensions: number }> = [];
  const allVectors: KeywordVector[] = [];

  for (const artifact of sortedArtifacts) {
    let object: R2ObjectBody | null;
    try {
      object = await r2.get(artifact.storageKey);
    } catch {
      object = null;
    }
    if (!object) {
      throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
    }
    let parsed: StoredEmbeddingBatchLike;
    try {
      parsed = JSON.parse(await object.text());
    } catch {
      throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
    }
    if (!Array.isArray(parsed.vectors)) {
      throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
    }
    batchMetas.push({ model: parsed.model, dimensions: parsed.dimensions });
    allVectors.push(...parsed.vectors);
  }

  // Mixed model/dimensions across THIS run's own artifacts: a plain,
  // unsanitized Error by design (see embeddings.ts) -- it runs under the
  // same generic try/catch process-run.ts wraps every handler in, so it
  // still surfaces as a classified internal_error, it just is not
  // pre-sanitized at the throw site like a BlueprintApiError is.
  assertEmbeddingSetCompatible({ model: stage9.model, dimensions: stage9.dimensions }, batchMetas);
  const { dimensions } = validateVectors(allVectors);
  if (dimensions !== stage9.dimensions) {
    // Self-inconsistency: the stage's own recorded width does not match what
    // is actually stored. Never fabricate clusters over data this broken.
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }

  const vectorsById = new Map<string, number[]>();
  for (const v of allVectors) vectorsById.set(v.keywordId, v.vector);

  return {
    vectorsById,
    dimensions,
    unexpectedDimensions: dimensions !== CLUSTER_RULESET_V2.embedding.dimensions,
  };
}

interface ConfidenceResult {
  score: number;
  label: 'low' | 'medium' | 'high';
  components: { metricCoverage: number; serpAgreement: number | null; intentCertainty: number | null };
}

// Confidence is computed here, not by the pure clustering engine (Task 9):
// the engine only knows similarity/cohesion math, it has no notion of
// "coverage" over external facts like search_volume. Equal-weight average
// over whichever components are present -- same renormalize-over-present-
// components idea graph.ts's scoreEdge already uses for edge weights, just
// with all three components weighted equally instead of the ruleset's
// semantic/serp/intent split (that split is specifically about similarity
// signal strength, not about confidence in the resulting grouping).
function computeClusterConfidence(cluster: ClusterDraft, members: readonly KeywordNode[]): ConfidenceResult {
  const total = members.length;
  const withVolume = members.filter((m) => m.volume !== null).length;
  const metricCoverage = total === 0 ? 0 : withVolume / total;

  const serpAgreement = cluster.serpOverlapCohesion;

  let intentCertainty: number | null = null;
  if (cluster.intent !== null) {
    const matching = members.filter((m) => m.intent === cluster.intent).length;
    intentCertainty = total === 0 ? 0 : matching / total;
  }

  const present = [metricCoverage, serpAgreement, intentCertainty].filter(
    (v): v is number => v !== null
  );
  const avg = present.length === 0 ? 0 : present.reduce((s, v) => s + v, 0) / present.length;
  const score = round6(avg);

  const label: ConfidenceResult['label'] =
    score >= CLUSTER_RULESET_V2.confidenceLabels.high
      ? 'high'
      : score >= CLUSTER_RULESET_V2.confidenceLabels.medium
        ? 'medium'
        : 'low';

  return { score, label, components: { metricCoverage, serpAgreement, intentCertainty } };
}

// keyword_clusters has 17 columns this insert writes (page_candidate and
// adjudication_json are always NULL here -- stage 15/refine own those); at
// 17 params/row, D1's 100-bound-parameter ceiling allows at most 5 rows per
// statement.
const CLUSTER_PARAMS_PER_ROW = 17;
const CLUSTER_ROWS_PER_STATEMENT = 5;
assertRowBudget(CLUSTER_ROWS_PER_STATEMENT, CLUSTER_PARAMS_PER_ROW, 'keyword_clusters insert');

// cluster_keywords: 4 params/row.
const CLUSTER_KEYWORD_PARAMS_PER_ROW = 4;
const CLUSTER_KEYWORD_ROWS_PER_STATEMENT = 20;
assertRowBudget(CLUSTER_KEYWORD_ROWS_PER_STATEMENT, CLUSTER_KEYWORD_PARAMS_PER_ROW, 'cluster_keywords insert');

interface ClusterInsertRow {
  id: string;
  label: string;
  serviceId: string | null;
  serviceAreaId: string | null;
  intent: SearchIntent | null;
  primaryKeywordId: string;
  semanticCohesion: number | null;
  serpOverlapCohesion: number | null;
  confidenceScore: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  decisionReason: string;
  warningsJson: string;
  scoreBreakdownJson: string;
}

interface ClusterMemberInsertRow {
  clusterId: string;
  keywordId: string;
  membershipScore: number;
  isPrimary: boolean;
}

// Reset-then-apply, mirroring research-handlers.ts's persistCompetitors:
// every retry of this attempt (or a later attempt under the same input
// hash) must fully REPLACE this run's prior clustering, never accumulate
// duplicates alongside it. cluster_keywords is deleted first (it has no
// ON DELETE CASCADE from keyword_clusters in schema.sql) via a subselect on
// keyword_clusters.run_id, then keyword_clusters itself.
async function persistClusters(
  d1: D1Database,
  runId: string,
  clusterRows: ClusterInsertRow[],
  memberRows: ClusterMemberInsertRow[]
): Promise<void> {
  await d1
    .prepare(`DELETE FROM cluster_keywords WHERE cluster_id IN (SELECT id FROM keyword_clusters WHERE run_id = ?)`)
    .bind(runId)
    .run();
  await d1.prepare(`DELETE FROM keyword_clusters WHERE run_id = ?`).bind(runId).run();

  const clusterStatements: D1PreparedStatement[] = [];
  for (const rowsChunk of chunk(clusterRows, CLUSTER_ROWS_PER_STATEMENT)) {
    const placeholders = rowsChunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const args: unknown[] = [];
    for (const r of rowsChunk) {
      args.push(
        r.id,
        runId,
        r.label,
        r.serviceId,
        r.serviceAreaId,
        r.intent,
        r.primaryKeywordId,
        r.semanticCohesion,
        r.serpOverlapCohesion,
        r.confidenceScore,
        r.confidenceLabel,
        null, // page_candidate: stage 15 owns it
        r.decisionReason,
        r.warningsJson,
        null, // adjudication_json: refine_clusters owns it
        CLUSTER_RULESET_V2.version,
        r.scoreBreakdownJson
      );
    }
    clusterStatements.push(
      d1
        .prepare(
          `INSERT INTO keyword_clusters
            (id, run_id, label, service_id, service_area_id, intent, primary_keyword_id,
             semantic_cohesion, serp_overlap_cohesion, confidence_score, confidence_label,
             page_candidate, decision_reason, warnings_json, adjudication_json, ruleset_version,
             score_breakdown_json)
           VALUES ${placeholders}`
        )
        .bind(...args)
    );
  }
  await runBatchedStatements(d1, clusterStatements);

  const memberStatements: D1PreparedStatement[] = [];
  for (const rowsChunk of chunk(memberRows, CLUSTER_KEYWORD_ROWS_PER_STATEMENT)) {
    const placeholders = rowsChunk.map(() => '(?,?,?,?)').join(',');
    const args: unknown[] = [];
    for (const r of rowsChunk) {
      args.push(r.clusterId, r.keywordId, r.membershipScore, r.isPrimary ? 1 : 0);
    }
    memberStatements.push(
      d1
        .prepare(`INSERT INTO cluster_keywords (cluster_id, keyword_id, membership_score, is_primary) VALUES ${placeholders}`)
        .bind(...args)
    );
  }
  await runBatchedStatements(d1, memberStatements);
}

export interface BuildProvisionalClustersOutput {
  stage: 'build_provisional_clusters';
  keywordCount: number;
  clusterCount: number;
  singletonCount: number;
  edgeCount: number;
  forbiddenEdgeCount: number;
  blockedByCap: number;
  oversizedSplit: number;
  representativeQueries: Array<{
    clusterId: string;
    keywordId: string;
    query: string;
    serviceAreaId: string | null;
  }>;
  rulesetVersion: string;
  // Populated with 'unexpected_embedding_dimensions' when this run's vectors
  // are internally consistent but narrower/wider than CLUSTER_RULESET_V2's
  // pinned width (see loadStageVectors's doc comment), and/or
  // 'all_keywords_excluded' when this run's keyword universe was non-empty
  // but every keyword was excluded before clustering (see the zero-cluster
  // short-circuit below). Empty in the common case.
  warnings: string[];
  // Unfiltered per-run keyword count (regardless of excluded_reason) and the
  // retained subset that actually reached clustering. Always populated so a
  // reader can tell "genuinely empty universe" (total 0) apart from
  // "something upstream excluded everything" (total > 0, retained 0) without
  // cross-referencing normalize_keyword_universe's own stage output.
  totalKeywords: number;
  retainedKeywords: number;
}

const DECISION_REASON = `Clustered by semantic + SERP similarity under ruleset ${CLUSTER_RULESET_V2.version}`;

interface ClusteringNodeSet {
  nodes: KeywordNode[];
  byId: Map<string, KeywordNode>;
  displayKeywords: Map<string, string>;
  unexpectedDimensions: boolean;
  rankingArtifactsMissing: number;
}

// Builds the KeywordNode graph inputs (vectors + SERP URLs + brand flags +
// service/area links + intent) for a run's retained keywords. Extracted (Task
// 12) from build_provisional_clusters so refine_clusters reconstructs the
// EXACT same nodes it clustered over rather than duplicating the load. Takes
// the already-loaded retained rows + stage-9 output (both callers load those
// themselves for their own short-circuits), so this is purely the node
// assembly. evidence-ref loading stays with build_provisional_clusters (only
// that stage writes score_breakdown evidence refs).
async function buildClusteringNodes(
  ctx: StageContext,
  retained: ClusterableKeywordRow[],
  stage9: EmbedKeywordFeaturesOutput
): Promise<ClusteringNodeSet> {
  const { vectorsById, unexpectedDimensions } = await loadStageVectors(ctx.env.BLUEPRINT_ARTIFACTS, stage9);

  const brief = ctx.normalizedBrief;
  const locale = `${brief.languageCode}-${brief.countryIso}`;

  const [serviceMap, areaMap, rankingUrls, brandTokens] = await Promise.all([
    loadKeywordJoinMap(ctx.d1, ctx.runId, 'keyword_services', 'service_id'),
    loadKeywordJoinMap(ctx.d1, ctx.runId, 'keyword_service_areas', 'service_area_id'),
    loadCompetitorRankingUrls(ctx.d1, ctx.env.BLUEPRINT_ARTIFACTS, ctx.env.KV, ctx.runId, locale),
    loadBrandTokens(ctx.d1, ctx.runId, tokenizeKeyword(brief.normalizedBusinessName), briefGenericTokens(brief, locale)),
  ]);

  const displayKeywords = new Map<string, string>(retained.map((row) => [row.id, row.display_keyword]));

  const nodes: KeywordNode[] = retained.map((row) => {
    const tokens = tokenizeKeyword(row.normalized_keyword);
    const isBranded = tokens.some((t) => brandTokens.has(t));
    const serpUrlList = rankingUrls.data.get(row.normalized_keyword) ?? null;
    return {
      keywordId: row.id,
      normalizedKeyword: row.normalized_keyword,
      tokens,
      coreKeyword: row.core_keyword,
      vector: vectorsById.get(row.id) ?? null,
      serpUrls: serpUrlList && serpUrlList.length > 0 ? new Set(serpUrlList) : null,
      relevance: row.relevance_score,
      volume: row.search_volume,
      isBranded,
      intent: toValidatedIntent(row.main_intent),
      serviceIds: serviceMap.get(row.id) ?? [],
      serviceAreaIds: areaMap.get(row.id) ?? [],
    };
  });

  const byId = new Map(nodes.map((n) => [n.keywordId, n]));
  return { nodes, byId, displayKeywords, unexpectedDimensions, rankingArtifactsMissing: rankingUrls.artifactsMissing };
}

// Real build_provisional_clusters, not a stub (Phase 4 Task 10). REQUIRED
// stage (stages.ts): every throw below fails the whole run rather than
// degrading it to partial, because a run with no clusters has nothing for
// every downstream clustering/page-planning stage to build on.
export const buildProvisionalClustersHandler: StageHandler = async (ctx: StageContext) => {
  const stage9 = await loadStageOutput<EmbedKeywordFeaturesOutput>(ctx.d1, ctx.runId, 'embed_keyword_features');
  if (!stage9) {
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }

  const rows = await ctx.d1
    .prepare(
      `SELECT id, display_keyword, normalized_keyword, core_keyword, main_intent, search_volume, relevance_score
       FROM keywords WHERE run_id = ? AND excluded_reason IS NULL ORDER BY normalized_keyword ASC`
    )
    .bind(ctx.runId)
    .all<ClusterableKeywordRow>();
  const retained = rows.results ?? [];

  // A legitimately empty keyword universe (e.g. collect_keyword_evidence,
  // itself a REQUIRED stage, degraded to 'partial' having persisted zero
  // keywords) is not a data-integrity problem: embed_keyword_features runs
  // over zero inputs and reports a real vectorCount:0 'succeeded' output in
  // that case (embedKeywordTexts has no special-case for an empty input
  // set), so there is nothing to distinguish it from a genuine embedding
  // failure by vectorCount alone. But retained.length === 0 alone cannot
  // distinguish THAT case from stage 8 (normalize_keyword_universe) having
  // excluded every single keyword due to a bug (e.g. a bad excludedTopics
  // match, or a language-mismatch false positive) -- both look identical
  // from here. The unfiltered total tells them apart: total === 0 is a
  // genuinely empty universe (nothing to report), total > 0 with zero
  // retained means something upstream threw away a real universe.
  const totalRow = await ctx.d1
    .prepare(`SELECT COUNT(*) AS n FROM keywords WHERE run_id = ?`)
    .bind(ctx.runId)
    .first<{ n: number }>();
  const totalKeywords = totalRow?.n ?? 0;

  // Short-circuit with a truthful zero-cluster result in both cases -- that
  // is reporting reality, not fabricating clusters, so it does not violate
  // this stage's "never fabricate" mandate either way. Still runs the
  // reset-then-apply persist so a retry of this exact attempt (or a later
  // attempt whose universe shrank to zero after an earlier one had rows)
  // clears out any stale cluster rows. What differs is the reported status:
  // a genuinely empty universe is 'succeeded' (there was nothing to do), but
  // an all-excluded non-empty universe is 'partial' with an explicit
  // 'all_keywords_excluded' warning, so the gap surfaces on this run instead
  // of silently reading as a normal, successful zero-keyword project.
  if (retained.length === 0) {
    await persistClusters(ctx.d1, ctx.runId, [], []);
    const allExcluded = totalKeywords > 0;
    const output: BuildProvisionalClustersOutput = {
      stage: 'build_provisional_clusters',
      keywordCount: 0,
      clusterCount: 0,
      singletonCount: 0,
      edgeCount: 0,
      forbiddenEdgeCount: 0,
      blockedByCap: 0,
      oversizedSplit: 0,
      representativeQueries: [],
      rulesetVersion: CLUSTER_RULESET_V2.version,
      warnings: allExcluded ? ['all_keywords_excluded'] : [],
      totalKeywords,
      retainedKeywords: 0,
    };
    return { output, status: allExcluded ? ('partial' as const) : ('succeeded' as const) };
  }

  // From here on there IS a keyword universe to cluster, so a genuinely
  // empty embedding set is exactly the "never fabricate" case this
  // required stage must fail loudly on.
  if (stage9.vectorCount === 0) {
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }

  const { nodes, byId: nodeById, displayKeywords, unexpectedDimensions, rankingArtifactsMissing } =
    await buildClusteringNodes(ctx, retained, stage9);
  const evidenceRefMap = await loadKeywordEvidenceRefMap(ctx.d1, ctx.runId);

  const graph = buildKeywordSimilarityGraph({ nodes, ruleset: CLUSTER_RULESET_V2 });
  const clusterResult = buildDeterministicClusters({
    nodes,
    edges: graph.edges,
    displayKeywords,
    ruleset: CLUSTER_RULESET_V2,
  });

  const clusterIds = new Map<string, string>();
  for (const c of clusterResult.clusters) clusterIds.set(c.clusterKey, newId('kcl'));

  const clusterRows: ClusterInsertRow[] = [];
  const memberRows: ClusterMemberInsertRow[] = [];

  for (const c of clusterResult.clusters) {
    const id = clusterIds.get(c.clusterKey)!;
    const memberNodes = c.memberIds.map((mid) => nodeById.get(mid)!);
    const { score, label, components } = computeClusterConfidence(c, memberNodes);

    const evidenceRefIds = Array.from(
      new Set(c.memberIds.flatMap((mid) => evidenceRefMap.get(mid) ?? []))
    )
      .sort()
      .slice(0, 50);

    const scoreBreakdown = {
      rulesetVersion: CLUSTER_RULESET_V2.version,
      edgeWeights: CLUSTER_RULESET_V2.edgeWeights,
      semanticCohesion: c.semanticCohesion,
      serpOverlapCohesion: c.serpOverlapCohesion,
      confidenceComponents: components,
      evidenceRefIds,
    };

    clusterRows.push({
      id,
      label: c.label,
      serviceId: c.serviceId,
      serviceAreaId: c.serviceAreaId,
      intent: c.intent,
      primaryKeywordId: c.primaryKeywordId,
      semanticCohesion: c.semanticCohesion,
      serpOverlapCohesion: c.serpOverlapCohesion,
      confidenceScore: score,
      confidenceLabel: label,
      decisionReason: DECISION_REASON,
      warningsJson: JSON.stringify(c.warnings),
      scoreBreakdownJson: JSON.stringify(scoreBreakdown),
    });

    for (const mid of c.memberIds) {
      memberRows.push({
        clusterId: id,
        keywordId: mid,
        membershipScore: c.membershipScores[mid],
        isPrimary: mid === c.primaryKeywordId,
      });
    }
  }

  await persistClusters(ctx.d1, ctx.runId, clusterRows, memberRows);

  // Representative queries: non-singleton clusters only, ordered by
  // memberCount DESC then clusterKey ASC (deterministic), capped at 20.
  const representativeQueries = clusterResult.clusters
    .filter((c) => c.memberIds.length > 1)
    .slice()
    .sort((a, b) => {
      if (b.memberIds.length !== a.memberIds.length) return b.memberIds.length - a.memberIds.length;
      return a.clusterKey < b.clusterKey ? -1 : a.clusterKey > b.clusterKey ? 1 : 0;
    })
    .slice(0, 20)
    .map((c) => ({
      clusterId: clusterIds.get(c.clusterKey)!,
      keywordId: c.primaryKeywordId,
      query: displayKeywords.get(c.primaryKeywordId) ?? c.label,
      serviceAreaId: c.serviceAreaId,
    }));

  const warnings: string[] = [];
  if (unexpectedDimensions) warnings.push('unexpected_embedding_dimensions');

  const output: BuildProvisionalClustersOutput = {
    stage: 'build_provisional_clusters',
    keywordCount: retained.length,
    clusterCount: clusterResult.stats.clusterCount,
    singletonCount: clusterResult.stats.singletonCount,
    edgeCount: graph.stats.scoredEdges,
    forbiddenEdgeCount: graph.stats.forbiddenEdges,
    blockedByCap: graph.stats.blockedByCap,
    oversizedSplit: clusterResult.stats.oversizedSplit,
    representativeQueries,
    rulesetVersion: CLUSTER_RULESET_V2.version,
    warnings,
    totalKeywords,
    retainedKeywords: retained.length,
  };

  return {
    output,
    status: rankingArtifactsMissing > 0 ? ('partial' as const) : ('succeeded' as const),
  };
};

// ===== refine_clusters (Phase 4 Task 12) =====
//
// Deterministic, live-SERP-driven refinement of build_provisional_clusters'
// output. OPTIONAL stage (stages.ts): it never fails the run. NO AI calls, NO
// provider calls -- it reads the live SERP snapshots validate_serps_and_questions
// already fetched for cluster representative queries (serp_snapshots +
// faq_evidence) and applies only unambiguous, constraint-clean merges/splits.
// Every low-confidence boundary is persisted to cluster_adjudications as
// 'pending' (live evidence exists) or 'insufficient_evidence' (it does not) for
// the Phase 5 adjudicator, never guessed here.

const REFINE_DECISION_REASON = `Refined by live SERP evidence under ruleset ${CLUSTER_RULESET_V2.version}`;

// cluster_adjudications: (id, run_id, case_type, cluster_ids_json,
// keyword_ids_json, decision, score_context_json, ruleset_version, created_at)
// = 9 bound params/row; resolved_at is a NULL literal. floor(100/9) = 11; back
// off to 10 (90 params) for headroom.
const ADJ_PARAMS_PER_ROW = 9;
const ADJ_ROWS_PER_STATEMENT = 10;
assertRowBudget(ADJ_ROWS_PER_STATEMENT, ADJ_PARAMS_PER_ROW, 'cluster_adjudications insert');

// DELETE ... WHERE col IN (...): 1 bound param per id, well under the 100 cap
// when chunked at 90.
const DELETE_IDS_PER_STATEMENT = 90;

export interface RefineClustersOutput {
  stage: 'refine_clusters';
  // Present (and true) only on the zero-cluster short-circuit.
  skipped?: boolean;
  reason?: string;
  clustersIn: number;
  clustersOut: number;
  autoMerges: number;
  // Deterministic cleaned-name / near-name merges (cluster-v3), counted apart
  // from the SERP-driven autoMerges.
  nameMerges: number;
  autoSplits: number;
  adjudicationsPending: number;
  adjudicationsInsufficient: number;
  // Cases dropped by clusters.maxPersistedAdjudications (lowest-scoring
  // first); 0 when everything fit. Non-zero adds the
  // 'adjudications_truncated' warning.
  adjudicationsTruncated: number;
  liveSnapshotCoverage: number;
  rulesetVersion: string;
  // 'no_live_serp_evidence' when no cluster representative query had a live
  // snapshot (liveSnapshotCoverage === 0): the stage completes as 'partial',
  // persists adjudications as insufficient_evidence, and makes no auto-changes.
  warnings: string[];
}

interface RefineClusterRow {
  id: string;
  primary_keyword_id: string;
  intent: string | null;
}

interface RefineSnapshotRow {
  nk: string;
  organic_json: string | null;
  related_searches_json: string | null;
}

// Loads the run's live SERP snapshots (organic URLs + related searches) and PAA
// questions, keyed by the snapshot keyword's normalized_keyword -- the same key
// a cluster's representative query normalizes to. Multiple snapshots for one
// normalized query (different SERP locations) are merged (union of URLs /
// related searches / questions). Related searches and PAA questions are
// normalized here so refine.ts's cross-appearance test compares like with like.
async function loadLiveSerpEvidence(
  d1: D1Database,
  runId: string,
  locale: string
): Promise<Map<string, LiveSerpEvidence>> {
  const snapRows = await d1
    .prepare(
      `SELECT k.normalized_keyword AS nk, s.organic_json AS organic_json, s.related_searches_json AS related_searches_json
       FROM serp_snapshots s JOIN keywords k ON k.id = s.keyword_id
       WHERE s.run_id = ? ORDER BY s.id ASC`
    )
    .bind(runId)
    .all<RefineSnapshotRow>();
  const paaRows = await d1
    .prepare(
      `SELECT k.normalized_keyword AS nk, f.question AS question
       FROM faq_evidence f
       JOIN serp_snapshots s ON s.id = f.serp_snapshot_id
       JOIN keywords k ON k.id = s.keyword_id
       WHERE f.run_id = ? ORDER BY f.id ASC`
    )
    .bind(runId)
    .all<{ nk: string; question: string }>();

  const accum = new Map<string, { organic: Set<string>; related: Set<string>; paa: Set<string> }>();
  const ensure = (nk: string) => {
    let e = accum.get(nk);
    if (!e) {
      e = { organic: new Set(), related: new Set(), paa: new Set() };
      accum.set(nk, e);
    }
    return e;
  };

  for (const row of snapRows.results ?? []) {
    // A snapshot with empty organic and no related searches still marks its
    // query as "has live evidence" (presence in the map) -- the entry is
    // created here regardless.
    const e = ensure(row.nk);
    const organic = parseJsonColumn<Array<{ url?: string | null }>>(row.organic_json) ?? [];
    for (const item of organic) if (typeof item?.url === 'string') e.organic.add(item.url);
    const related = parseJsonColumn<string[]>(row.related_searches_json) ?? [];
    for (const r of related) {
      const n = normalizeKeyword(r, locale);
      if (n) e.related.add(n);
    }
  }
  for (const row of paaRows.results ?? []) {
    const e = ensure(row.nk);
    const n = normalizeKeyword(row.question, locale);
    if (n) e.paa.add(n);
  }

  const out = new Map<string, LiveSerpEvidence>();
  for (const [nk, e] of accum) {
    out.set(nk, {
      organicUrls: [...e.organic].sort(),
      relatedSearches: [...e.related].sort(),
      paaQuestions: [...e.paa].sort(),
    });
  }
  return out;
}

// Changed-only reset-then-apply: only the input clusters consumed by a merge or
// split (their ids in consumedInputIds) are deleted; unchanged clusters' rows
// are left completely untouched. New (merged/split) clusters are inserted with
// the same 17-column shape build_provisional_clusters uses.
async function persistRefinedClusters(
  d1: D1Database,
  runId: string,
  consumedInputIds: string[],
  clusterRows: ClusterInsertRow[],
  memberRows: ClusterMemberInsertRow[]
): Promise<void> {
  for (const idsChunk of chunk(consumedInputIds, DELETE_IDS_PER_STATEMENT)) {
    const placeholders = idsChunk.map(() => '?').join(',');
    await d1
      .prepare(`DELETE FROM cluster_keywords WHERE cluster_id IN (${placeholders})`)
      .bind(...idsChunk)
      .run();
    await d1
      .prepare(`DELETE FROM keyword_clusters WHERE id IN (${placeholders})`)
      .bind(...idsChunk)
      .run();
  }

  const clusterStatements: D1PreparedStatement[] = [];
  for (const rowsChunk of chunk(clusterRows, CLUSTER_ROWS_PER_STATEMENT)) {
    const placeholders = rowsChunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const args: unknown[] = [];
    for (const r of rowsChunk) {
      args.push(
        r.id,
        runId,
        r.label,
        r.serviceId,
        r.serviceAreaId,
        r.intent,
        r.primaryKeywordId,
        r.semanticCohesion,
        r.serpOverlapCohesion,
        r.confidenceScore,
        r.confidenceLabel,
        null, // page_candidate: stage 15 owns it
        r.decisionReason,
        r.warningsJson,
        null, // adjudication_json: the cluster_adjudications table owns refine adjudications
        CLUSTER_RULESET_V2.version,
        r.scoreBreakdownJson
      );
    }
    clusterStatements.push(
      d1
        .prepare(
          `INSERT INTO keyword_clusters
            (id, run_id, label, service_id, service_area_id, intent, primary_keyword_id,
             semantic_cohesion, serp_overlap_cohesion, confidence_score, confidence_label,
             page_candidate, decision_reason, warnings_json, adjudication_json, ruleset_version,
             score_breakdown_json)
           VALUES ${placeholders}`
        )
        .bind(...args)
    );
  }
  await runBatchedStatements(d1, clusterStatements);

  const memberStatements: D1PreparedStatement[] = [];
  for (const rowsChunk of chunk(memberRows, CLUSTER_KEYWORD_ROWS_PER_STATEMENT)) {
    const placeholders = rowsChunk.map(() => '(?,?,?,?)').join(',');
    const args: unknown[] = [];
    for (const r of rowsChunk) {
      args.push(r.clusterId, r.keywordId, r.membershipScore, r.isPrimary ? 1 : 0);
    }
    memberStatements.push(
      d1
        .prepare(`INSERT INTO cluster_keywords (cluster_id, keyword_id, membership_score, is_primary) VALUES ${placeholders}`)
        .bind(...args)
    );
  }
  await runBatchedStatements(d1, memberStatements);
}

// Rerun-safe: every attempt fully replaces this run's cluster_adjudications
// (delete-then-insert), so a retry never accumulates duplicate rows alongside a
// prior attempt's. Persistence is capped at
// clusters.maxPersistedAdjudications, keeping the highest-scoring cases
// (score DESC, nulls last, then clusterIds/caseType for a deterministic
// order); returns how many were dropped so the handler can surface it.
// Exported for the cap regression test only.
export async function persistAdjudications(
  d1: D1Database,
  runId: string,
  allCases: AdjudicationCase[],
  createdAt: string
): Promise<{ truncated: number }> {
  await d1.prepare(`DELETE FROM cluster_adjudications WHERE run_id = ?`).bind(runId).run();
  if (allCases.length === 0) return { truncated: 0 };

  const cap = CLUSTER_RULESET_V2.clusters.maxPersistedAdjudications;
  let cases = allCases;
  if (allCases.length > cap) {
    cases = allCases
      .slice()
      .sort((x, y) => {
        const sx = x.scoreContext.score;
        const sy = y.scoreContext.score;
        if (sx === null && sy !== null) return 1;
        if (sy === null && sx !== null) return -1;
        if (sx !== null && sy !== null && sx !== sy) return sy - sx;
        const cx = x.clusterIds.join(' ');
        const cy = y.clusterIds.join(' ');
        return cx < cy ? -1 : cx > cy ? 1 : x.caseType < y.caseType ? -1 : x.caseType > y.caseType ? 1 : 0;
      })
      .slice(0, cap);
  }

  const rulesetVersion = rulesetVersionForStage('refine_clusters');
  const statements: D1PreparedStatement[] = [];
  for (const rowsChunk of chunk(cases, ADJ_ROWS_PER_STATEMENT)) {
    const placeholders = rowsChunk.map(() => '(?,?,?,?,?,?,?,?,?,NULL)').join(',');
    const args: unknown[] = [];
    for (const c of rowsChunk) {
      args.push(
        newId('cadj'),
        runId,
        c.caseType,
        JSON.stringify(c.clusterIds),
        JSON.stringify(c.keywordIds),
        c.decision,
        JSON.stringify(c.scoreContext),
        rulesetVersion,
        createdAt
      );
    }
    statements.push(
      d1
        .prepare(
          `INSERT INTO cluster_adjudications
            (id, run_id, case_type, cluster_ids_json, keyword_ids_json, decision, score_context_json,
             ruleset_version, created_at, resolved_at)
           VALUES ${placeholders}`
        )
        .bind(...args)
    );
  }
  await runBatchedStatements(d1, statements);
  return { truncated: allCases.length - cases.length };
}

export const refineClustersHandler: StageHandler = async (ctx: StageContext) => {
  const clusterRows = await ctx.d1
    .prepare(`SELECT id, primary_keyword_id, intent FROM keyword_clusters WHERE run_id = ? ORDER BY id ASC`)
    .bind(ctx.runId)
    .all<RefineClusterRow>();
  const clusters = clusterRows.results ?? [];

  // Zero clusters (stage 10 short-circuited on an empty/all-excluded universe):
  // nothing to refine. Reset any stale adjudications from a prior attempt, then
  // report a truthful skip -- succeeded, not a failure.
  if (clusters.length === 0) {
    await persistAdjudications(ctx.d1, ctx.runId, [], nowIso());
    const output: RefineClustersOutput = {
      stage: 'refine_clusters',
      skipped: true,
      reason: 'no_clusters',
      clustersIn: 0,
      clustersOut: 0,
      autoMerges: 0,
      nameMerges: 0,
      autoSplits: 0,
      adjudicationsPending: 0,
      adjudicationsInsufficient: 0,
      adjudicationsTruncated: 0,
      liveSnapshotCoverage: 0,
      rulesetVersion: CLUSTER_RULESET_V2.version,
      warnings: [],
    };
    return { output, status: 'succeeded' as const };
  }

  const stage9 = await loadStageOutput<EmbedKeywordFeaturesOutput>(ctx.d1, ctx.runId, 'embed_keyword_features');
  if (!stage9) {
    // Clusters exist but embed_keyword_features left no readable output: the run
    // is broken. Optional stage, so this degrades the run to partial rather than
    // failing it.
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }

  const retainedRows = await ctx.d1
    .prepare(
      `SELECT id, display_keyword, normalized_keyword, core_keyword, main_intent, search_volume, relevance_score
       FROM keywords WHERE run_id = ? AND excluded_reason IS NULL ORDER BY normalized_keyword ASC`
    )
    .bind(ctx.runId)
    .all<ClusterableKeywordRow>();
  const retained = retainedRows.results ?? [];

  const { nodes, byId, displayKeywords, unexpectedDimensions } = await buildClusteringNodes(ctx, retained, stage9);
  const evidenceRefMap = await loadKeywordEvidenceRefMap(ctx.d1, ctx.runId);

  const memberRows = await ctx.d1
    .prepare(
      `SELECT ck.cluster_id AS cluster_id, ck.keyword_id AS keyword_id
       FROM cluster_keywords ck
       JOIN keyword_clusters kc ON kc.id = ck.cluster_id
       WHERE kc.run_id = ? ORDER BY ck.cluster_id ASC, ck.keyword_id ASC`
    )
    .bind(ctx.runId)
    .all<{ cluster_id: string; keyword_id: string }>();
  const membersByCluster = new Map<string, string[]>();
  for (const row of memberRows.results ?? []) {
    const list = membersByCluster.get(row.cluster_id) ?? [];
    list.push(row.keyword_id);
    membersByCluster.set(row.cluster_id, list);
  }

  const locale = `${ctx.normalizedBrief.languageCode}-${ctx.normalizedBrief.countryIso}`;
  const liveByQuery = await loadLiveSerpEvidence(ctx.d1, ctx.runId, locale);

  const refineInputs: RefineClusterInput[] = clusters.map((c) => ({
    clusterId: c.id,
    memberIds: membersByCluster.get(c.id) ?? [],
    primaryKeywordId: c.primary_keyword_id,
    intent: toValidatedIntent(c.intent),
  }));

  const result = refineClusters({
    clusters: refineInputs,
    nodes,
    displayKeywords,
    liveByQuery,
    ruleset: CLUSTER_RULESET_V2,
  });

  // Consumed = every input cluster whose id is NOT preserved by an unchanged
  // output cluster (i.e. it was merged away or split apart).
  const preservedIds = new Set<string>();
  for (const c of result.clusters) if (c.preservedClusterId) preservedIds.add(c.preservedClusterId);
  const consumedInputIds = clusters.map((c) => c.id).filter((id) => !preservedIds.has(id));

  const newClusterRows: ClusterInsertRow[] = [];
  const newMemberRows: ClusterMemberInsertRow[] = [];
  for (const c of result.clusters) {
    if (!c.changed) continue;
    const id = newId('kcl');
    const memberNodes = c.draft.memberIds.map((mid) => byId.get(mid)!).filter((n): n is KeywordNode => !!n);
    const { score, label, components } = computeClusterConfidence(c.draft, memberNodes);

    const evidenceRefIds = Array.from(
      new Set(c.draft.memberIds.flatMap((mid) => evidenceRefMap.get(mid) ?? []))
    )
      .sort()
      .slice(0, 50);

    const scoreBreakdown = {
      rulesetVersion: CLUSTER_RULESET_V2.version,
      refine: c.liveBreakdown,
      semanticCohesion: c.draft.semanticCohesion,
      serpOverlapCohesion: c.draft.serpOverlapCohesion,
      confidenceComponents: components,
      evidenceRefIds,
    };

    newClusterRows.push({
      id,
      label: c.draft.label,
      serviceId: c.draft.serviceId,
      serviceAreaId: c.draft.serviceAreaId,
      intent: c.draft.intent,
      primaryKeywordId: c.draft.primaryKeywordId,
      semanticCohesion: c.draft.semanticCohesion,
      serpOverlapCohesion: c.draft.serpOverlapCohesion,
      confidenceScore: score,
      confidenceLabel: label,
      decisionReason: REFINE_DECISION_REASON,
      warningsJson: JSON.stringify(c.draft.warnings),
      scoreBreakdownJson: JSON.stringify(scoreBreakdown),
    });

    for (const mid of c.draft.memberIds) {
      newMemberRows.push({
        clusterId: id,
        keywordId: mid,
        membershipScore: c.draft.membershipScores[mid],
        isPrimary: mid === c.draft.primaryKeywordId,
      });
    }
  }

  await persistRefinedClusters(ctx.d1, ctx.runId, consumedInputIds, newClusterRows, newMemberRows);
  const { truncated } = await persistAdjudications(ctx.d1, ctx.runId, result.adjudications, nowIso());

  const zeroCoverage = result.stats.liveSnapshotCoverage === 0;
  const warnings: string[] = [];
  if (zeroCoverage) warnings.push('no_live_serp_evidence');
  if (unexpectedDimensions) warnings.push('unexpected_embedding_dimensions');
  if (truncated > 0) warnings.push('adjudications_truncated');

  const output: RefineClustersOutput = {
    stage: 'refine_clusters',
    clustersIn: result.stats.clustersIn,
    clustersOut: result.stats.clustersOut,
    autoMerges: result.stats.autoMerges,
    nameMerges: result.stats.nameMerges,
    autoSplits: result.stats.autoSplits,
    adjudicationsPending: result.stats.adjudicationsPending,
    adjudicationsInsufficient: result.stats.adjudicationsInsufficient,
    adjudicationsTruncated: truncated,
    liveSnapshotCoverage: result.stats.liveSnapshotCoverage,
    rulesetVersion: CLUSTER_RULESET_V2.version,
    warnings,
  };

  return { output, status: zeroCoverage ? ('partial' as const) : ('succeeded' as const) };
};
