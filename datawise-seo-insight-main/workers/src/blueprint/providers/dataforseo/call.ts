import type { StageContext } from '../../orchestration/handlers';
import type { EvidenceKind } from '../../contracts/enums';
import { newId, nowIso } from '../../db/util';
import { hashNormalizedInput } from '../../domain/hash';
import { reserveProviderBudget, reconcileProviderBudget, releaseProviderBudget } from '../../db/budget';
import { dataforseoRequest, dataforseoGet, isCacheableDfsResponse } from '../../../dataforseo/client';
import { parseDfsResponse, mapDfsFailure } from './envelope';
import type { DfsTaskMeta } from './envelope';

// The single choke point every paid DataForSEO call goes through: budget
// reservation happens BEFORE the provider call, is reconciled to the actual
// cost after, and is released on any failure. No other module may call
// dataforseoRequest/dataforseoGet directly against a run's budget.

export function dollarsToMicro(usd: number): number {
  return Math.round(usd * 1_000_000);
}

export interface DfsCallSpec {
  method: 'GET' | 'POST';
  endpoint: string; // e.g. '/dataforseo_labs/google/keyword_ideas/live'
  body?: Record<string, unknown>; // single task object; wrapper posts [body]
  ttlSeconds: number; // positive-result TTL per catalog
  emptyTtlSeconds: number; // empty-result TTL per catalog
  kind: EvidenceKind; // evidence_refs.kind
  operation: string; // 'keyword_ideas' | 'serp_task_post' | ...
  scopeId: string; // tag + budget operationKey suffix
  estimateUsdMicro: number; // 0 for documented-free GETs (no reservation)
}

export interface DfsCallResult {
  items: any[];
  results: any[];
  evidenceRefId: string | null; // null only for estimateUsdMicro===0 catalog GETs
  costUsdMicro: number;
  cacheStatus: 'hit' | 'miss';
  taskMetas: DfsTaskMeta[];
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function insertEvidenceRef(
  d1: D1Database,
  args: {
    runId: string;
    kind: EvidenceKind;
    operation: string;
    requestHash: string;
    providerTaskId: string | null;
    costUsdMicro: number;
    artifactId: string | null;
  }
): Promise<string> {
  const id = newId('evr');
  await d1
    .prepare(
      `INSERT INTO evidence_refs
        (id, run_id, provider, kind, operation, request_hash, provider_task_id, fetched_at, cost_usd_micro, artifact_id)
       VALUES (?, ?, 'dataforseo', ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      args.runId,
      args.kind,
      args.operation,
      args.requestHash,
      args.providerTaskId,
      nowIso(),
      args.costUsdMicro,
      args.artifactId
    )
    .run();
  return id;
}

export async function blueprintDfsCall(ctx: StageContext, spec: DfsCallSpec): Promise<DfsCallResult> {
  const { d1, env, runId } = ctx;
  const isFreeCall = spec.estimateUsdMicro === 0;

  const requestHash = await hashNormalizedInput([spec.method, spec.endpoint, spec.body ?? null]);
  const cacheKey = `bp:dfs:${requestHash}`;

  // 1-2: cache hit. Zero fetches, zero reservations, cost 0. Evidence is
  // still recorded for billable operations (operation suffixed ':cache') so
  // the evidence trail shows where the data came from; documented-free
  // catalog GETs (estimateUsdMicro === 0) never get an evidence row at all.
  const cached = await env.KV.get(cacheKey);
  if (cached != null) {
    const response = JSON.parse(cached);
    const parsed = parseDfsResponse(response);
    let evidenceRefId: string | null = null;
    if (!isFreeCall) {
      evidenceRefId = await insertEvidenceRef(d1, {
        runId,
        kind: spec.kind,
        operation: `${spec.operation}:cache`,
        requestHash,
        providerTaskId: parsed.tasks[0]?.taskId ?? null,
        costUsdMicro: 0,
        artifactId: null,
      });
    }
    return {
      items: parsed.items,
      results: parsed.results,
      evidenceRefId,
      costUsdMicro: 0,
      cacheStatus: 'hit',
      taskMetas: parsed.tasks,
    };
  }

  // 3: reserve before the provider call. Free catalog GETs never touch the
  // budget tables at all.
  let reservationId: string | null = null;
  if (!isFreeCall) {
    const reservation = await reserveProviderBudget(
      d1,
      runId,
      'dataforseo',
      spec.estimateUsdMicro,
      `${spec.operation}:${spec.scopeId}`
    );
    reservationId = reservation.reservationId;
  }

  // 4: the provider call. Any throw releases the reservation and surfaces a
  // sanitized BlueprintApiError (never the raw provider error, which can
  // contain account emails or internal URLs).
  let response: any;
  const startedAt = Date.now();
  try {
    if (spec.method === 'GET') {
      response = await dataforseoGet(env, spec.endpoint);
    } else {
      const tag = `run:${runId}:${spec.operation}:${spec.scopeId}`;
      response = await dataforseoRequest(env, spec.endpoint, [{ ...(spec.body ?? {}), tag }]);
    }
  } catch (err) {
    if (reservationId) await releaseProviderBudget(d1, reservationId);
    throw mapDfsFailure(err);
  }
  const latencyMs = Date.now() - startedAt;

  // 5: HTTP-200-with-all-tasks-failed is still a failure for our purposes.
  const parsed = parseDfsResponse(response);
  if (parsed.tasks.length > 0 && parsed.failedTasks.length === parsed.tasks.length) {
    if (reservationId) await releaseProviderBudget(d1, reservationId);
    throw mapDfsFailure(parsed.failedTasks[0].statusMessage);
  }

  try {
    // 6: raw artifact to R2 + artifacts row.
    const rawJson = JSON.stringify(response);
    const artifactKey = `runs/${runId}/dfs/${requestHash}.json`;
    await env.BLUEPRINT_ARTIFACTS.put(artifactKey, rawJson);

    const artifactId = newId('art');
    const project = await d1
      .prepare(`SELECT organization_id FROM projects WHERE id = ?`)
      .bind(ctx.projectId)
      .first<{ organization_id: string }>();
    const sha256 = await sha256Hex(rawJson);
    const byteSize = new TextEncoder().encode(rawJson).byteLength;
    await d1
      .prepare(
        `INSERT INTO artifacts
          (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'application/json', ?, 0, ?)`
      )
      .bind(artifactId, project?.organization_id ?? null, runId, spec.kind, artifactKey, sha256, byteSize, nowIso())
      .run();

    // 7: KV put, only when the response is cacheable (never pin a transient
    // task failure for the full TTL).
    if (isCacheableDfsResponse(response)) {
      const ttl = parsed.items.length > 0 ? spec.ttlSeconds : spec.emptyTtlSeconds;
      await env.KV.put(cacheKey, rawJson, { expirationTtl: ttl });
    }

    // 8: cost, evidence_refs, provider_usage.
    const costUsdMicro = dollarsToMicro(parsed.totalCostUsd);
    let evidenceRefId: string | null = null;
    if (!isFreeCall) {
      evidenceRefId = await insertEvidenceRef(d1, {
        runId,
        kind: spec.kind,
        operation: spec.operation,
        requestHash,
        providerTaskId: parsed.tasks[0]?.taskId ?? null,
        costUsdMicro,
        artifactId,
      });
    }

    // provider_usage.stage is not yet threaded through StageContext (Task 3
    // scope). spec.operation is the closest available identifier; see the
    // Task 5 report for the follow-up to thread the real stage name in.
    await d1
      .prepare(
        `INSERT INTO provider_usage
          (id, run_id, stage, provider, operation, endpoint_or_model, provider_task_ids_json,
           cache_status, request_count, returned_item_count, cost_usd_micro, latency_ms, created_at)
         VALUES (?, ?, ?, 'dataforseo', ?, ?, ?, 'miss', 1, ?, ?, ?, ?)`
      )
      .bind(
        newId('pu'),
        runId,
        spec.operation,
        spec.operation,
        spec.endpoint,
        JSON.stringify(parsed.tasks.map((t) => t.taskId).filter((id): id is string => id != null)),
        parsed.items.length,
        costUsdMicro,
        latencyMs,
        nowIso()
      )
      .run();

    // 9: reconcile last, only after everything else succeeded.
    if (reservationId) {
      await reconcileProviderBudget(d1, reservationId, costUsdMicro);
    }

    return {
      items: parsed.items,
      results: parsed.results,
      evidenceRefId,
      costUsdMicro,
      cacheStatus: 'miss',
      taskMetas: parsed.tasks,
    };
  } catch (err) {
    if (reservationId) await releaseProviderBudget(d1, reservationId);
    throw mapDfsFailure(err);
  }
}
