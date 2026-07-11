import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
} from './idempotency';

function beginInput(overrides: Partial<{
  organizationId: string;
  routeKey: string;
  idempotencyKey: string;
  requestHash: string;
  expiresAt: string;
}> = {}) {
  return {
    organizationId: overrides.organizationId ?? 'org1',
    routeKey: overrides.routeKey ?? 'POST /projects',
    idempotencyKey: overrides.idempotencyKey ?? 'key-1',
    requestHash: overrides.requestHash ?? 'hash-a',
    expiresAt: overrides.expiresAt ?? '2026-08-01T00:00:00.000Z',
  };
}

describe('beginIdempotentRequest', () => {
  it('(a) returns new and inserts an in_progress row for a fresh key', async () => {
    const { d1 } = createTestDb();
    const result = await beginIdempotentRequest(d1, beginInput());
    expect(result.kind).toBe('new');
    if (result.kind !== 'new') throw new Error('expected new');
    expect(result.recordId).toBeTruthy();

    const row = await d1
      .prepare('SELECT * FROM idempotency_records WHERE id = ?')
      .bind(result.recordId)
      .first<{ status: string; organization_id: string; route_key: string; idempotency_key: string; request_hash: string }>();
    expect(row?.status).toBe('in_progress');
    expect(row?.organization_id).toBe('org1');
    expect(row?.route_key).toBe('POST /projects');
    expect(row?.idempotency_key).toBe('key-1');
    expect(row?.request_hash).toBe('hash-a');
  });

  it('(b) returns in_progress for the same key and same hash while still in progress', async () => {
    const { d1 } = createTestDb();
    await beginIdempotentRequest(d1, beginInput());
    const result = await beginIdempotentRequest(d1, beginInput());
    expect(result.kind).toBe('in_progress');
  });

  it('(c) returns completed with the stored response after completeIdempotentRequest', async () => {
    const { d1 } = createTestDb();
    const first = await beginIdempotentRequest(d1, beginInput());
    if (first.kind !== 'new') throw new Error('expected new');
    await completeIdempotentRequest(d1, first.recordId, {
      resourceType: 'project',
      resourceId: 'proj_1',
      responseStatus: 201,
      responseJson: '{"id":"proj_1"}',
    });

    const result = await beginIdempotentRequest(d1, beginInput());
    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') throw new Error('expected completed');
    expect(result.responseStatus).toBe(201);
    expect(result.responseJson).toBe('{"id":"proj_1"}');
  });

  it('(d) returns conflict for the same key with a different request hash', async () => {
    const { d1 } = createTestDb();
    await beginIdempotentRequest(d1, beginInput({ requestHash: 'hash-a' }));
    const result = await beginIdempotentRequest(d1, beginInput({ requestHash: 'hash-b' }));
    expect(result.kind).toBe('conflict');
  });

  describe('(e) failIdempotentRequest', () => {
    it('deletes the record when retryable, so the same key can be retried as new', async () => {
      const { d1 } = createTestDb();
      const first = await beginIdempotentRequest(d1, beginInput());
      if (first.kind !== 'new') throw new Error('expected new');
      await failIdempotentRequest(d1, first.recordId, true);

      const row = await d1
        .prepare('SELECT * FROM idempotency_records WHERE id = ?')
        .bind(first.recordId)
        .first();
      expect(row).toBeNull();

      const retry = await beginIdempotentRequest(d1, beginInput());
      expect(retry.kind).toBe('new');
    });

    it('keeps a failed record when not retryable, replaying as completed with the stored failure response', async () => {
      const { d1 } = createTestDb();
      const first = await beginIdempotentRequest(d1, beginInput());
      if (first.kind !== 'new') throw new Error('expected new');
      await failIdempotentRequest(d1, first.recordId, false);

      const row = await d1
        .prepare('SELECT * FROM idempotency_records WHERE id = ?')
        .bind(first.recordId)
        .first<{ status: string }>();
      expect(row?.status).toBe('failed');

      const replay = await beginIdempotentRequest(d1, beginInput());
      expect(replay.kind).toBe('completed');
      if (replay.kind !== 'completed') throw new Error('expected completed');
      expect(replay.responseStatus).toBe(500);
    });
  });
});
