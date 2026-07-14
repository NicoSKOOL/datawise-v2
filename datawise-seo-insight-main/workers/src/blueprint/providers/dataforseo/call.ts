import type { StageContext } from '../../orchestration/handlers';
import type { EvidenceKind } from '../../contracts/enums';
import { BlueprintApiError } from '../../domain/api-errors';
import { newId, nowIso } from '../../db/util';
import { hashNormalizedInput } from '../../domain/hash';
import { reserveProviderBudget, reconcileProviderBudget, releaseProviderBudget } from '../../db/budget';
import { dataforseoRequest, dataforseoGet, isCacheableDfsResponse } from '../../../dataforseo/client';
import { parseDfsResponse, mapDfsFailure, safeErrorMessage } from './envelope';
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
  // Pre-built array of up to 100 task objects, each already carrying its own
  // `tag` (Task 13: SERP task_post batches one task object per query with a
  // per-query tag, unlike every other adapter's single-task-object-per-call
  // shape). Mutually exclusive with `body`; when set, the wrapper posts this
  // array verbatim instead of wrapping `body` in a single-element array and
  // does NOT append its own `run:{runId}:{operation}:{scopeId}` tag (the
  // caller already put a per-task tag on every element).
  bodies?: Record<string, unknown>[];
  // Bypasses the KV cache entirely (no read, no write) and lets an
  // all-tasks-non-2xxxx response pass back to the caller instead of being
  // collapsed into a thrown BlueprintApiError. Task 13's SERP task_get poll
  // is the only caller: its single-task response can legitimately be
  // "not ready yet" (a DataForSEO status code outside the success band,
  // e.g. "Task In Queue.") rather than a real failure, and only the caller
  // (which knows the not-ready vocabulary) can tell the two apart -- the
  // wrapper's normal all-failed-throws behavior would treat every
  // not-ready poll as a hard error. A stale KV read is also unsafe here: the
  // task's readiness can change between polls of the exact same endpoint
  // URL, so the response must always come from a live fetch.
  skipCache?: boolean;
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

// Invariant: the primary provider/processing error always wins. A failed
// release here is a secondary error against a reservation row that is
// already in a safe state (either still 'reserved', leaving the run's
// reserved total conservatively over-stated, or already terminal via a
// competing claim); surfacing it would mask the error the caller actually
// needs to see and retry on.
async function releaseQuietly(d1: D1Database, reservationId: string): Promise<void> {
  try {
    await releaseProviderBudget(d1, reservationId);
  } catch (releaseErr) {
    console.error(`blueprintDfsCall: release failed for reservation ${reservationId}:`, releaseErr);
  }
}

// Mirrors releaseQuietly above, but for the opposite failure window: once
// the paid fetch has returned a parsed, non-failed response, its cost is
// already genuinely charged by the provider (parsed.totalCostUsd) regardless
// of what a downstream bookkeeping write (artifact/evidence_refs/
// provider_usage/KV, steps 6-8 below) does next. Releasing the reservation
// at that point -- the prior behavior -- would make the run's ledger
// silently forget real spend just because, say, the evidence_refs INSERT
// failed; reconciling keeps it recorded even when the bookkeeping itself
// fails. Same invariant as releaseQuietly: the primary bookkeeping error
// always wins, so a secondary reconcile failure (e.g. this reservation was
// already reconciled/released by a prior attempt) is logged, never
// surfaced.
async function reconcileQuietly(d1: D1Database, reservationId: string, actualUsdMicro: number): Promise<void> {
  try {
    await reconcileProviderBudget(d1, reservationId, actualUsdMicro);
  } catch (reconcileErr) {
    console.error(`blueprintDfsCall: reconcile failed for reservation ${reservationId}:`, reconcileErr);
  }
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

  const requestHash = await hashNormalizedInput([spec.method, spec.endpoint, spec.body ?? spec.bodies ?? null]);
  const cacheKey = `bp:dfs:${requestHash}`;

  // 1-2: cache hit. Zero fetches, zero reservations, cost 0. Evidence is
  // still recorded for billable operations (operation suffixed ':cache') so
  // the evidence trail shows where the data came from; documented-free
  // catalog GETs (estimateUsdMicro === 0) never get an evidence row at all.
  // skipCache short-circuits straight past this: no cache read at all.
  const cached = spec.skipCache ? null : await env.KV.get(cacheKey);
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
  // budget tables at all. The operation key is attempt-scoped: a retry after
  // a released reservation reserves fresh instead of colliding with the
  // prior attempt's terminal (released/reconciled) reservation row, while
  // duplicate work within a single attempt still reuses the same row.
  let reservationId: string | null = null;
  if (!isFreeCall) {
    const reservation = await reserveProviderBudget(
      d1,
      runId,
      'dataforseo',
      spec.estimateUsdMicro,
      `${spec.operation}:${spec.scopeId}:a${ctx.attempt}`
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
    } else if (spec.bodies) {
      // Batched task_post: each element already carries its own tag, so post
      // the array verbatim instead of wrapping+tagging a single body.
      response = await dataforseoRequest(env, spec.endpoint, spec.bodies);
    } else {
      const tag = `run:${runId}:${spec.operation}:${spec.scopeId}`;
      response = await dataforseoRequest(env, spec.endpoint, [{ ...(spec.body ?? {}), tag }]);
    }
  } catch (err) {
    if (reservationId) await releaseQuietly(d1, reservationId);
    throw mapDfsFailure(err);
  }
  const latencyMs = Date.now() - startedAt;

  // 5: HTTP-200-with-all-tasks-failed is still a failure for our purposes,
  // and a paid call that comes back with NO tasks at all is an invalid
  // response (the provider was asked to do billable work and reported none).
  // Free catalog GETs may legitimately return task-less bodies. skipCache
  // callers (task_get polling) opt out of this: their single task's
  // "failure" may just be "not ready yet", which only the caller can tell
  // apart from a real error (see DfsCallSpec.skipCache doc comment) -- they
  // get the raw taskMetas back instead of a thrown, sanitized error.
  const parsed = parseDfsResponse(response);
  if (!spec.skipCache && parsed.tasks.length > 0 && parsed.failedTasks.length === parsed.tasks.length) {
    if (reservationId) await releaseQuietly(d1, reservationId);
    throw mapDfsFailure(parsed.failedTasks[0].statusMessage);
  }
  if (!isFreeCall && parsed.tasks.length === 0) {
    if (reservationId) await releaseQuietly(d1, reservationId);
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }

  // From this point on, the provider has genuinely returned a parseable,
  // non-failed response for this call: its real cost is known and already
  // charged regardless of what the bookkeeping writes below do next (see
  // reconcileQuietly's doc comment above). Computed once here, ahead of the
  // try block, so both the success path (step 8) and its catch below use the
  // exact same value -- a release past this point would be the bug this
  // reconcile-instead-of-release fix exists to close.
  const costUsdMicro = dollarsToMicro(parsed.totalCostUsd);

  try {
    // 6: raw artifact to R2 + artifacts row -- billable calls only. Free
    // calls (estimateUsdMicro === 0: documented-free catalog GETs and
    // skipCache task_get polls) write NO artifact, NO artifacts row, and NO
    // provider_usage row (step 8): a SERP polling loop alone would
    // otherwise mint up to maxAttempts x batch-size junk objects per run
    // for responses that are mostly "not ready yet", and catalog artifacts
    // have no evidence_refs row pointing at them either way.
    const rawJson = JSON.stringify(response);
    let artifactId: string | null = null;
    if (!isFreeCall) {
      const artifactKey = `runs/${runId}/dfs/${requestHash}.json`;
      await env.BLUEPRINT_ARTIFACTS.put(artifactKey, rawJson);

      artifactId = newId('art');
      const project = await d1
        .prepare(`SELECT organization_id FROM projects WHERE id = ?`)
        .bind(ctx.projectId)
        .first<{ organization_id: string }>();
      if (!project) {
        // artifacts.organization_id is NOT NULL; fail with a sanitized error
        // instead of letting the raw D1 constraint error surface.
        throw new BlueprintApiError('internal_error', safeErrorMessage('internal_error'));
      }
      const sha256 = await sha256Hex(rawJson);
      const byteSize = new TextEncoder().encode(rawJson).byteLength;
      await d1
        .prepare(
          `INSERT INTO artifacts
            (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'application/json', ?, 0, ?)`
        )
        .bind(artifactId, project.organization_id, runId, spec.kind, artifactKey, sha256, byteSize, nowIso())
        .run();
    }

    // 7: KV put, only when the response is cacheable (never pin a transient
    // task failure for the full TTL). "Non-empty" must consider BOTH items
    // and results: catalog/reference endpoints (locations, languages) return
    // flat records in tasks[].result with no per-record items wrapper, so
    // parsed.items is empty for a perfectly full catalog response and only
    // parsed.results reflects the payload.
    if (!spec.skipCache && isCacheableDfsResponse(response)) {
      const hasData = parsed.items.length > 0 || parsed.results.length > 0;
      const ttl = hasData ? spec.ttlSeconds : spec.emptyTtlSeconds;
      await env.KV.put(cacheKey, rawJson, { expirationTtl: ttl });
    }

    // 8: cost, evidence_refs, provider_usage -- billable calls only (see
    // the step-6 comment for why free calls skip all bookkeeping writes).
    // costUsdMicro was already computed above the try block.
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
          ctx.stage,
          spec.operation,
          spec.endpoint,
          JSON.stringify(parsed.tasks.map((t) => t.taskId).filter((id): id is string => id != null)),
          parsed.items.length,
          costUsdMicro,
          latencyMs,
          nowIso()
        )
        .run();
    }

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
    // A failure here is a bookkeeping failure AFTER a real, already-charged
    // provider spend (costUsdMicro, computed above) -- reconcile that known
    // cost instead of releasing it, so the run's ledger never silently
    // forgets real spend just because an artifact/evidence/provider_usage/KV
    // write happened to fail. Releasing here (the prior behavior) left the
    // reservation's estimate wiped from `reserved` with nothing moved to
    // `actual`, undercounting the run's real DataForSEO spend.
    if (reservationId) await reconcileQuietly(d1, reservationId, costUsdMicro);
    // Preserve an already-sanitized BlueprintApiError (e.g. the missing
    // project row internal_error above); wrap anything else.
    throw err instanceof BlueprintApiError ? err : mapDfsFailure(err);
  }
}
