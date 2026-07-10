import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { handleBlueprintRequest } from './router';
import { newId, nowIso } from '../db/util';
import type { AuthUser } from '../../auth/google';
import type { ApiSuccess, ApiFailure, ProjectView, ResearchEstimate, ResearchRunView } from '../contracts/api';

const adminUser = {
  id: 'u1',
  google_id: 'g1',
  email: 'nico@airankingskool.com',
  name: 'Nico',
  avatar_url: '',
  subscription_tier: 'pro',
  is_community_member: false,
  is_admin: true,
  credits_used: 0,
} as AuthUser;

function fakeEnv() {
  const { d1 } = createTestDb();
  const sent: unknown[] = [];
  return {
    BLUEPRINT_DB: d1,
    BLUEPRINT_QUEUE: { sent, send: async (body: unknown) => void sent.push(body) },
    BLUEPRINT_KV: { put: async () => undefined },
  } as any;
}

function makeRequest(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Request {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  return new Request(`https://api.test${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function call(
  env: any,
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<Response> {
  const method = opts.method ?? 'GET';
  return handleBlueprintRequest(makeRequest(path, opts), env, adminUser, path, method);
}

const validBrief = {
  businessName: 'Aqua Plumbing',
  category: 'Plumber',
  websiteUrl: 'https://www.aquaplumbing.com',
  countryIso: 'us',
  languageCode: 'EN',
  services: [{ clientId: 's1', name: 'Emergency Plumbing' }],
  serviceAreas: [{ clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true }],
};

// Full happy-path setup: create a project, an estimate, and a queued run,
// exactly the way the real routes would (Task 10 routes never execute
// stages themselves, so the run stays 'queued' with zero stage rows).
async function seedQueuedRun(env: any): Promise<{ projectId: string; runId: string }> {
  const projectRes = await call(env, '/api/blueprint/v1/projects', {
    method: 'POST',
    body: validBrief,
    headers: { 'Idempotency-Key': newId('idem') },
  });
  const project = ((await projectRes.json()) as ApiSuccess<ProjectView>).data;

  const estimateRes = await call(env, `/api/blueprint/v1/projects/${project.id}/research-estimates`, {
    method: 'POST',
    body: {},
  });
  const estimate = ((await estimateRes.json()) as ApiSuccess<ResearchEstimate>).data;

  const runRes = await call(env, `/api/blueprint/v1/projects/${project.id}/research-runs`, {
    method: 'POST',
    body: {
      estimateId: estimate.estimateId,
      acceptedDataForSeoCeilingUsd: '5.00',
      acceptedOpenRouterCeilingUsd: '2.00',
    },
    headers: { 'Idempotency-Key': newId('idem') },
  });
  const run = ((await runRes.json()) as ApiSuccess<ResearchRunView>).data;
  return { projectId: project.id, runId: run.id };
}

describe('GET /api/blueprint/v1/research-runs/:id', () => {
  it('shows all 19 stages, missing ones filled in as pending', async () => {
    const env = fakeEnv();
    const { runId } = await seedQueuedRun(env);
    const res = await call(env, `/api/blueprint/v1/research-runs/${runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiSuccess<ResearchRunView>;
    expect(body.data.stages).toHaveLength(19);
    for (const stage of body.data.stages) {
      expect(stage.status).toBe('pending');
      expect(stage.attemptCount).toBe(0);
      expect(stage.actualCostUsd).toBe('0.00');
      expect(stage.startedAt).toBeNull();
    }
    expect(body.data.status).toBe('queued');
    expect(body.data.partialReasons).toEqual([]);
    expect(body.data.usage.totalCostUsd).toBe('0.00');
  });

  it('merges real stage rows over the pending fill-in and keeps costs in USD', async () => {
    const env = fakeEnv();
    const { runId } = await seedQueuedRun(env);
    await env.BLUEPRINT_DB.prepare(
      `INSERT INTO research_stage_runs (id, run_id, stage_name, stage_input_hash, status, required, attempt_count, cost_usd_micro)
       VALUES (?, ?, 'validate_intake', 'h1', 'succeeded', 1, 1, 1500000)`
    )
      .bind(newId('stagerun'), runId)
      .run();

    const res = await call(env, `/api/blueprint/v1/research-runs/${runId}`);
    const body = (await res.json()) as ApiSuccess<ResearchRunView>;
    const validateIntake = body.data.stages.find((s) => s.stage === 'validate_intake')!;
    expect(validateIntake.status).toBe('succeeded');
    expect(validateIntake.attemptCount).toBe(1);
    expect(validateIntake.actualCostUsd).toBe('1.50');
  });

  it('returns the invisible 404 body for a run belonging to another organization', async () => {
    const env = fakeEnv();
    const { runId } = await seedQueuedRun(env);
    const otherUser = { ...adminUser, id: 'u2' } as AuthUser;
    const res = await handleBlueprintRequest(
      makeRequest(`/api/blueprint/v1/research-runs/${runId}`),
      env,
      otherUser,
      `/api/blueprint/v1/research-runs/${runId}`,
      'GET'
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
  });
});

describe('POST /api/blueprint/v1/research-runs/:id/cancel', () => {
  it('sets cancel_requested from queued and returns 202 with a fresh view', async () => {
    const env = fakeEnv();
    const { runId } = await seedQueuedRun(env);
    const res = await call(env, `/api/blueprint/v1/research-runs/${runId}/cancel`, { method: 'POST' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as ApiSuccess<ResearchRunView>;
    expect(body.data.status).toBe('cancel_requested');

    const row = (await env.BLUEPRINT_DB.prepare('SELECT status FROM research_runs WHERE id = ?').bind(runId).first()) as {
      status: string;
    } | null;
    expect(row?.status).toBe('cancel_requested');

    // seedQueuedRun's run creation already enqueued one { runId } message;
    // cancel prompts the cancel_requested -> cancelled conversion by
    // enqueueing a second one, rather than relying solely on whatever
    // message may already be in flight.
    expect(env.BLUEPRINT_QUEUE.sent).toEqual([{ runId }, { runId }]);
  });

  it('returns 409 run_cancelled for an already-terminal (succeeded) run', async () => {
    const env = fakeEnv();
    const { runId } = await seedQueuedRun(env);
    await env.BLUEPRINT_DB.prepare("UPDATE research_runs SET status = 'succeeded' WHERE id = ?").bind(runId).run();

    const res = await call(env, `/api/blueprint/v1/research-runs/${runId}/cancel`, { method: 'POST' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ApiFailure;
    expect(body.error.code).toBe('run_cancelled');
  });

  it('returns 409 stage_conflict when a cancel is already in progress', async () => {
    const env = fakeEnv();
    const { runId } = await seedQueuedRun(env);
    await env.BLUEPRINT_DB.prepare("UPDATE research_runs SET status = 'cancel_requested' WHERE id = ?").bind(runId).run();

    const res = await call(env, `/api/blueprint/v1/research-runs/${runId}/cancel`, { method: 'POST' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ApiFailure;
    expect(body.error.code).toBe('stage_conflict');
  });
});

describe('POST /api/blueprint/v1/research-runs/:id/retry', () => {
  it('resets only failed/cancelled/retry_wait stage rows to pending and leaves succeeded rows untouched', async () => {
    const env = fakeEnv();
    const { runId } = await seedQueuedRun(env);
    await env.BLUEPRINT_DB.prepare("UPDATE research_runs SET status = 'failed', finished_at = ? WHERE id = ?")
      .bind(nowIso(), runId)
      .run();

    await env.BLUEPRINT_DB.prepare(
      `INSERT INTO research_stage_runs (id, run_id, stage_name, stage_input_hash, status, required, attempt_count, cost_usd_micro, finished_at)
       VALUES (?, ?, 'validate_intake', 'h1', 'succeeded', 1, 1, 500000, ?)`
    )
      .bind(newId('stagerun'), runId, nowIso())
      .run();
    await env.BLUEPRINT_DB.prepare(
      `INSERT INTO research_stage_runs
        (id, run_id, stage_name, stage_input_hash, status, required, attempt_count, lease_owner, lease_expires_at, safe_error_code, safe_error_message, finished_at)
       VALUES (?, ?, 'resolve_market', 'h2', 'failed', 1, 3, 'worker-x', ?, 'internal_error', 'boom', ?)`
    )
      .bind(newId('stagerun'), runId, nowIso(), nowIso())
      .run();

    const res = await call(env, `/api/blueprint/v1/research-runs/${runId}/retry`, {
      method: 'POST',
      body: {},
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as ApiSuccess<ResearchRunView>;
    expect(body.data.status).toBe('queued');

    const validateIntake = body.data.stages.find((s) => s.stage === 'validate_intake')!;
    expect(validateIntake.status).toBe('succeeded');
    expect(validateIntake.attemptCount).toBe(1);
    expect(validateIntake.actualCostUsd).toBe('0.50');

    const resolveMarket = body.data.stages.find((s) => s.stage === 'resolve_market')!;
    expect(resolveMarket.status).toBe('pending');
    expect(resolveMarket.attemptCount).toBe(0);
    expect(resolveMarket.safeErrorCode).toBeNull();

    const runRow = (await env.BLUEPRINT_DB.prepare('SELECT finished_at FROM research_runs WHERE id = ?')
      .bind(runId)
      .first()) as { finished_at: string | null } | null;
    expect(runRow?.finished_at).toBeNull();

    expect(env.BLUEPRINT_QUEUE.sent).toEqual([{ runId }, { runId }]);
  });

  it('rejects retry from a non-terminal status (409 stage_conflict)', async () => {
    const env = fakeEnv();
    const { runId } = await seedQueuedRun(env);
    const res = await call(env, `/api/blueprint/v1/research-runs/${runId}/retry`, { method: 'POST', body: {} });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ApiFailure;
    expect(body.error.code).toBe('stage_conflict');
  });
});

describe('GET /api/blueprint/v1/research-runs/:id/usage', () => {
  it('returns empty items and a zeroed summary when no usage rows exist', async () => {
    const env = fakeEnv();
    const { runId } = await seedQueuedRun(env);
    const res = await call(env, `/api/blueprint/v1/research-runs/${runId}/usage`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.items).toEqual([]);
    expect(body.data.summary).toEqual({
      dataForSeoCostUsd: '0.00',
      openRouterCostUsd: '0.00',
      totalCostUsd: '0.00',
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      requestCount: 0,
    });
  });

  it('maps provider_usage rows to ProviderUsageEntry and sums the summary', async () => {
    const env = fakeEnv();
    const { runId } = await seedQueuedRun(env);
    await env.BLUEPRINT_DB.prepare(
      `INSERT INTO provider_usage
        (id, run_id, stage, provider, operation, endpoint_or_model, cache_status, request_count,
         prompt_tokens, completion_tokens, cost_usd_micro, latency_ms, created_at)
       VALUES (?, ?, 'collect_keyword_evidence', 'dataforseo', 'keyword_ideas', 'keywords_data/keyword_ideas', 'miss', 1, NULL, NULL, 250000, 400, ?)`
    )
      .bind(newId('pu'), runId, nowIso())
      .run();
    await env.BLUEPRINT_DB.prepare(
      `INSERT INTO provider_usage
        (id, run_id, stage, provider, operation, endpoint_or_model, cache_status, request_count,
         prompt_tokens, completion_tokens, cost_usd_micro, latency_ms, created_at)
       VALUES (?, ?, 'synthesize_page_briefs', 'openrouter', 'chat_completion', 'deepseek/deepseek-v4-pro', 'miss', 1, 1000, 500, 100000, 900, ?)`
    )
      .bind(newId('pu'), runId, nowIso())
      .run();

    const res = await call(env, `/api/blueprint/v1/research-runs/${runId}/usage`);
    const body = (await res.json()) as any;
    expect(body.data.items).toHaveLength(2);
    expect(body.data.summary.dataForSeoCostUsd).toBe('0.25');
    expect(body.data.summary.openRouterCostUsd).toBe('0.10');
    expect(body.data.summary.totalCostUsd).toBe('0.35');
    expect(body.data.summary.promptTokens).toBe(1000);
    expect(body.data.summary.requestCount).toBe(2);
  });
});
