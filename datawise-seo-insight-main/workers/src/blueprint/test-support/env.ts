import { createTestDb } from './d1';
import { processResearchRun } from '../orchestration/process-run';
import type { BlueprintProviderEnv } from '../orchestration/process-run';
import type { StageHandler } from '../orchestration/handlers';
import type { BlueprintStage } from '../contracts/enums';

// Shared test env + queue-drain helpers for orchestration tests. Lives in
// test-support (a non-test module) so multiple *.test.ts files can import
// them without one test file importing another (which re-collects the
// imported file's describe blocks into the importer's run).

export function fakeEnv(): BlueprintProviderEnv & { BLUEPRINT_KV: unknown; BLUEPRINT_QUEUE: { sent: unknown[]; send: (body: unknown) => Promise<void> } } {
  const { d1 } = createTestDb();
  const sent: unknown[] = [];
  return {
    BLUEPRINT_DB: d1,
    BLUEPRINT_QUEUE: { sent, send: async (body: unknown) => void sent.push(body) },
    BLUEPRINT_KV: { put: async () => undefined },
    KV: (() => {
      const m = new Map<string, string>();
      return {
        get: async (k: string) => m.get(k) ?? null,
        put: async (k: string, v: string) => { m.set(k, v); },
        delete: async (k: string) => { m.delete(k); },
      };
    })() as unknown as KVNamespace,
    BLUEPRINT_ARTIFACTS: (() => {
      const m = new Map<string, string>();
      return {
        put: async (k: string, v: string) => { m.set(k, v); },
        get: async (k: string) => (m.has(k) ? { text: async () => m.get(k)! } : null),
      };
    })() as unknown as R2Bucket,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
  } as any;
}

// Standard drain: pops every queued message and runs it to completion. This
// is correct whenever every stage attempt either advances immediately or
// terminates the run outright -- i.e. whenever nothing lands in retry_wait,
// since a 'wait' outcome is never re-enqueued by processResearchRun itself
// (see process-run.ts's finalizeStageAttempt: the 'wait' branch updates the
// run row but does not call BLUEPRINT_QUEUE.send).
export async function drainQueue(
  env: BlueprintProviderEnv,
  sent: unknown[],
  workerId = 'w1',
  overrides?: Partial<Record<BlueprintStage, StageHandler>>,
  maxIterations = 200
): Promise<void> {
  let iterations = 0;
  while (sent.length) {
    if (iterations++ > maxIterations) {
      throw new Error(`drainQueue exceeded ${maxIterations} iterations without settling`);
    }
    const msg = sent.pop() as { runId: string };
    await processResearchRun(env, msg.runId, workerId, overrides);
  }
}
