import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { fakeLLMProvider, pseudoVector } from '../test-support/env';
import { encryptToken } from '../../lib/token-crypto';
import type { ChatMessage, UserLLMConfig } from '../../llm/provider';
import { newId, nowIso } from '../db/util';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { V1_LIMITS } from '../contracts/limits';
import type { StageContext } from './handlers';
import { adjudicateClustersHandler, type AdjudicateClustersOutput } from './adjudicate-clusters';

const SAMPLE_BRIEF_INPUT = {
  businessName: 'Aqua Plumbing',
  category: 'Plumber',
  websiteUrl: 'https://www.aquaplumbing.com',
  countryIso: 'us',
  languageCode: 'en',
  services: [{ clientId: 's1', name: 'Drain Cleaning' }],
  serviceAreas: [{ clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true }],
  excludedTopics: ['jobs'],
};

function fakeR2(): R2Bucket {
  const objects = new Map<string, string>();
  return {
    async put(key: string, value: string) {
      objects.set(key, value);
    },
    async get(key: string) {
      const body = objects.get(key);
      return body === undefined ? null : { text: async () => body };
    },
  } as unknown as R2Bucket;
}

function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(k: string) {
      return store.get(k) ?? null;
    },
    async put(k: string, v: string) {
      store.set(k, v);
    },
    async delete(k: string) {
      store.delete(k);
    },
  } as unknown as KVNamespace;
}

function providerFields(r2: R2Bucket, kv: KVNamespace) {
  return {
    KV: kv,
    BLUEPRINT_ARTIFACTS: r2,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
    AI: {
      async run(_model: string, input: Record<string, unknown>) {
        const texts = Array.isArray(input.text) ? (input.text as string[]) : [];
        return { shape: [texts.length, 32], data: texts.map(pseudoVector) };
      },
    },
  };
}

async function seedRun(d1: D1Database, openRouterBudgetMicro = 1_000_000): Promise<string> {
  const now = nowIso();
  const projectId = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, 'org1', 'u1', 'Aqua Plumbing', 'existing_site', 'US', 'en', ?, ?)`
    )
    .bind(projectId, now, now)
    .run();
  const runId = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status,
         dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, 'bv', 'est', 'running', 0, ?, 'u1', ?)`
    )
    .bind(runId, projectId, openRouterBudgetMicro, now)
    .run();
  return runId;
}

async function insertKeyword(
  d1: D1Database,
  runId: string,
  spec: { id: string; normalized: string; volume?: number | null; intent?: string | null }
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO keywords (id, run_id, display_keyword, normalized_keyword, search_volume, main_intent, metrics_missing)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    )
    .bind(spec.id, runId, spec.normalized, spec.normalized, spec.volume ?? null, spec.intent ?? null)
    .run();
}

async function seedCluster(
  d1: D1Database,
  runId: string,
  spec: { id: string; primaryKeywordId: string; memberIds: string[]; intent?: string | null }
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO keyword_clusters
        (id, run_id, label, service_id, service_area_id, intent, primary_keyword_id,
         semantic_cohesion, serp_overlap_cohesion, confidence_score, confidence_label,
         page_candidate, decision_reason, warnings_json, adjudication_json, ruleset_version, score_breakdown_json)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, 0.5, 'medium', NULL, 'ORIG', '[]', NULL, 'cluster-v3', '{}')`
    )
    .bind(spec.id, runId, spec.primaryKeywordId, spec.intent ?? 'transactional', spec.primaryKeywordId)
    .run();
  for (const kid of spec.memberIds) {
    await d1
      .prepare(`INSERT INTO cluster_keywords (cluster_id, keyword_id, membership_score, is_primary) VALUES (?, ?, 1, ?)`)
      .bind(spec.id, kid, kid === spec.primaryKeywordId ? 1 : 0)
      .run();
  }
}

async function seedAdjudication(
  d1: D1Database,
  runId: string,
  spec: { id: string; caseType: string; clusterIds: string[]; keywordIds: string[]; decision?: string }
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO cluster_adjudications
        (id, run_id, case_type, cluster_ids_json, keyword_ids_json, decision, score_context_json, ruleset_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'cluster-v3', ?)`
    )
    .bind(
      spec.id,
      runId,
      spec.caseType,
      JSON.stringify(spec.clusterIds),
      JSON.stringify(spec.keywordIds),
      spec.decision ?? 'pending',
      JSON.stringify({ reason: 'test' }),
      nowIso()
    )
    .run();
}

async function seedNormalizeGeo(
  d1: D1Database,
  runId: string,
  geoCandidates: Array<{ keywordId: string; matchedGeoTerms: string[] }>
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO research_stage_runs (id, run_id, stage_name, stage_input_hash, status, output_json, finished_at)
       VALUES (?, ?, 'normalize_keyword_universe', ?, 'succeeded', ?, ?)`
    )
    .bind(
      newId('sr'),
      runId,
      newId('h'),
      JSON.stringify({ stage: 'normalize_keyword_universe', geoCandidates }),
      nowIso()
    )
    .run();
}

async function seedEmbeddings(
  d1: D1Database,
  r2: R2Bucket,
  runId: string,
  vectors: Array<{ keywordId: string; normalizedKeyword: string; vector: number[] }>
): Promise<void> {
  const dimensions = vectors[0]?.vector.length ?? 4;
  const storageKey = `runs/${runId}/embeddings/0.json`;
  await r2.put(
    storageKey,
    JSON.stringify({
      model: 'fake-model',
      dimensions,
      template: 'kw_v1',
      vectors: vectors.map((v) => ({ ...v, contentHash: 'h' })),
    })
  );
  await d1
    .prepare(
      `INSERT INTO research_stage_runs (id, run_id, stage_name, stage_input_hash, status, output_json, finished_at)
       VALUES (?, ?, 'embed_keyword_features', ?, 'succeeded', ?, ?)`
    )
    .bind(
      newId('sr'),
      runId,
      newId('h'),
      JSON.stringify({
        stage: 'embed_keyword_features',
        model: 'fake-model',
        dimensions,
        vectorCount: vectors.length,
        batchCount: 1,
        inputHash: 'h',
        truncatedCount: 0,
        artifacts: [{ artifactId: 'art1', storageKey, count: vectors.length }],
        rulesetVersion: 'cluster-v3',
      }),
      nowIso()
    )
    .run();
}

const TEST_ENCRYPTION_KEY = 'test-encryption-key-0123456789';
const MEMBER_KEY = 'sk-or-member-key';
// seedRun writes created_by = 'u1'; that member's key is the one this stage spends.
const RUN_CREATOR_ID = 'u1';

// Stand-in for the MAIN datawise-db holding the member's encrypted BYOK config.
async function mainDbWithMemberKey(userId: string, apiKey: string): Promise<D1Database> {
  const encrypted = await encryptToken(
    JSON.stringify({ provider: 'openrouter', api_key: apiKey }),
    TEST_ENCRYPTION_KEY
  );
  const rows = new Map<string, string>([[userId, encrypted]]);
  return {
    prepare(_sql: string) {
      const make = (args: unknown[]): unknown => ({
        bind: (...a: unknown[]) => make(a),
        first: async () => {
          const found = rows.get(String(args[0]));
          return found ? { config_encrypted: found } : null;
        },
      });
      return make([]);
    },
  } as unknown as D1Database;
}

async function buildCtx(
  d1: D1Database,
  runId: string,
  opts: { llm?: unknown; hasKey?: boolean; memberKey?: string; r2?: R2Bucket; kv?: KVNamespace } = {}
): Promise<StageContext> {
  const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
  const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
  const env: any = { BLUEPRINT_DB: d1, ...providerFields(opts.r2 ?? fakeR2(), opts.kv ?? fakeKv()) };
  if (opts.llm) env.BLUEPRINT_LLM = opts.llm;
  // hasKey means "the member who created this run saved a BYOK OpenRouter key",
  // which is the only key this stage may spend: a main-DB row encrypted with
  // ENCRYPTION_KEY, exactly as routes/llm-config.ts writes it.
  if (opts.hasKey) {
    env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    env.DB = await mainDbWithMemberKey(RUN_CREATOR_ID, opts.memberKey ?? MEMBER_KEY);
  }
  return {
    env,
    d1,
    runId,
    projectId: 'proj',
    briefVersionId: 'bv',
    normalizedBrief,
    stage: 'adjudicate_clusters',
    attempt: 1,
  };
}

// Fake LLM that parses the user prompt for the item ids and replies with a
// scripted verdict per item, plus optional whole-response overrides and
// hallucinated extra verdicts.
function scriptedLLM(opts: {
  caseVerdict?: (caseId: string) => 'accept' | 'reject';
  geoVerdict?: (keywordId: string) => 'exclude' | 'keep';
  raw?: (callIndex: number) => string | undefined;
  extra?: unknown[];
} = {}) {
  return fakeLLMProvider((messages, callIndex) => {
    if (opts.raw) {
      const override = opts.raw(callIndex);
      if (override !== undefined) return { text: override };
    }
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const caseIds = [...user.matchAll(/caseId=(\S+)/g)].map((m) => m[1]);
    const kwIds = [...user.matchAll(/keywordId=(\S+)/g)].map((m) => m[1]);
    const verdicts: unknown[] = [];
    for (const id of caseIds) verdicts.push({ caseId: id, verdict: (opts.caseVerdict ?? (() => 'reject'))(id), reason: 'r' });
    for (const id of kwIds) verdicts.push({ keywordId: id, verdict: (opts.geoVerdict ?? (() => 'keep'))(id), reason: 'r' });
    if (opts.extra) verdicts.push(...opts.extra);
    return { text: JSON.stringify({ verdicts }) };
  });
}

async function decisionOf(d1: D1Database, caseId: string): Promise<{ decision: string; resolved_by: string | null; resolved_at: string | null }> {
  return (await d1
    .prepare(`SELECT decision, resolved_by, resolved_at FROM cluster_adjudications WHERE id = ?`)
    .bind(caseId)
    .first<{ decision: string; resolved_by: string | null; resolved_at: string | null }>())!;
}

describe('adjudicateClustersHandler', () => {
  it('benign skip (succeeded) with a warning when the member saved no OpenRouter key', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    await seedAdjudication(d1, runId, { id: 'case1', caseType: 'merge', clusterIds: ['c1', 'c2'], keywordIds: ['k1', 'k2'] });

    const ctx = await buildCtx(d1, runId); // no llm, no member key
    const res = await adjudicateClustersHandler(ctx);
    expect(res.status).toBe('succeeded');
    const out = res.output as AdjudicateClustersOutput;
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe('no_user_openrouter_key');
    expect(out.warnings).toContain('adjudicator_skipped_no_user_key');

    // Case untouched, no provider usage written.
    expect((await decisionOf(d1, 'case1')).decision).toBe('pending');
    const usage = await d1.prepare(`SELECT COUNT(*) AS n FROM provider_usage WHERE run_id = ?`).bind(runId).first<{ n: number }>();
    expect(usage?.n).toBe(0);
  });

  it("bills the run creator's own key: the member key reaches the provider config", async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    await seedAdjudication(d1, runId, { id: 'case1', caseType: 'merge', clusterIds: ['c1', 'c2'], keywordIds: ['k1', 'k2'] });

    // Records the config the call layer resolved, which is what decides whose
    // OpenRouter account pays.
    const seen: (UserLLMConfig | undefined)[] = [];
    const capturingLLM = {
      async chat(): Promise<ReadableStream> {
        throw new Error('not implemented');
      },
      async chatComplete(_messages: ChatMessage[], _env: unknown, config?: UserLLMConfig) {
        seen.push(config);
        return { text: '{"verdicts":[]}', usage: { input_tokens: 10, output_tokens: 20 } };
      },
    };

    const ctx = await buildCtx(d1, runId, { hasKey: true, memberKey: 'sk-or-alice', llm: capturingLLM });
    const res = await adjudicateClustersHandler(ctx);

    expect(res.status).toBe('succeeded');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.api_key).toBe('sk-or-alice');
    expect(seen[0]?.provider).toBe('openrouter');
  });

  it('succeeds trivially when there is nothing to adjudicate', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    const ctx = await buildCtx(d1, runId, { hasKey: true, llm: scriptedLLM() });
    const res = await adjudicateClustersHandler(ctx);
    expect(res.status).toBe('succeeded');
    const out = res.output as AdjudicateClustersOutput;
    expect(out.casesConsidered).toBe(0);
    expect(out.llmCalls).toBe(0);
  });

  it('applies an accepted merge to D1 cluster state and records provider_usage(openrouter)', async () => {
    const { d1 } = createTestDb();
    const r2 = fakeR2();
    const kv = fakeKv();
    const runId = await seedRun(d1);
    await insertKeyword(d1, runId, { id: 'kwA', normalized: 'drain cleaning', volume: 500, intent: 'transactional' });
    await insertKeyword(d1, runId, { id: 'kwB', normalized: 'drain cleaning near me', volume: 300, intent: 'transactional' });
    await seedEmbeddings(d1, r2, runId, [
      { keywordId: 'kwA', normalizedKeyword: 'drain cleaning', vector: [1, 0, 0, 0] },
      { keywordId: 'kwB', normalizedKeyword: 'drain cleaning near me', vector: [1, 0, 0, 0] },
    ]);
    await seedCluster(d1, runId, { id: 'cluA', primaryKeywordId: 'kwA', memberIds: ['kwA'] });
    await seedCluster(d1, runId, { id: 'cluB', primaryKeywordId: 'kwB', memberIds: ['kwB'] });
    await seedAdjudication(d1, runId, { id: 'm1', caseType: 'merge', clusterIds: ['cluA', 'cluB'], keywordIds: ['kwA', 'kwB'] });

    const llm = scriptedLLM({ caseVerdict: () => 'accept' });
    const ctx = await buildCtx(d1, runId, { hasKey: true, llm, r2, kv });
    const res = await adjudicateClustersHandler(ctx);
    expect(res.status).toBe('succeeded');
    const out = res.output as AdjudicateClustersOutput;
    expect(out.merged).toBe(1);

    // The two source clusters are gone; one merged cluster holds both keywords.
    const clusters = await d1.prepare(`SELECT COUNT(*) AS n FROM keyword_clusters WHERE run_id = ?`).bind(runId).first<{ n: number }>();
    expect(clusters?.n).toBe(1);
    const members = await d1
      .prepare(
        `SELECT ck.keyword_id AS kid FROM cluster_keywords ck JOIN keyword_clusters kc ON kc.id = ck.cluster_id
         WHERE kc.run_id = ? ORDER BY ck.keyword_id ASC`
      )
      .bind(runId)
      .all<{ kid: string }>();
    expect((members.results ?? []).map((r) => r.kid)).toEqual(['kwA', 'kwB']);

    const dec = await decisionOf(d1, 'm1');
    expect(dec.decision).toBe('accepted');
    expect(dec.resolved_by).toBe('llm');
    expect(dec.resolved_at).toBeTruthy();

    const usage = await d1
      .prepare(`SELECT provider, operation FROM provider_usage WHERE run_id = ? AND provider = 'openrouter'`)
      .bind(runId)
      .first<{ provider: string; operation: string }>();
    expect(usage?.operation).toBe('cluster_adjudication');
  });

  it('rejects a constraint-violating merge accept via the hard rails (resolved_by rules)', async () => {
    const { d1 } = createTestDb();
    const r2 = fakeR2();
    const kv = fakeKv();
    const runId = await seedRun(d1);
    // Two branded-navigational vs generic keywords: a hard block. Give kwBrand a
    // brand token from the business name ('aqua') and navigational intent.
    await insertKeyword(d1, runId, { id: 'kwBrand', normalized: 'aqua plumbing', volume: 100, intent: 'navigational' });
    await insertKeyword(d1, runId, { id: 'kwGen', normalized: 'drain cleaning', volume: 500, intent: 'commercial' });
    await seedEmbeddings(d1, r2, runId, [
      { keywordId: 'kwBrand', normalizedKeyword: 'aqua plumbing', vector: [1, 0, 0, 0] },
      { keywordId: 'kwGen', normalizedKeyword: 'drain cleaning', vector: [1, 0, 0, 0] },
    ]);
    await seedCluster(d1, runId, { id: 'cB', primaryKeywordId: 'kwBrand', memberIds: ['kwBrand'], intent: 'navigational' });
    await seedCluster(d1, runId, { id: 'cG', primaryKeywordId: 'kwGen', memberIds: ['kwGen'], intent: 'commercial' });
    await seedAdjudication(d1, runId, { id: 'm2', caseType: 'merge', clusterIds: ['cB', 'cG'], keywordIds: ['kwBrand', 'kwGen'] });

    const ctx = await buildCtx(d1, runId, { hasKey: true, llm: scriptedLLM({ caseVerdict: () => 'accept' }), r2, kv });
    const res = await adjudicateClustersHandler(ctx);
    const out = res.output as AdjudicateClustersOutput;
    expect(out.merged).toBe(0);
    expect(out.mergeRejectedByRules).toBe(1);

    // No merge happened: both source clusters still present.
    const clusters = await d1.prepare(`SELECT COUNT(*) AS n FROM keyword_clusters WHERE run_id = ?`).bind(runId).first<{ n: number }>();
    expect(clusters?.n).toBe(2);

    const dec = await decisionOf(d1, 'm2');
    expect(dec.decision).toBe('rejected');
    expect(dec.resolved_by).toBe('rules');
  });

  it('keeps a flagged geo candidate the LLM explicitly rescues with keep', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    await insertKeyword(d1, runId, { id: 'kwRound', normalized: 'plumber round rock', volume: 100, intent: 'commercial' });
    await seedCluster(d1, runId, { id: 'c1', primaryKeywordId: 'kwRound', memberIds: ['kwRound'] });
    await seedNormalizeGeo(d1, runId, [{ keywordId: 'kwRound', matchedGeoTerms: ['round rock'] }]);

    const ctx = await buildCtx(d1, runId, { hasKey: true, llm: scriptedLLM({ geoVerdict: () => 'keep' }) });
    const out = (await adjudicateClustersHandler(ctx)).output as AdjudicateClustersOutput;

    expect(out.geoExcluded).toBe(0);
    expect(out.geoExcludedWithoutReview).toBe(0);
    const excl = (await d1.prepare(`SELECT excluded_reason FROM keywords WHERE id = 'kwRound'`).first<{ excluded_reason: string | null }>())!;
    expect(excl.excluded_reason).toBeNull();
  });

  it('excludes a flagged geo candidate the LLM never reviewed (no member key at all)', async () => {
    // The defect this covers: with no usable verdict the flag used to be
    // dropped, so an Austin-only brief still got a Nashville page.
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    await insertKeyword(d1, runId, { id: 'kwNash', normalized: 'drain cleaning nashville tn', volume: 100, intent: 'commercial' });
    await seedCluster(d1, runId, { id: 'c1', primaryKeywordId: 'kwNash', memberIds: ['kwNash'] });
    await seedNormalizeGeo(d1, runId, [{ keywordId: 'kwNash', matchedGeoTerms: ['nashville'] }]);

    const ctx = await buildCtx(d1, runId); // no llm, no member key
    const res = await adjudicateClustersHandler(ctx);
    const out = res.output as AdjudicateClustersOutput;

    expect(res.status).toBe('succeeded');
    expect(out.skipped).toBe(true);
    expect(out.llmCalls).toBe(0);
    expect(out.geoExcluded).toBe(1);
    expect(out.geoExcludedWithoutReview).toBe(1);
    expect(out.warnings).toContain('geo_excluded_without_llm_review');
    const excl = (await d1.prepare(`SELECT excluded_reason FROM keywords WHERE id = 'kwNash'`).first<{ excluded_reason: string | null }>())!;
    expect(excl.excluded_reason).toBe('out_of_area');
  });

  it('interleaves geo and merge batches so a case-heavy run still reviews geo candidates', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    // One geo candidate plus far more merge cases than the 10-call budget can
    // cover: appended-last geo would never have been looked at.
    await insertKeyword(d1, runId, { id: 'kwGeo', normalized: 'plumber dallas', volume: 100, intent: 'commercial' });
    await seedCluster(d1, runId, { id: 'cGeo', primaryKeywordId: 'kwGeo', memberIds: ['kwGeo'] });
    await seedNormalizeGeo(d1, runId, [{ keywordId: 'kwGeo', matchedGeoTerms: ['dallas'] }]);
    for (let i = 0; i < 600; i++) {
      await seedAdjudication(d1, runId, {
        id: `case${i}`,
        caseType: 'merge',
        clusterIds: ['c1', 'c2'],
        keywordIds: ['k1', 'k2'],
      });
    }

    const llm = scriptedLLM({ geoVerdict: () => 'keep' });
    const ctx = await buildCtx(d1, runId, { hasKey: true, llm });
    const out = (await adjudicateClustersHandler(ctx)).output as AdjudicateClustersOutput;

    // The geo candidate got a real verdict rather than being capped: the LLM
    // rescue kept it, which is only observable if it was actually reviewed.
    expect(out.geoExcluded).toBe(0);
    expect(out.geoExcludedWithoutReview).toBe(0);
    expect(out.llmCalls).toBeGreaterThan(0);
  });

  it('excludes only flagged out-of-area geo candidates and drops an emptied cluster', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    await insertKeyword(d1, runId, { id: 'kwDallas', normalized: 'plumber dallas', volume: 100, intent: 'commercial' });
    await insertKeyword(d1, runId, { id: 'kwDallas2', normalized: 'dallas drain repair', volume: 50, intent: 'commercial' });
    await insertKeyword(d1, runId, { id: 'kwAustin', normalized: 'plumber austin', volume: 900, intent: 'commercial' });
    // Cluster 1: dallas + austin -> after exclusion, austin survives + becomes primary.
    await seedCluster(d1, runId, { id: 'mix', primaryKeywordId: 'kwDallas', memberIds: ['kwDallas', 'kwAustin'] });
    // Cluster 2: only dallas2 -> empties and drops.
    await seedCluster(d1, runId, { id: 'onlyD', primaryKeywordId: 'kwDallas2', memberIds: ['kwDallas2'] });
    await seedNormalizeGeo(d1, runId, [
      { keywordId: 'kwDallas', matchedGeoTerms: ['dallas'] },
      { keywordId: 'kwDallas2', matchedGeoTerms: ['dallas'] },
    ]);

    // LLM says exclude for the flagged ids AND (maliciously) for the in-area
    // keyword; the rail must discard the in-area one.
    const llm = scriptedLLM({
      geoVerdict: () => 'exclude',
      extra: [{ keywordId: 'kwAustin', verdict: 'exclude', reason: 'hallucinated' }],
    });
    const ctx = await buildCtx(d1, runId, { hasKey: true, llm });
    const res = await adjudicateClustersHandler(ctx);
    const out = res.output as AdjudicateClustersOutput;
    expect(out.geoExcluded).toBe(2);
    expect(out.clustersDropped).toBe(1);
    expect(out.warnings).toContain('geo_clusters_dropped');

    const excl = async (id: string) =>
      (await d1.prepare(`SELECT excluded_reason FROM keywords WHERE id = ?`).bind(id).first<{ excluded_reason: string | null }>())!
        .excluded_reason;
    expect(await excl('kwDallas')).toBe('out_of_area');
    expect(await excl('kwDallas2')).toBe('out_of_area');
    expect(await excl('kwAustin')).toBeNull(); // rail discarded the in-area exclusion

    // Emptied cluster dropped; mix cluster kept with austin re-pointed to primary.
    const remaining = await d1
      .prepare(`SELECT id, primary_keyword_id FROM keyword_clusters WHERE run_id = ? ORDER BY id`)
      .bind(runId)
      .all<{ id: string; primary_keyword_id: string }>();
    expect((remaining.results ?? []).map((r) => r.id)).toEqual(['mix']);
    expect(remaining.results![0].primary_keyword_id).toBe('kwAustin');
    const mixMembers = await d1.prepare(`SELECT keyword_id FROM cluster_keywords WHERE cluster_id = 'mix'`).all<{ keyword_id: string }>();
    expect((mixMembers.results ?? []).map((r) => r.keyword_id)).toEqual(['kwAustin']);
  });

  it('retries once on malformed JSON then marks the case insufficient_evidence', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    await seedAdjudication(d1, runId, { id: 'bad1', caseType: 'merge', clusterIds: ['c1', 'c2'], keywordIds: ['k1'] });

    const llm = scriptedLLM({ raw: () => 'this is not json at all' });
    const ctx = await buildCtx(d1, runId, { hasKey: true, llm });
    const res = await adjudicateClustersHandler(ctx);
    const out = res.output as AdjudicateClustersOutput;
    expect(out.insufficient).toBe(1);
    expect((llm as any).calls.length).toBe(2); // initial + one retry

    const dec = await decisionOf(d1, 'bad1');
    expect(dec.decision).toBe('insufficient_evidence');
    expect(dec.resolved_by).toBe('llm');
  });

  it('caps at maxCallsPerRun and leaves the tail pending with an adjudications_capped warning', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    // capacity = casesPerCall(40) * maxCallsPerRun(10) = 400; add one over.
    const total = 401;
    for (let i = 0; i < total; i++) {
      const id = `c_${String(i).padStart(4, '0')}`;
      await seedAdjudication(d1, runId, { id, caseType: 'merge', clusterIds: [`x${i}`, `y${i}`], keywordIds: [`k${i}`] });
    }
    const llm = scriptedLLM({ caseVerdict: () => 'reject' });
    const ctx = await buildCtx(d1, runId, { hasKey: true, llm });
    const res = await adjudicateClustersHandler(ctx);
    const out = res.output as AdjudicateClustersOutput;
    expect((llm as any).calls.length).toBe(10);
    expect(out.capped).toBe(1);
    expect(out.warnings).toContain('adjudications_capped');

    const pending = await d1
      .prepare(`SELECT COUNT(*) AS n FROM cluster_adjudications WHERE run_id = ? AND decision = 'pending' AND resolved_at IS NULL`)
      .bind(runId)
      .first<{ n: number }>();
    expect(pending?.n).toBe(1);
    const rejected = await d1
      .prepare(`SELECT COUNT(*) AS n FROM cluster_adjudications WHERE run_id = ? AND decision = 'rejected'`)
      .bind(runId)
      .first<{ n: number }>();
    expect(rejected?.n).toBe(400);
  });

  it('does not re-call the LLM for already-resolved cases on a re-drain', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    await seedAdjudication(d1, runId, { id: 'r1', caseType: 'merge', clusterIds: ['c1', 'c2'], keywordIds: ['k1'] });

    const llm = scriptedLLM({ caseVerdict: () => 'reject' });
    const ctx = await buildCtx(d1, runId, { hasKey: true, llm });

    await adjudicateClustersHandler(ctx);
    const callsAfterFirst = (llm as any).calls.length;
    expect(callsAfterFirst).toBe(1);
    expect((await decisionOf(d1, 'r1')).decision).toBe('rejected');

    // Re-drain: the resolved case is skipped, so no new LLM call.
    const res2 = await adjudicateClustersHandler(ctx);
    expect((llm as any).calls.length).toBe(callsAfterFirst);
    const out2 = res2.output as AdjudicateClustersOutput;
    expect(out2.casesConsidered).toBe(0);
    expect(out2.llmCalls).toBe(0);
  });
});
