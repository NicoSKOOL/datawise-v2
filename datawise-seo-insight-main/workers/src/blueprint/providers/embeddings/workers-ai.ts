import type { StageContext } from '../../orchestration/handlers';
import type { ClusterRuleset } from '../../domain/clustering/ruleset';
import type { EmbeddingInput } from '../../domain/clustering/features';
import type { KeywordVector, EmbeddingSetMeta } from '../../domain/clustering/embeddings';
import { assertEmbeddingSetCompatible, validateVectors } from '../../domain/clustering/embeddings';
import { hashNormalizedInput } from '../../domain/hash';
import { newId, nowIso } from '../../db/util';
import { chunk } from '../../db/batch';
import { BlueprintApiError } from '../../domain/api-errors';
import { safeErrorMessage } from '../dataforseo/envelope';

// Embeds retained keywords with Cloudflare Workers AI (@cf/baai/bge-m3) and
// persists the resulting vectors as R2 artifacts with full provenance. This
// is the free-call counterpart to providers/dataforseo/call.ts: same
// artifact/provenance shape, but with no budget reservation (Workers AI has
// no per-call cost in this codebase's plan -- see the provider_usage insert
// below, cost_usd_micro is always 0) and no evidence_refs row (a vector is a
// derived feature of already-collected evidence, not new evidence itself).

export interface EmbeddingBatchOutcome {
  model: string;
  dimensions: number;
  // hashNormalizedInput of the ordered [keywordId, contentHash] pairs for
  // EVERY input this call was asked to embed (before truncation), so the
  // handler's output_json carries a stable fingerprint of the full requested
  // set regardless of how many batches actually ran this attempt.
  inputHash: string;
  batches: Array<{ artifactId: string; storageKey: string; count: number }>;
  vectorCount: number;
  // Count of inputs beyond ruleset.embedding.maxBatchesPerRun * batchSize,
  // never sent to the model this run. The handler reports 'partial' status
  // whenever this is > 0.
  truncatedCount: number;
}

// The exact shape persisted at `runs/{runId}/embeddings/{batchIndex}.json`.
interface StoredEmbeddingBatch {
  model: string;
  dimensions: number;
  template: string;
  vectors: KeywordVector[];
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The real Workers AI response shape for @cf/baai/bge-m3 (and every other
// Cloudflare text-embedding model): `{ shape: [n, dims], data: number[][] }`.
// `shape` is informational (n and dims are re-derived from `data` itself by
// validateVectors below); only `data` is load-bearing here.
interface WorkersAiEmbeddingResponse {
  shape?: number[];
  data?: unknown;
}

function isWellFormedResponse(response: unknown, expectedCount: number): response is { data: number[][] } {
  const data = (response as WorkersAiEmbeddingResponse | null | undefined)?.data;
  return Array.isArray(data) && data.length === expectedCount && data.every((row) => Array.isArray(row));
}

// Sorted "keywordId:contentHash" pairs are a cheap, order-independent
// fingerprint of a batch's expected identity -- used only to decide whether
// an R2 object already sitting at this run's deterministic batch key is
// still a valid stand-in for this exact set of inputs (see tryReuseBatch).
function batchIdentityPairs(items: Array<{ keywordId: string; contentHash: string }>): string[] {
  return items.map((i) => `${i.keywordId}:${i.contentHash}`).sort();
}

function pairsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

interface ReuseResult {
  parsed: StoredEmbeddingBatch;
  rawText: string;
}

// Idempotency (Task 8 brief §Part C, "keep it simple and deterministic"):
// R2 batch keys are deterministic per run+batchIndex (stable across attempts
// as long as the retained-keyword ordering the caller sorted by does not
// change), so a retried attempt that already got past this batch on a prior
// attempt finds the exact same object here. Reuse requires the stored
// object's model/template to match this run's ruleset AND its vectors'
// (keywordId, contentHash) set to exactly match this batch's inputs -- a
// mismatch (stale object from a bumped ruleset, or a different keyword set)
// is treated as "not reusable", never silently accepted.
async function tryReuseBatch(
  artifacts: R2Bucket,
  storageKey: string,
  model: string,
  template: string,
  batchInputs: EmbeddingInput[]
): Promise<ReuseResult | null> {
  const existing = await artifacts.get(storageKey);
  if (!existing) return null;

  const rawText = await existing.text();
  let parsed: StoredEmbeddingBatch;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }

  if (parsed.model !== model || parsed.template !== template || !Array.isArray(parsed.vectors)) {
    return null;
  }
  const expected = batchIdentityPairs(batchInputs);
  const actual = batchIdentityPairs(parsed.vectors);
  if (!pairsEqual(expected, actual)) return null;

  return { parsed, rawText };
}

// Finds (or, if this is the first time this exact batch is being reused --
// e.g. the R2 object survived but its artifacts row did not -- mints) the
// artifacts row for an already-persisted batch object, so a reused batch
// still contributes a real artifactId to EmbeddingBatchOutcome.batches
// without writing a duplicate artifacts row on every subsequent retry that
// reuses the same object.
async function findOrCreateArtifactForReuse(
  d1: D1Database,
  organizationId: string,
  runId: string,
  storageKey: string,
  rawText: string
): Promise<string> {
  const existingRow = await d1
    .prepare(`SELECT id FROM artifacts WHERE run_id = ? AND storage_key = ? ORDER BY created_at ASC LIMIT 1`)
    .bind(runId, storageKey)
    .first<{ id: string }>();
  if (existingRow) return existingRow.id;

  const artifactId = newId('art');
  const sha256 = await sha256Hex(rawText);
  const byteSize = new TextEncoder().encode(rawText).byteLength;
  await d1
    .prepare(
      `INSERT INTO artifacts
        (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
       VALUES (?, ?, ?, 'keyword_embeddings', ?, ?, 'application/json', ?, 0, ?)`
    )
    .bind(artifactId, organizationId, runId, storageKey, sha256, byteSize, nowIso())
    .run();
  return artifactId;
}

// Minimal StageContext surface this provider needs -- mirrors how
// providers/dataforseo/call.ts takes the full StageContext (this could too),
// but Pick<> documents exactly which fields matter here and keeps the
// exported signature honest about its real dependencies.
export type EmbeddingStageContext = Pick<StageContext, 'env' | 'd1' | 'runId' | 'projectId' | 'stage'>;

export async function embedKeywordTexts(
  ctx: EmbeddingStageContext,
  inputs: EmbeddingInput[],
  ruleset: ClusterRuleset
): Promise<EmbeddingBatchOutcome> {
  const { env, d1, runId, projectId, stage } = ctx;
  const { model, batchSize, maxBatchesPerRun, contextTemplate } = ruleset.embedding;

  const inputHash = await hashNormalizedInput(inputs.map((i) => [i.keywordId, i.contentHash]));

  const allBatches = chunk(inputs, batchSize);
  const runnableBatches = allBatches.slice(0, maxBatchesPerRun);
  const truncatedBatches = allBatches.slice(maxBatchesPerRun);
  const truncatedCount = truncatedBatches.reduce((sum, b) => sum + b.length, 0);

  // Resolved once up front (even on a run where every batch ends up fully
  // reused and this goes unused) rather than per batch: simpler than gating
  // the query on "does at least one batch need a fresh artifacts row", and
  // it is a single extra SELECT per stage attempt either way.
  const project = await d1
    .prepare(`SELECT organization_id FROM projects WHERE id = ?`)
    .bind(projectId)
    .first<{ organization_id: string }>();
  if (!project) {
    throw new BlueprintApiError('internal_error', safeErrorMessage('internal_error'));
  }

  const batchMetas: Array<{ model: string; dimensions: number }> = [];
  const outBatches: Array<{ artifactId: string; storageKey: string; count: number }> = [];
  let referenceMeta: EmbeddingSetMeta | null = null;
  let vectorCount = 0;

  for (let batchIndex = 0; batchIndex < runnableBatches.length; batchIndex++) {
    const batchInputs = runnableBatches[batchIndex];
    const storageKey = `runs/${runId}/embeddings/${batchIndex}.json`;

    const reused = await tryReuseBatch(env.BLUEPRINT_ARTIFACTS, storageKey, model, contextTemplate, batchInputs);

    let batchMeta: { model: string; dimensions: number };
    let artifactId: string;
    let vectorsInBatch: number;

    if (reused) {
      const { dimensions } = validateVectors(reused.parsed.vectors);
      batchMeta = { model: reused.parsed.model, dimensions };
      artifactId = await findOrCreateArtifactForReuse(d1, project.organization_id, runId, storageKey, reused.rawText);
      vectorsInBatch = reused.parsed.vectors.length;
      // No AI.run call, no provider_usage row: mirrors
      // providers/dataforseo/call.ts's cache-hit path (zero fetches, zero
      // new bookkeeping writes for usage) -- reuse is a stronger guarantee
      // than a TTL'd cache hit (content-identity verified above), so it
      // gets the same "no new spend, no new usage row" treatment.
    } else {
      const startedAt = Date.now();
      const response = (await env.AI.run(model, { text: batchInputs.map((i) => i.text) })) as unknown;
      const latencyMs = Date.now() - startedAt;

      if (!isWellFormedResponse(response, batchInputs.length)) {
        throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
      }
      const rawVectors = (response as { data: number[][] }).data;

      const vectors: KeywordVector[] = batchInputs.map((input, idx) => ({
        keywordId: input.keywordId,
        normalizedKeyword: input.normalizedKeyword,
        contentHash: input.contentHash,
        vector: rawVectors[idx],
      }));
      const { dimensions } = validateVectors(vectors);
      batchMeta = { model, dimensions };

      const payload: StoredEmbeddingBatch = { model, dimensions, template: contextTemplate, vectors };
      const rawJson = JSON.stringify(payload);
      await env.BLUEPRINT_ARTIFACTS.put(storageKey, rawJson);

      artifactId = newId('art');
      const sha256 = await sha256Hex(rawJson);
      const byteSize = new TextEncoder().encode(rawJson).byteLength;
      await d1
        .prepare(
          `INSERT INTO artifacts
            (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
           VALUES (?, ?, ?, 'keyword_embeddings', ?, ?, 'application/json', ?, 0, ?)`
        )
        .bind(artifactId, project.organization_id, runId, storageKey, sha256, byteSize, nowIso())
        .run();

      // provider_usage: free-call carve-out. provider_budget_reservations has
      // a CHECK (provider IN ('dataforseo','openrouter')) (schema.sql), so
      // this deliberately never calls reserveProviderBudget/
      // reconcileProviderBudget -- Workers AI is not a budgeted provider in
      // this schema. provider_usage itself has no such CHECK constraint, so
      // recording 'workers_ai' usage here (cost 0, cache_status 'bypass' --
      // there is no caching layer in front of this call, unlike DataForSEO's
      // KV cache) is safe and gives the run a full spend/usage ledger even
      // though the cost is always zero.
      await d1
        .prepare(
          `INSERT INTO provider_usage
            (id, run_id, stage, provider, operation, endpoint_or_model, provider_task_ids_json,
             cache_status, request_count, returned_item_count, cost_usd_micro, latency_ms, created_at)
           VALUES (?, ?, ?, 'workers_ai', 'embeddings', ?, '[]', 'bypass', 1, ?, 0, ?, ?)`
        )
        .bind(newId('pu'), runId, stage, model, vectors.length, latencyMs, nowIso())
        .run();

      vectorsInBatch = vectors.length;
    }

    batchMetas.push(batchMeta);
    if (referenceMeta === null) referenceMeta = batchMeta;
    assertEmbeddingSetCompatible(referenceMeta, batchMetas);

    outBatches.push({ artifactId, storageKey, count: vectorsInBatch });
    vectorCount += vectorsInBatch;
  }

  return {
    model,
    dimensions: referenceMeta?.dimensions ?? ruleset.embedding.dimensions,
    inputHash,
    batches: outBatches,
    vectorCount,
    truncatedCount,
  };
}
