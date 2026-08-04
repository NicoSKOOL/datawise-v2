import { createTestDb } from './d1';
import { processResearchRun } from '../orchestration/process-run';
import type { BlueprintProviderEnv } from '../orchestration/process-run';
import type { StageHandler } from '../orchestration/handlers';
import type { BlueprintStage } from '../contracts/enums';
import type { ChatMessage, LLMProvider } from '../../llm/provider';

// Shared test env + queue-drain helpers for orchestration tests. Lives in
// test-support (a non-test module) so multiple *.test.ts files can import
// them without one test file importing another (which re-collects the
// imported file's describe blocks into the importer's run).

// Deterministic 32-bit FNV-1a hash, seeded per output dimension (the `${dim}:`
// prefix) so each of the 32 dimensions gets an independent-looking hash
// stream instead of reusing the same scalar 32 times.
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Fixed output width for the fake AI binding below. Real @cf/baai/bge-m3
// returns 1024 dims (CLUSTER_RULESET_V2.embedding.dimensions); tests do not
// need real dimensionality, only a fixed, uniform width across every fake
// vector and full determinism (same text -> same vector, every time).
export const FAKE_AI_DIMENSIONS = 32;

// A fixed-length, unit-normalized pseudo-embedding derived purely from
// `text` -- no randomness, no clock, no I/O. Same input always produces the
// same output, which is what lets workers-ai.ts's reuse path (matching a
// batch's expected content hashes against what is already stored) and
// idempotency tests reason about "the same keyword always embeds the same
// way" without a real model call.
export function pseudoVector(text: string): number[] {
  const raw: number[] = [];
  for (let dim = 0; dim < FAKE_AI_DIMENSIONS; dim++) {
    const hash = fnv1a(`${dim}:${text}`);
    raw.push((hash / 0xffffffff) * 2 - 1); // uint32 -> [-1, 1]
  }
  const magnitude = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0)) || 1;
  return raw.map((v) => v / magnitude);
}

// Fake Workers AI binding shaped like the real @cf/baai/bge-m3 response:
// `{ shape: [n, dims], data: number[][] }` (Workers AI's documented
// embedding-model output). `input.text` is always an array in this
// codebase's usage (providers/embeddings/workers-ai.ts always calls with
// `{ text: string[] }`, never a single string), so this fake does not
// bother handling the single-string-input variant real bge-m3 also accepts.
function fakeAiBinding(): BlueprintProviderEnv['AI'] {
  return {
    async run(_model: string, input: Record<string, unknown>) {
      const texts = Array.isArray(input.text) ? (input.text as string[]) : [];
      return { shape: [texts.length, FAKE_AI_DIMENSIONS], data: texts.map(pseudoVector) };
    },
  };
}

// Scripted LLMProvider seam for adjudicate_clusters tests, the LLM analogue of
// fakeAiBinding above: injected via env.BLUEPRINT_LLM so the REAL handler runs
// through blueprintOpenRouterCall without a network call. `script(messages,
// callIndex)` returns the raw completion text (usually a strict-JSON string)
// plus an optional finishReason ('length' exercises the escalation path). The
// returned provider records every chatComplete's messages on `.calls` so tests
// can assert call counts (e.g. re-drain does not re-ask, or a cap bounded the
// number of calls).
export function fakeLLMProvider(
  script: (messages: ChatMessage[], callIndex: number) => { text: string; finishReason?: string }
): LLMProvider & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    calls,
    async chat(): Promise<ReadableStream> {
      throw new Error('fakeLLMProvider.chat is not implemented (chatComplete only)');
    },
    async chatComplete(messages: ChatMessage[]) {
      const callIndex = calls.length;
      calls.push(messages);
      const out = script(messages, callIndex);
      return {
        text: out.text,
        usage: { input_tokens: 10, output_tokens: 20 },
        ...(out.finishReason ? { finishReason: out.finishReason } : {}),
      };
    },
  };
}

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
    AI: fakeAiBinding(),
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
