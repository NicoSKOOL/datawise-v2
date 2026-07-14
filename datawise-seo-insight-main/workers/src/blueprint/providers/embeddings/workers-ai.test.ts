import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../test-support/d1';
import { newId, nowIso } from '../../db/util';
import type { StageContext } from '../../orchestration/handlers';
import { embedKeywordTexts } from './workers-ai';
import type { EmbeddingInput } from '../../domain/clustering/features';
import { CLUSTER_RULESET_V1 } from '../../domain/clustering/ruleset';
import type { ClusterRuleset } from '../../domain/clustering/ruleset';

async function seedProject(d1: D1Database): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects
        (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, 'org1', 'user1', 'Test Project', 'greenfield', 'US', 'en', nowIso(), nowIso())
    .run();
  return id;
}

async function seedRun(d1: D1Database, projectId: string): Promise<string> {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, projectId, 'brief1', 'estimate1', 'running', 1_000_000, 1_000_000, 'user1', nowIso())
    .run();
  return id;
}

interface FakeAiOptions {
  dimensions?: number;
  // Overrides the response entirely for full control over malformed-shape tests.
  respond?: (model: string, input: Record<string, unknown>) => unknown;
}

function fakeAi(calls: Array<{ model: string; count: number }>, options: FakeAiOptions = {}) {
  const dims = options.dimensions ?? 4;
  return {
    async run(model: string, input: Record<string, unknown>) {
      const texts = (input.text as string[]) ?? [];
      calls.push({ model, count: texts.length });
      if (options.respond) return options.respond(model, input);
      // Deterministic per-text vector: index-seeded, not random, so
      // reuse-vs-fresh comparisons in tests are exact.
      return {
        shape: [texts.length, dims],
        data: texts.map((t) => Array.from({ length: dims }, (_, i) => (t.charCodeAt(0) % 7) + i)),
      };
    },
  };
}

function fakeArtifacts() {
  const store = new Map<string, string>();
  return {
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async get(key: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      return { text: async () => v };
    },
    store,
  } as unknown as R2Bucket & { store: Map<string, string> };
}

async function buildCtx(
  d1: D1Database,
  runId: string,
  projectId: string,
  aiCalls: Array<{ model: string; count: number }>,
  aiOptions: FakeAiOptions = {},
  artifacts?: ReturnType<typeof fakeArtifacts>
): Promise<StageContext> {
  const r2 = artifacts ?? fakeArtifacts();
  const env = {
    BLUEPRINT_DB: d1,
    BLUEPRINT_QUEUE: { send: async () => undefined },
    KV: { get: async () => null, put: async () => undefined, delete: async () => undefined },
    BLUEPRINT_ARTIFACTS: r2,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
    AI: fakeAi(aiCalls, aiOptions),
  };
  return {
    env: env as any,
    d1,
    runId,
    projectId,
    briefVersionId: 'brief1',
    normalizedBrief: {} as any,
    stage: 'embed_keyword_features',
    attempt: 1,
  };
}

function makeInputs(n: number): EmbeddingInput[] {
  return Array.from({ length: n }, (_, i) => ({
    keywordId: `kw${i}`,
    normalizedKeyword: `keyword ${i}`,
    text: `keyword ${i} text`,
    contentHash: `hash${i}`,
  }));
}

// CLUSTER_RULESET_V1 is `as const`, so its embedding.batchSize/
// maxBatchesPerRun are pinned literal types (100/40). Tests need arbitrary
// small numbers to exercise batching/truncation boundaries, so this helper
// widens back to plain `number` via an explicit cast rather than fighting
// the literal types with per-call `as const` overrides.
function ruleset(overrides: { batchSize?: number; maxBatchesPerRun?: number }): ClusterRuleset {
  return {
    ...CLUSTER_RULESET_V1,
    embedding: { ...CLUSTER_RULESET_V1.embedding, ...overrides },
  } as unknown as ClusterRuleset;
}

describe('embedKeywordTexts', () => {
  it('batches inputs at the configured batchSize boundary', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const aiCalls: Array<{ model: string; count: number }> = [];
    const ctx = await buildCtx(d1, runId, projectId, aiCalls);

    const rs = ruleset({ batchSize: 3, maxBatchesPerRun: 40 });
    const outcome = await embedKeywordTexts(ctx, makeInputs(7), rs);

    expect(aiCalls).toHaveLength(3); // 3 + 3 + 1
    expect(aiCalls.map((c) => c.count)).toEqual([3, 3, 1]);
    expect(outcome.batches).toHaveLength(3);
    expect(outcome.vectorCount).toBe(7);
    expect(outcome.truncatedCount).toBe(0);
    expect(outcome.model).toBe(CLUSTER_RULESET_V1.embedding.model);
  });

  it('truncates inputs beyond maxBatchesPerRun * batchSize', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const aiCalls: Array<{ model: string; count: number }> = [];
    const ctx = await buildCtx(d1, runId, projectId, aiCalls);

    const rs = ruleset({ batchSize: 2, maxBatchesPerRun: 2 }); // caps at 4 inputs
    const outcome = await embedKeywordTexts(ctx, makeInputs(7), rs);

    expect(aiCalls).toHaveLength(2);
    expect(outcome.vectorCount).toBe(4);
    expect(outcome.truncatedCount).toBe(3);
  });

  it('writes a provider_usage row per AI call with provider workers_ai and cost 0', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const aiCalls: Array<{ model: string; count: number }> = [];
    const ctx = await buildCtx(d1, runId, projectId, aiCalls);

    const rs = ruleset({ batchSize: 3, maxBatchesPerRun: 40 });
    await embedKeywordTexts(ctx, makeInputs(4), rs);

    const rows = raw
      .prepare(`SELECT provider, operation, endpoint_or_model, cache_status, cost_usd_micro, returned_item_count FROM provider_usage WHERE run_id = ?`)
      .all(runId) as Array<{
      provider: string;
      operation: string;
      endpoint_or_model: string;
      cache_status: string;
      cost_usd_micro: number;
      returned_item_count: number;
    }>;
    expect(rows).toHaveLength(2); // batch of 3 + batch of 1
    for (const row of rows) {
      expect(row.provider).toBe('workers_ai');
      expect(row.operation).toBe('embeddings');
      expect(row.endpoint_or_model).toBe(CLUSTER_RULESET_V1.embedding.model);
      expect(row.cache_status).toBe('bypass');
      expect(row.cost_usd_micro).toBe(0);
    }
    expect(rows.map((r) => r.returned_item_count).sort()).toEqual([1, 3]);
  });

  it('writes an artifacts row and a matching R2 object per batch', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const aiCalls: Array<{ model: string; count: number }> = [];
    const artifacts = fakeArtifacts();
    const ctx = await buildCtx(d1, runId, projectId, aiCalls, {}, artifacts);

    const rs = ruleset({ batchSize: 5, maxBatchesPerRun: 40 });
    const outcome = await embedKeywordTexts(ctx, makeInputs(5), rs);

    expect(outcome.batches).toHaveLength(1);
    const { artifactId, storageKey } = outcome.batches[0];
    expect(storageKey).toBe(`runs/${runId}/embeddings/0.json`);

    const artifactRow = await d1
      .prepare(`SELECT id, run_id, kind, storage_key FROM artifacts WHERE id = ?`)
      .bind(artifactId)
      .first<{ id: string; run_id: string; kind: string; storage_key: string }>();
    expect(artifactRow).toMatchObject({ id: artifactId, run_id: runId, storage_key: storageKey });

    const stored = JSON.parse(artifacts.store.get(storageKey)!);
    expect(stored.model).toBe(CLUSTER_RULESET_V1.embedding.model);
    expect(stored.template).toBe(CLUSTER_RULESET_V1.embedding.contextTemplate);
    expect(stored.vectors).toHaveLength(5);
    void raw;
  });

  it('reuse path: a pre-seeded matching R2 batch object skips the AI call', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const aiCalls: Array<{ model: string; count: number }> = [];
    const artifacts = fakeArtifacts();
    const inputs = makeInputs(3);
    const rs = ruleset({ batchSize: 3, maxBatchesPerRun: 40 });

    // First attempt: real call, persists the batch object.
    const ctx1 = await buildCtx(d1, runId, projectId, aiCalls, {}, artifacts);
    const firstOutcome = await embedKeywordTexts(ctx1, inputs, rs);
    expect(aiCalls).toHaveLength(1);

    // Second attempt (simulating a retried stage attempt): same run, same
    // inputs, same R2 bucket contents. Must reuse instead of calling AI again.
    const ctx2 = await buildCtx(d1, runId, projectId, aiCalls, {}, artifacts);
    const secondOutcome = await embedKeywordTexts(ctx2, inputs, rs);

    expect(aiCalls).toHaveLength(1); // no new call
    expect(secondOutcome.vectorCount).toBe(3);
    expect(secondOutcome.batches[0].artifactId).toBe(firstOutcome.batches[0].artifactId);

    // No duplicate artifacts row was created for the reused batch.
    const count = await d1
      .prepare(`SELECT COUNT(*) as count FROM artifacts WHERE run_id = ? AND storage_key = ?`)
      .bind(runId, secondOutcome.batches[0].storageKey)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it('a stale R2 object under a different template is not reused (fresh AI call, overwritten)', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const aiCalls: Array<{ model: string; count: number }> = [];
    const artifacts = fakeArtifacts();
    const inputs = makeInputs(2);
    const rs = ruleset({ batchSize: 2, maxBatchesPerRun: 40 });

    await artifacts.put(
      `runs/${runId}/embeddings/0.json`,
      JSON.stringify({
        model: rs.embedding.model,
        dimensions: 4,
        template: 'kw_v_stale',
        vectors: inputs.map((i) => ({ keywordId: i.keywordId, normalizedKeyword: i.normalizedKeyword, contentHash: i.contentHash, vector: [0, 0, 0, 0] })),
      })
    );

    const ctx = await buildCtx(d1, runId, projectId, aiCalls, {}, artifacts);
    const outcome = await embedKeywordTexts(ctx, inputs, rs);

    expect(aiCalls).toHaveLength(1); // fresh call, stale object ignored
    expect(outcome.vectorCount).toBe(2);
  });

  it('throws on a mixed-dimension response across batches', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const aiCalls: Array<{ model: string; count: number }> = [];
    let callIndex = 0;
    const ctx = await buildCtx(d1, runId, projectId, aiCalls, {
      respond: (_model, input) => {
        const texts = (input.text as string[]) ?? [];
        const dims = callIndex === 0 ? 4 : 8;
        callIndex += 1;
        return { shape: [texts.length, dims], data: texts.map(() => Array.from({ length: dims }, () => 0.1)) };
      },
    });

    const rs = ruleset({ batchSize: 2, maxBatchesPerRun: 40 });
    await expect(embedKeywordTexts(ctx, makeInputs(4), rs)).rejects.toThrow(/mixed embedding dimensions/);
  });

  it('throws provider_invalid_response on a malformed AI response (wrong count)', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const aiCalls: Array<{ model: string; count: number }> = [];
    const ctx = await buildCtx(d1, runId, projectId, aiCalls, {
      respond: () => ({ shape: [1, 4], data: [[0.1, 0.2, 0.3, 0.4]] }), // only 1 vector for a batch of 2
    });

    const rs = ruleset({ batchSize: 2, maxBatchesPerRun: 40 });
    await expect(embedKeywordTexts(ctx, makeInputs(2), rs)).rejects.toThrow();
  });
});
