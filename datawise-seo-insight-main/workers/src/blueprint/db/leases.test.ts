import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from './util';
import { acquireStageLease, renewStageLease, completeStage, failStage } from './leases';

const STAGE = 'plan_research' as const;
const HASH = 'hash-abc';

async function seedProject(d1: D1Database) {
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

async function seedRun(d1: D1Database) {
  const projectId = await seedProject(d1);
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, projectId, 'brief1', 'estimate1', 'running', 'user1', nowIso())
    .run();
  return id;
}

async function getStageRow(d1: D1Database, runId: string) {
  return d1
    .prepare(
      `SELECT id, status, lease_owner, lease_epoch, attempt_count, output_json, output_hash,
              next_retry_at, safe_error_code, safe_error_message, finished_at
       FROM research_stage_runs WHERE run_id = ? AND stage_name = ? AND stage_input_hash = ?`
    )
    .bind(runId, STAGE, HASH)
    .first<{
      id: string;
      status: string;
      lease_owner: string | null;
      lease_epoch: number;
      attempt_count: number;
      output_json: string | null;
      output_hash: string | null;
      next_retry_at: string | null;
      safe_error_code: string | null;
      safe_error_message: string | null;
      finished_at: string | null;
    }>();
}

describe('acquireStageLease', () => {
  it('behavior 1: same stage input hash executed once returns reuse with stored output on a second acquire', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);

    const first = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w1',
      leaseMs: 60_000,
      required: true,
    });
    if (first.kind !== 'acquired') throw new Error('expected acquired');

    await completeStage(d1, first.lease, '{"ok":true}', 'outhash1');

    const second = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w2',
      leaseMs: 60_000,
      required: true,
    });

    expect(second).toEqual({ kind: 'reuse', outputJson: '{"ok":true}', status: 'succeeded' });
  });

  it('behavior 2: while worker A holds an unexpired lease, worker B acquire returns busy', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);

    const a = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w-A',
      leaseMs: 60_000,
      required: true,
    });
    expect(a.kind).toBe('acquired');

    const b = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w-B',
      leaseMs: 60_000,
      required: true,
    });

    expect(b).toEqual({ kind: 'busy' });
  });

  it('behavior 3: expired lease recovery - worker B acquires with a higher epoch and incremented attempt_count', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);

    const past = new Date(Date.now() - 100_000);
    const a = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w-A',
      leaseMs: 1_000, // expires ~99s in the past relative to real now
      required: true,
      now: past,
    });
    if (a.kind !== 'acquired') throw new Error('expected acquired');
    expect(a.lease.leaseEpoch).toBe(1);
    expect(a.attemptCount).toBe(1);

    const b = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w-B',
      leaseMs: 60_000,
      required: true,
    });
    if (b.kind !== 'acquired') throw new Error('expected acquired');
    expect(b.lease.leaseEpoch).toBeGreaterThan(a.lease.leaseEpoch);
    expect(b.attemptCount).toBe(2);
  });

  it('behavior 4: stale worker cannot persist - A completeStage after B took over throws stage_conflict; B succeeds', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);

    const past = new Date(Date.now() - 100_000);
    const a = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w-A',
      leaseMs: 1_000,
      required: true,
      now: past,
    });
    if (a.kind !== 'acquired') throw new Error('expected acquired');

    const b = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w-B',
      leaseMs: 60_000,
      required: true,
    });
    if (b.kind !== 'acquired') throw new Error('expected acquired');

    await expect(
      completeStage(d1, a.lease, '{"stale":true}', 'stalehash')
    ).rejects.toMatchObject({ code: 'stage_conflict' });

    const rowAfterStale = await getStageRow(d1, runId);
    expect(rowAfterStale?.status).toBe('running');
    expect(rowAfterStale?.lease_owner).toBe('w-B');
    expect(rowAfterStale?.output_json).toBeNull();

    await completeStage(d1, b.lease, '{"fresh":true}', 'freshhash');

    const rowAfterFresh = await getStageRow(d1, runId);
    expect(rowAfterFresh?.status).toBe('succeeded');
    expect(rowAfterFresh?.output_json).toBe('{"fresh":true}');
    expect(rowAfterFresh?.lease_owner).toBeNull();
  });
});

describe('renewStageLease', () => {
  it('behavior 5: increments the epoch and a subsequent complete with the OLD epoch fails', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);

    const acquired = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w1',
      leaseMs: 60_000,
      required: true,
    });
    if (acquired.kind !== 'acquired') throw new Error('expected acquired');
    const oldLease = acquired.lease;

    const renewed = await renewStageLease(d1, oldLease, 60_000);
    expect(renewed.leaseEpoch).toBeGreaterThan(oldLease.leaseEpoch);

    await expect(
      completeStage(d1, oldLease, '{"x":1}', 'hash1')
    ).rejects.toMatchObject({ code: 'stage_conflict' });

    await completeStage(d1, renewed, '{"x":2}', 'hash2');

    const row = await getStageRow(d1, runId);
    expect(row?.status).toBe('succeeded');
    expect(row?.output_json).toBe('{"x":2}');
  });
});

describe('failStage', () => {
  it('behavior 6: retry_wait sets status + next_retry_at; acquire before it returns wait, after it returns acquired', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);

    const acquired = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w1',
      leaseMs: 60_000,
      required: true,
    });
    if (acquired.kind !== 'acquired') throw new Error('expected acquired');

    const nextRetryAt = new Date(Date.now() + 60_000).toISOString();
    await failStage(
      d1,
      acquired.lease,
      { code: 'provider_timeout', message: 'timed out' },
      { kind: 'retry_wait', nextRetryAt }
    );

    const row = await getStageRow(d1, runId);
    expect(row?.status).toBe('retry_wait');
    expect(row?.next_retry_at).toBe(nextRetryAt);
    expect(row?.safe_error_code).toBe('provider_timeout');
    expect(row?.safe_error_message).toBe('timed out');

    const before = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w2',
      leaseMs: 60_000,
      required: true,
      now: new Date(Date.now() + 1_000), // still well before nextRetryAt
    });
    expect(before).toEqual({ kind: 'wait', nextRetryAt });

    const after = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w2',
      leaseMs: 60_000,
      required: true,
      now: new Date(Date.now() + 120_000), // past nextRetryAt
    });
    expect(after.kind).toBe('acquired');
  });

  it('failStage failed sets terminal status + safe_error fields + finished_at', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);

    const acquired = await acquireStageLease(d1, {
      runId,
      stage: STAGE,
      stageInputHash: HASH,
      workerId: 'w1',
      leaseMs: 60_000,
      required: true,
    });
    if (acquired.kind !== 'acquired') throw new Error('expected acquired');

    await failStage(
      d1,
      acquired.lease,
      { code: 'ai_schema_invalid', message: 'bad schema' },
      { kind: 'failed' }
    );

    const row = await getStageRow(d1, runId);
    expect(row?.status).toBe('failed');
    expect(row?.safe_error_code).toBe('ai_schema_invalid');
    expect(row?.safe_error_message).toBe('bad schema');
    expect(row?.finished_at).toBeTruthy();
  });
});
