import { describe, it, expect, vi } from 'vitest';
import { BlueprintApiError, NotFoundError } from '../domain/api-errors';
import { handleBlueprintQueueBatch } from './consumer';
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
});
