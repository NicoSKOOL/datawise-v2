import type { StageContext, StageHandler } from './handlers';
import type { SearchIntent } from '../contracts/enums';
import { loadKeywordEnrichmentFromArtifacts } from '../providers/dataforseo/evidence-readback';
import { planUniverseNormalization } from '../domain/clustering/universe';
import type { KeywordRowLite } from '../domain/clustering/universe';
import { CLUSTER_RULESET_V1 } from '../domain/clustering/ruleset';
import { chunk, runBatchedStatements, assertRowBudget } from '../db/batch';
import { buildEmbeddingText, embeddingContentHash } from '../domain/clustering/features';
import type { EmbeddingInput } from '../domain/clustering/features';
import { embedKeywordTexts } from '../providers/embeddings/workers-ai';

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

  const plan = planUniverseNormalization({ keywords, enrichment, brief, ruleset: CLUSTER_RULESET_V1 });

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
    rulesetVersion: CLUSTER_RULESET_V1.version,
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
// CLUSTER_RULESET_V1.embedding.maxBatchesPerRun * batchSize degrades to
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

  const { contextTemplate } = CLUSTER_RULESET_V1.embedding;
  const brief = { category: ctx.normalizedBrief.category };

  const inputs: EmbeddingInput[] = [];
  for (const row of retained) {
    const text = buildEmbeddingText(
      { displayKeyword: row.display_keyword, coreKeyword: row.core_keyword },
      brief,
      contextTemplate
    );
    const contentHash = await embeddingContentHash(CLUSTER_RULESET_V1.embedding.model, contextTemplate, text);
    inputs.push({ keywordId: row.id, normalizedKeyword: row.normalized_keyword, text, contentHash });
  }

  const result = await embedKeywordTexts(ctx, inputs, CLUSTER_RULESET_V1);

  const output: EmbedKeywordFeaturesOutput = {
    stage: 'embed_keyword_features',
    model: result.model,
    dimensions: result.dimensions,
    vectorCount: result.vectorCount,
    batchCount: result.batches.length,
    inputHash: result.inputHash,
    truncatedCount: result.truncatedCount,
    artifacts: result.batches,
    rulesetVersion: CLUSTER_RULESET_V1.version,
  };

  return { output, status: result.truncatedCount > 0 ? ('partial' as const) : ('succeeded' as const) };
};
