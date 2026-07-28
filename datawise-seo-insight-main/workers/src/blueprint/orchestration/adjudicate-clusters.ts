import type { StageContext, StageHandler } from './handlers';
import type { ChatMessage } from '../../llm/provider';
import type { NormalizedProjectBrief } from '../contracts/types';
import { PAGE_PLAN_RULESET_V1 } from '../domain/page-plan/ruleset';
import { rulesetVersionForStage } from '../domain/ruleset';
import { blueprintOpenRouterCall } from '../providers/openrouter/call';
import { resolveRunOpenRouterKey } from '../providers/openrouter/byok';
import { OPENROUTER_ADJUDICATION_CALL_USD_MICRO } from '../providers/dataforseo/costs';
import {
  applyAcceptedClusterMerges,
  applyGeoExclusions,
  type AcceptedMergeCase,
  type NormalizeKeywordUniverseOutput,
} from './clustering-handlers';
import { geoExclusionPassesRails } from '../domain/clustering/adjudication-rails';
import { loadStageOutput } from './stage-io';
import { chunk, runBatchedStatements } from '../db/batch';
import { nowIso } from '../db/util';
import { BlueprintApiError } from '../domain/api-errors';

// The LLM cluster adjudicator (page-plan v3 Phase D). Optional stage between
// refine_clusters and parse_competitor_pages. It resolves the borderline cases
// refine deferred (merge / split / intent_exception with decision pending or
// insufficient_evidence) plus the out-of-area geo candidates stage 8 flagged,
// using a bounded, cheap LLM whose every verdict is re-validated by
// deterministic hard rails before it changes anything. AI only ever chooses
// among allowed actions; the rails decide whether the choice is applied, so the
// worst case of a bad verdict is no worse than leaving the case unresolved.

const CASE_TYPES_HANDLED = ['merge', 'split', 'intent_exception'] as const;

interface AdjudicationCaseRow {
  id: string;
  case_type: string;
  cluster_ids_json: string;
  keyword_ids_json: string;
  score_context_json: string;
}

interface CaseItem {
  kind: 'case';
  id: string; // adjudication row id
  caseType: string;
  clusterIds: string[];
  keywordIds: string[];
  scoreContextJson: string;
}

interface GeoItem {
  kind: 'geo';
  id: string; // keyword id
  keyword: string;
  geoTerms: string[];
}

type AdjItem = CaseItem | GeoItem;

interface Verdict {
  verdict: string;
  reason: string;
}

// Parsed LLM response. Throws on any structural surprise so the caller's
// one-retry-then-fallback path fires. Elements are routed by which id field is
// present: `caseId` -> a merge/split/intent verdict, `keywordId` -> a geo
// verdict. Anything else (or an unparseable body) is malformed.
function parseVerdicts(text: string): { cases: Map<string, Verdict>; geo: Map<string, Verdict> } {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).verdicts)) {
    throw new Error('adjudicator response missing verdicts array');
  }
  const cases = new Map<string, Verdict>();
  const geo = new Map<string, Verdict>();
  for (const raw of (parsed as any).verdicts as unknown[]) {
    if (!raw || typeof raw !== 'object') throw new Error('adjudicator verdict is not an object');
    const v = raw as Record<string, unknown>;
    const verdict = typeof v.verdict === 'string' ? v.verdict.trim().toLowerCase() : '';
    const reason = typeof v.reason === 'string' ? v.reason.slice(0, 500) : '';
    if (!verdict) throw new Error('adjudicator verdict missing verdict field');
    if (typeof v.caseId === 'string' && v.caseId) {
      cases.set(v.caseId, { verdict, reason });
    } else if (typeof v.keywordId === 'string' && v.keywordId) {
      geo.set(v.keywordId, { verdict, reason });
    } else {
      throw new Error('adjudicator verdict missing caseId/keywordId');
    }
  }
  return { cases, geo };
}

function buildAdjudicationMessages(
  brief: NormalizedProjectBrief,
  batch: readonly AdjItem[],
  kwTextById: Map<string, string>
): ChatMessage[] {
  const services = brief.services.map((s) => s.name).join(', ') || '(none)';
  const areas = brief.serviceAreas.map((a) => (a.region ? `${a.city}, ${a.region}` : a.city)).join('; ') || '(none)';

  const system = [
    'You are a deterministic SEO site-architecture adjudicator. You resolve borderline keyword-clustering decisions for one specific local business. Judge only from the business brief and the items given. Never invent keywords, clusters, pages, or ids.',
    '',
    'BUSINESS BRIEF',
    `Name: ${brief.businessName}`,
    `Category: ${brief.category}`,
    `Services: ${services}`,
    `Service areas (the ONLY places this business serves): ${areas}`,
    '',
    'DECISIONS',
    'For each case item (has "caseId"):',
    '- verdict "accept" = the change the case proposes (merge / split / merge-across-intent) is correct for this business.',
    '- verdict "reject" = leave the clusters as they are.',
    'For each geo item (has "keywordId"): these keywords name a US place that may be OUTSIDE the service areas above.',
    '- verdict "exclude" = the keyword targets a city/state this business does NOT serve; drop it.',
    '- verdict "keep" = the token is in-area or is not actually a place (e.g. a brand word); keep it.',
    '',
    'OUTPUT',
    'Return STRICT JSON only, no prose, exactly this shape:',
    '{"verdicts":[{"caseId":"<id>","verdict":"accept|reject","reason":"<short>"}, {"keywordId":"<id>","verdict":"exclude|keep","reason":"<short>"}]}',
    'Include exactly one verdict object per item given. reason must be under 200 characters.',
  ].join('\n');

  const lines: string[] = [];
  for (const item of batch) {
    if (item.kind === 'case') {
      const phrases = item.keywordIds
        .slice(0, 10)
        .map((id) => kwTextById.get(id) ?? id)
        .join(' | ');
      lines.push(
        `CASE caseId=${item.id} type=${item.caseType} clusters=${item.clusterIds.length} keywords=[${phrases}]`
      );
    } else {
      lines.push(`GEO keywordId=${item.id} keyword="${item.keyword}" placeTokens=[${item.geoTerms.join(', ')}]`);
    }
  }
  const user = `Adjudicate the following ${batch.length} item(s):\n${lines.join('\n')}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface AdjudicateClustersOutput {
  stage: 'adjudicate_clusters';
  skipped?: boolean;
  reason?: string;
  casesConsidered: number;
  geoConsidered: number;
  llmCalls: number;
  merged: number;
  mergeRejectedByRules: number;
  geoExcluded: number;
  clustersDropped: number;
  capped: number;
  insufficient: number;
  rulesetVersion: string;
  warnings: string[];
}

export const adjudicateClustersHandler: StageHandler = async (ctx: StageContext) => {
  const { d1, runId } = ctx;
  const rulesetVersion = rulesetVersionForStage('adjudicate_clusters');
  const { model, maxCallsPerRun, casesPerCall } = PAGE_PLAN_RULESET_V1.adjudicator;

  const baseOutput: AdjudicateClustersOutput = {
    stage: 'adjudicate_clusters',
    casesConsidered: 0,
    geoConsidered: 0,
    llmCalls: 0,
    merged: 0,
    mergeRejectedByRules: 0,
    geoExcluded: 0,
    clustersDropped: 0,
    capped: 0,
    insufficient: 0,
    rulesetVersion,
    warnings: [],
  };

  // 1. Load unresolved merge/split/intent cases (variant_fold is page-plan's,
  //    out of scope here). resolved_at IS NULL keeps a retried attempt from
  //    re-calling the LLM for cases an earlier attempt already resolved.
  const placeholders = CASE_TYPES_HANDLED.map(() => '?').join(',');
  const caseRows = await d1
    .prepare(
      `SELECT id, case_type, cluster_ids_json, keyword_ids_json, score_context_json
       FROM cluster_adjudications
       WHERE run_id = ? AND case_type IN (${placeholders})
         AND decision IN ('pending','insufficient_evidence') AND resolved_at IS NULL
       ORDER BY case_type ASC, id ASC`
    )
    .bind(runId, ...CASE_TYPES_HANDLED)
    .all<AdjudicationCaseRow>();

  const caseItems: CaseItem[] = (caseRows.results ?? []).map((r) => ({
    kind: 'case',
    id: r.id,
    caseType: r.case_type,
    clusterIds: safeJsonParse<string[]>(r.cluster_ids_json, []),
    keywordIds: safeJsonParse<string[]>(r.keyword_ids_json, []),
    scoreContextJson: r.score_context_json,
  }));

  // 2. Load geo candidates from stage 8 output; keep only those still retained
  //    (a re-drain must not re-exclude an already-excluded keyword).
  const normalizeOut = await loadStageOutput<NormalizeKeywordUniverseOutput>(d1, runId, 'normalize_keyword_universe');
  const rawGeo = normalizeOut?.geoCandidates ?? [];
  const geoItems: GeoItem[] = [];
  if (rawGeo.length > 0) {
    const retainedGeo = new Set<string>();
    const geoTextById = new Map<string, string>();
    for (const idsChunk of chunk(rawGeo.map((g) => g.keywordId), 90)) {
      const ph = idsChunk.map(() => '?').join(',');
      const rows = await d1
        .prepare(
          `SELECT id, display_keyword FROM keywords
           WHERE run_id = ? AND excluded_reason IS NULL AND id IN (${ph})`
        )
        .bind(runId, ...idsChunk)
        .all<{ id: string; display_keyword: string }>();
      for (const row of rows.results ?? []) {
        retainedGeo.add(row.id);
        geoTextById.set(row.id, row.display_keyword);
      }
    }
    for (const g of rawGeo) {
      if (retainedGeo.has(g.keywordId)) {
        geoItems.push({
          kind: 'geo',
          id: g.keywordId,
          keyword: geoTextById.get(g.keywordId) ?? g.keywordId,
          geoTerms: g.matchedGeoTerms,
        });
      }
    }
  }

  baseOutput.casesConsidered = caseItems.length;
  baseOutput.geoConsidered = geoItems.length;

  const items: AdjItem[] = [...caseItems, ...geoItems];
  if (items.length === 0) {
    return { output: baseOutput, status: 'succeeded' as const };
  }

  // 3. The member's own OpenRouter key (BYOK) pays for this stage. No saved key
  //    and no injected test provider = benign skip (succeeded, not a run-
  //    degrading 'skipped', so a keyless run stays clean: name-based dedupe
  //    already keeps the plan correct without the adjudicator). Resolved once
  //    per stage attempt and threaded into every call below.
  const byok = await resolveRunOpenRouterKey(ctx.env, d1, runId);
  if (!ctx.env.BLUEPRINT_LLM && !byok) {
    return {
      output: {
        ...baseOutput,
        skipped: true,
        reason: 'no_user_openrouter_key',
        warnings: ['adjudicator_skipped_no_user_key'],
      },
      status: 'succeeded' as const,
    };
  }

  // Keyword text for the prompt (case phrases + geo keywords).
  const kwTextById = new Map<string, string>();
  for (const g of geoItems) kwTextById.set(g.id, g.keyword);
  const neededKwIds = new Set<string>();
  for (const c of caseItems) for (const kid of c.keywordIds.slice(0, 10)) neededKwIds.add(kid);
  for (const id of neededKwIds) if (kwTextById.has(id)) neededKwIds.delete(id);
  if (neededKwIds.size > 0) {
    for (const idsChunk of chunk([...neededKwIds], 90)) {
      const ph = idsChunk.map(() => '?').join(',');
      const rows = await d1
        .prepare(`SELECT id, display_keyword FROM keywords WHERE run_id = ? AND id IN (${ph})`)
        .bind(runId, ...idsChunk)
        .all<{ id: string; display_keyword: string }>();
      for (const row of rows.results ?? []) kwTextById.set(row.id, row.display_keyword);
    }
  }

  // 4. Batch + call, at most maxCallsPerRun LLM calls (retries counted).
  const batches = chunk(items, casesPerCall);
  const caseVerdicts = new Map<string, Verdict>();
  const geoVerdicts = new Map<string, Verdict>();
  const cappedIds = new Set<string>();
  const fallbackIds = new Set<string>();
  let llmCalls = 0;
  let budgetStopped = false;

  for (const batch of batches) {
    if (budgetStopped || llmCalls >= maxCallsPerRun) {
      for (const it of batch) cappedIds.add(it.id);
      continue;
    }
    const messages = buildAdjudicationMessages(ctx.normalizedBrief, batch, kwTextById);
    let ok = false;
    for (let attempt = 0; attempt < 2 && llmCalls < maxCallsPerRun && !ok; attempt++) {
      try {
        const res = await blueprintOpenRouterCall(ctx, {
          messages,
          model,
          operation: 'cluster_adjudication',
          scopeId: `b${llmCalls}`,
          estimateUsdMicro: OPENROUTER_ADJUDICATION_CALL_USD_MICRO,
          startTokens: 1500,
          ceilingTokens: 6000,
          label: 'blueprint/adjudicate-clusters',
          responseFormat: 'json',
          temperature: 0,
          ...(byok ? { apiKey: byok.apiKey } : {}),
        });
        llmCalls += 1;
        const parsed = parseVerdicts(res.text);
        for (const [k, v] of parsed.cases) caseVerdicts.set(k, v);
        for (const [k, v] of parsed.geo) geoVerdicts.set(k, v);
        ok = true;
      } catch (err) {
        if (err instanceof BlueprintApiError && err.code === 'budget_exceeded') {
          budgetStopped = true;
          break;
        }
        // malformed JSON or transient error: retry once (if a call remains).
      }
    }
    if (!ok) {
      for (const it of batch) (budgetStopped ? cappedIds : fallbackIds).add(it.id);
    }
  }

  // 5. Partition case verdicts. merge + intent_exception "accept" become merge
  //    candidates; the rails inside applyAcceptedClusterMerges decide if they
  //    actually apply.
  const acceptedMerges: AcceptedMergeCase[] = [];
  const splitAccepted = new Set<string>();
  const llmRejected = new Set<string>();
  const insufficient = new Set<string>();
  for (const c of caseItems) {
    if (cappedIds.has(c.id)) continue; // stays pending
    const v = caseVerdicts.get(c.id);
    if (!v || fallbackIds.has(c.id)) {
      insufficient.add(c.id);
      continue;
    }
    if (v.verdict === 'accept') {
      if (c.caseType === 'merge' || c.caseType === 'intent_exception') {
        acceptedMerges.push({ caseId: c.id, clusterIds: c.clusterIds });
      } else {
        splitAccepted.add(c.id); // split has no deterministic structural apply here
      }
    } else {
      llmRejected.add(c.id);
    }
  }

  const mergeOutcome = await applyAcceptedClusterMerges(ctx, acceptedMerges);

  // 6. Geo: exclude only flagged candidates the LLM said 'exclude' (rail).
  const flaggedGeoIds = new Set(geoItems.map((g) => g.id));
  const geoToExclude: string[] = [];
  for (const g of geoItems) {
    if (cappedIds.has(g.id)) continue;
    const v = geoVerdicts.get(g.id);
    if (v && v.verdict === 'exclude' && geoExclusionPassesRails(g.id, flaggedGeoIds)) {
      geoToExclude.push(g.id);
    }
  }
  const geoResult = await applyGeoExclusions(ctx, geoToExclude);

  // 7. Persist case decisions (resolved_at + resolved_by, augmented context).
  const now = nowIso();
  const updates: D1PreparedStatement[] = [];
  let merged = 0;
  let mergeRejectedByRules = 0;

  const pushUpdate = (
    caseId: string,
    scoreContextJson: string,
    decision: 'accepted' | 'rejected' | 'insufficient_evidence',
    resolvedBy: 'rules' | 'llm',
    adjudicator: Record<string, unknown>
  ) => {
    const ctxObj = safeJsonParse<Record<string, unknown>>(scoreContextJson, {});
    ctxObj.adjudicator = adjudicator;
    updates.push(
      d1
        .prepare(
          `UPDATE cluster_adjudications
           SET decision = ?, resolved_at = ?, resolved_by = ?, score_context_json = ?
           WHERE id = ? AND run_id = ?`
        )
        .bind(decision, now, resolvedBy, JSON.stringify(ctxObj), caseId, runId)
    );
  };

  for (const c of caseItems) {
    if (cappedIds.has(c.id)) continue; // leave pending
    const v = caseVerdicts.get(c.id);
    if (insufficient.has(c.id)) {
      pushUpdate(c.id, c.scoreContextJson, 'insufficient_evidence', 'llm', {
        verdict: 'insufficient',
        reason: 'malformed_or_missing_verdict',
      });
      continue;
    }
    if (llmRejected.has(c.id)) {
      pushUpdate(c.id, c.scoreContextJson, 'rejected', 'llm', { verdict: 'reject', reason: v?.reason ?? '' });
      continue;
    }
    if (splitAccepted.has(c.id)) {
      pushUpdate(c.id, c.scoreContextJson, 'accepted', 'llm', { verdict: 'accept', reason: v?.reason ?? '' });
      continue;
    }
    // merge / intent_exception accept -> outcome from the rails.
    const outcome = mergeOutcome.outcomeByCase.get(c.id);
    if (outcome === 'rejected_by_rules') {
      mergeRejectedByRules += 1;
      pushUpdate(c.id, c.scoreContextJson, 'rejected', 'rules', {
        verdict: 'accept',
        reason: v?.reason ?? '',
        railsBlocked: 'hard_constraint_violation',
      });
    } else {
      // 'applied' or 'noop' (clusters already gone) both count as accepted.
      if (outcome === 'applied') merged += 1;
      pushUpdate(c.id, c.scoreContextJson, 'accepted', 'llm', {
        verdict: 'accept',
        reason: v?.reason ?? '',
        applied: outcome === 'applied',
      });
    }
  }

  for (const stmtsChunk of chunk(updates, 50)) {
    await runBatchedStatements(d1, stmtsChunk);
  }

  const warnings: string[] = [];
  if (cappedIds.size > 0) warnings.push('adjudications_capped');
  if (geoResult.droppedClusterIds.length > 0) warnings.push('geo_clusters_dropped');

  const output: AdjudicateClustersOutput = {
    ...baseOutput,
    llmCalls,
    merged,
    mergeRejectedByRules,
    geoExcluded: geoResult.excludedKeywordIds.length,
    clustersDropped: geoResult.droppedClusterIds.length,
    capped: cappedIds.size,
    insufficient: insufficient.size,
    warnings,
  };

  return { output, status: 'succeeded' as const };
};
