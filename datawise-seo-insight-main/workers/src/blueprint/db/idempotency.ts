import { newId, nowIso } from './util';

export type IdempotencyBegin =
  | { kind: 'new'; recordId: string }
  | { kind: 'in_progress' }
  | { kind: 'completed'; responseStatus: number; responseJson: string }
  | { kind: 'conflict' };

interface IdempotencyRecordRow {
  id: string;
  request_hash: string;
  status: 'in_progress' | 'completed' | 'failed';
  response_status: number | null;
  response_json: string | null;
}

// Both better-sqlite3 (test) and D1 (prod) surface a UNIQUE(organization_id,
// route_key, idempotency_key) violation as a thrown error from run(), not a
// typed result. INSERT-then-catch is the only portable way to detect the
// race between the fast path (fresh key) and the collision path (replay).
export async function beginIdempotentRequest(
  d1: D1Database,
  input: {
    organizationId: string;
    routeKey: string;
    idempotencyKey: string;
    requestHash: string;
    expiresAt: string;
  }
): Promise<IdempotencyBegin> {
  const recordId = newId('idem');
  try {
    await d1
      .prepare(
        `INSERT INTO idempotency_records
          (id, organization_id, route_key, idempotency_key, request_hash, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?)`
      )
      .bind(
        recordId,
        input.organizationId,
        input.routeKey,
        input.idempotencyKey,
        input.requestHash,
        nowIso(),
        input.expiresAt
      )
      .run();
    return { kind: 'new', recordId };
  } catch (err) {
    const existing = await d1
      .prepare(
        `SELECT id, request_hash, status, response_status, response_json
         FROM idempotency_records
         WHERE organization_id = ? AND route_key = ? AND idempotency_key = ?`
      )
      .bind(input.organizationId, input.routeKey, input.idempotencyKey)
      .first<IdempotencyRecordRow>();

    // Not the UNIQUE collision we expect (e.g. a genuine DB error): surface it.
    if (!existing) throw err;

    if (existing.request_hash !== input.requestHash) {
      return { kind: 'conflict' };
    }
    if (existing.status === 'in_progress') {
      return { kind: 'in_progress' };
    }
    // status is 'completed' or 'failed(non-retryable)': both replay the
    // stored response as a completed result.
    return {
      kind: 'completed',
      responseStatus: existing.response_status ?? 0,
      responseJson: existing.response_json ?? '',
    };
  }
}

export async function completeIdempotentRequest(
  d1: D1Database,
  recordId: string,
  result: {
    resourceType?: string;
    resourceId?: string;
    responseStatus: number;
    responseJson: string;
  }
): Promise<void> {
  await d1
    .prepare(
      `UPDATE idempotency_records
       SET status = 'completed', resource_type = ?, resource_id = ?, response_status = ?, response_json = ?
       WHERE id = ?`
    )
    .bind(
      result.resourceType ?? null,
      result.resourceId ?? null,
      result.responseStatus,
      result.responseJson,
      recordId
    )
    .run();
}

export async function failIdempotentRequest(
  d1: D1Database,
  recordId: string,
  retryable: boolean
): Promise<void> {
  if (retryable) {
    // Delete so the same key can be retried from scratch (treated as new).
    await d1.prepare('DELETE FROM idempotency_records WHERE id = ?').bind(recordId).run();
    return;
  }
  // Non-retryable: keep the record and stamp it failed so replays of the
  // same key + hash deterministically return the same failure response
  // instead of re-running (and re-charging) the request.
  await d1
    .prepare(
      `UPDATE idempotency_records
       SET status = 'failed', response_status = 500, response_json = ?
       WHERE id = ?`
    )
    .bind(JSON.stringify({ error: { code: 'internal_error', message: 'Request failed' } }), recordId)
    .run();
}
