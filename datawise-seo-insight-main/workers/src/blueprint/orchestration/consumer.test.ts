import { describe, it, expect, vi } from 'vitest';
import { BlueprintApiError, NotFoundError } from '../domain/api-errors';
import { handleBlueprintQueueBatch, computeWakeupDelaySeconds } from './consumer';
import type { ProcessRunResult } from './process-run';

// Fake Cloudflare Queues message: only the surface handleBlueprintQueueBatch
// actually touches (body, ack, retry) needs to be real.
function makeMessage(body: unknown) {
  return {
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function makeBatch(messages: ReturnType<typeof makeMessage>[]) {
  return { queue: 'blueprint-research', messages } as unknown as MessageBatch<unknown>;
}

function makeEnv() {
  const sent: Array<{ body: unknown; options?: { delaySeconds?: number } }> = [];
  return {
    sent,
    env: {
      BLUEPRINT_QUEUE: {
        send: vi.fn(async (body: unknown, options?: { delaySeconds?: number }) => {
          sent.push({ body, options });
        }),
      },
    } as never,
  };
}

const FAKE_RESULT: ProcessRunResult = { advanced: true, runStatus: 'running' };
const FAKE_ENV = {} as never;

describe('handleBlueprintQueueBatch', () => {
  it('calls processResearchRun for a valid message and acks it', async () => {
    const process = vi.fn().mockResolvedValue(FAKE_RESULT);
    const message = makeMessage({ runId: 'run_1' });
    const batch = makeBatch([message]);

    await handleBlueprintQueueBatch(batch, FAKE_ENV, { process });

    expect(process).toHaveBeenCalledTimes(1);
    const [envArg, runIdArg, workerIdArg] = process.mock.calls[0];
    expect(envArg).toBe(FAKE_ENV);
    expect(runIdArg).toBe('run_1');
    expect(typeof workerIdArg).toBe('string');
    expect(workerIdArg.length).toBeGreaterThan(0);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('acks an invalid message body without calling processResearchRun', async () => {
    const process = vi.fn().mockResolvedValue(FAKE_RESULT);
    const message = makeMessage({ nope: true });
    const batch = makeBatch([message]);

    await handleBlueprintQueueBatch(batch, FAKE_ENV, { process });

    expect(process).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('acks a non-JSON-object message body without calling processResearchRun', async () => {
    const process = vi.fn().mockResolvedValue(FAKE_RESULT);
    const message = makeMessage('not-an-object');
    const batch = makeBatch([message]);

    await handleBlueprintQueueBatch(batch, FAKE_ENV, { process });

    expect(process).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('retries (does not ack) when processResearchRun throws a generic error', async () => {
    const process = vi.fn().mockRejectedValue(new Error('D1 is unavailable'));
    const message = makeMessage({ runId: 'run_2' });
    const batch = makeBatch([message]);

    await handleBlueprintQueueBatch(batch, FAKE_ENV, { process });

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
  });

  it('acks (does not retry) when processResearchRun throws BlueprintApiError stage_conflict', async () => {
    const process = vi.fn().mockRejectedValue(new BlueprintApiError('stage_conflict', 'owned by another worker'));
    const message = makeMessage({ runId: 'run_3' });
    const batch = makeBatch([message]);

    await handleBlueprintQueueBatch(batch, FAKE_ENV, { process });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('acks (does not retry) when processResearchRun throws NotFoundError', async () => {
    const process = vi.fn().mockRejectedValue(new NotFoundError('Research run not found: run_4'));
    const message = makeMessage({ runId: 'run_4' });
    const batch = makeBatch([message]);

    await handleBlueprintQueueBatch(batch, FAKE_ENV, { process });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('gives each message in a batch its own workerId', async () => {
    const process = vi.fn().mockResolvedValue(FAKE_RESULT);
    const messages = [makeMessage({ runId: 'run_a' }), makeMessage({ runId: 'run_b' })];
    const batch = makeBatch(messages);

    await handleBlueprintQueueBatch(batch, FAKE_ENV, { process });

    expect(process).toHaveBeenCalledTimes(2);
    const workerIds = process.mock.calls.map((call) => call[2]);
    expect(workerIds[0]).not.toBe(workerIds[1]);
    for (const message of messages) {
      expect(message.ack).toHaveBeenCalledTimes(1);
    }
  });

  it('non-terminal + waitUntil: acks and schedules exactly one delayed wake-up within [5,300]s', async () => {
    const waitUntil = new Date(Date.now() + 45_000).toISOString();
    const result: ProcessRunResult = { advanced: true, runStatus: 'running', waitUntil };
    const process = vi.fn().mockResolvedValue(result);
    const message = makeMessage({ runId: 'run_wait' });
    const batch = makeBatch([message]);
    const { env, sent } = makeEnv();

    await handleBlueprintQueueBatch(batch, env, { process });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ runId: 'run_wait' });
    expect(sent[0].options?.delaySeconds).toBeGreaterThanOrEqual(5);
    expect(sent[0].options?.delaySeconds).toBeLessThanOrEqual(300);
  });

  it('non-terminal + advanced:false without waitUntil: acks and schedules a delayed wake-up with the default 60s', async () => {
    const result: ProcessRunResult = { advanced: false, runStatus: 'running' };
    const process = vi.fn().mockResolvedValue(result);
    const message = makeMessage({ runId: 'run_busy' });
    const batch = makeBatch([message]);
    const { env, sent } = makeEnv();

    await handleBlueprintQueueBatch(batch, env, { process });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ runId: 'run_busy' });
    expect(sent[0].options?.delaySeconds).toBe(60);
  });

  it('terminal run status: acks, no delayed send', async () => {
    for (const runStatus of ['succeeded', 'failed', 'cancelled', 'partial'] as const) {
      const result: ProcessRunResult = { advanced: false, runStatus };
      const process = vi.fn().mockResolvedValue(result);
      const message = makeMessage({ runId: `run_${runStatus}` });
      const batch = makeBatch([message]);
      const { env, sent } = makeEnv();

      await handleBlueprintQueueBatch(batch, env, { process });

      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(message.retry).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    }
  });

  it('advanced, non-terminal, no waitUntil: acks only (processor already enqueued the next stage)', async () => {
    const result: ProcessRunResult = { advanced: true, runStatus: 'running' };
    const process = vi.fn().mockResolvedValue(result);
    const message = makeMessage({ runId: 'run_advanced' });
    const batch = makeBatch([message]);
    const { env, sent } = makeEnv();

    await handleBlueprintQueueBatch(batch, env, { process });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});

describe('computeWakeupDelaySeconds', () => {
  it('clamps a near-future waitUntil to the actual remaining seconds', () => {
    const waitUntil = new Date(Date.now() + 45_000).toISOString();
    const delay = computeWakeupDelaySeconds(waitUntil);
    expect(delay).toBeGreaterThanOrEqual(40);
    expect(delay).toBeLessThanOrEqual(50);
  });

  it('clamps a far-future waitUntil to the 300s ceiling', () => {
    const waitUntil = new Date(Date.now() + 3_600_000).toISOString();
    expect(computeWakeupDelaySeconds(waitUntil)).toBe(300);
  });

  it('clamps a past waitUntil to the 5s floor', () => {
    const waitUntil = new Date(Date.now() - 60_000).toISOString();
    expect(computeWakeupDelaySeconds(waitUntil)).toBe(5);
  });

  it('defaults to 60s when waitUntil is undefined', () => {
    expect(computeWakeupDelaySeconds(undefined)).toBe(60);
  });

  it('defaults to 60s when waitUntil is unparsable', () => {
    expect(computeWakeupDelaySeconds('not-a-date')).toBe(60);
  });
});
