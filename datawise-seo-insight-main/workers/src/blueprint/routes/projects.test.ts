import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { handleBlueprintRequest } from './router';
import { newId, nowIso } from '../db/util';
import type { AuthUser } from '../../auth/google';
import type { ApiSuccess, ApiFailure, ProjectView, ResearchEstimate } from '../contracts/api';

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
  // Mirrors index.ts: `path` dispatched to the router is url.pathname only
  // (no query string), even though the Request itself carries the full URL.
  const pathname = path.split('?')[0];
  return handleBlueprintRequest(makeRequest(path, opts), env, adminUser, pathname, method);
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

async function createProject(env: any, key = newId('idem'), body: unknown = validBrief) {
  const res = await call(env, '/api/blueprint/v1/projects', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': key },
  });
  const json = (await res.json()) as ApiSuccess<ProjectView>;
  return { res, json };
}

describe('POST /api/blueprint/v1/projects', () => {
  it('creates a project + brief version 1 and returns 201 with normalized brief', async () => {
    const env = fakeEnv();
    const { res, json } = await createProject(env);
    expect(res.status).toBe(201);
    expect(json.data.name).toBe('Aqua Plumbing');
    expect(json.data.version).toBe(1);
    expect(json.data.mode).toBe('existing_site');
    expect(json.data.brief.websiteDomain).toBe('aquaplumbing.com');
    expect(json.data.brief.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.data.latestRunId).toBeNull();
    expect(json.requestId).toBeTruthy();
  });

  it('requires the Idempotency-Key header (400 invalid_input)', async () => {
    const env = fakeEnv();
    const res = await call(env, '/api/blueprint/v1/projects', { method: 'POST', body: validBrief });
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiFailure;
    expect(json.error.code).toBe('invalid_input');
  });

  it('replays the identical response for the same key + same body', async () => {
    const env = fakeEnv();
    const key = newId('idem');
    const first = await createProject(env, key);
    const second = await createProject(env, key);
    expect(second.res.status).toBe(201);
    expect(second.json.data.id).toBe(first.json.data.id);
    expect(second.json.requestId).toBe(first.json.requestId);
  });

  it('returns 409 stage_conflict for the same key with a different body', async () => {
    const env = fakeEnv();
    const key = newId('idem');
    await createProject(env, key);
    const res = await call(env, '/api/blueprint/v1/projects', {
      method: 'POST',
      body: { ...validBrief, businessName: 'Different Co' },
      headers: { 'Idempotency-Key': key },
    });
    expect(res.status).toBe(409);
    const json = (await res.json()) as ApiFailure;
    expect(json.error.code).toBe('stage_conflict');
  });

  it('returns 400 invalid_input with field errors for an invalid brief', async () => {
    const env = fakeEnv();
    const res = await call(env, '/api/blueprint/v1/projects', {
      method: 'POST',
      body: { ...validBrief, services: [] },
      headers: { 'Idempotency-Key': newId('idem') },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiFailure;
    expect(json.error.code).toBe('invalid_input');
    expect(json.error.fieldErrors).toBeTruthy();
  });
});

describe('GET /api/blueprint/v1/projects', () => {
  it('lists newest-first with pagination', async () => {
    const env = fakeEnv();
    for (let i = 0; i < 25; i++) {
      await createProject(env, newId('idem'), { ...validBrief, businessName: `Business ${i}` });
    }
    const page1 = await call(env, '/api/blueprint/v1/projects');
    const body1 = (await page1.json()) as ApiSuccess<{ items: ProjectView[]; nextCursor: string | null }>;
    expect(body1.data.items).toHaveLength(20);
    expect(body1.data.nextCursor).toBeTruthy();

    const page2 = await call(env, `/api/blueprint/v1/projects?cursor=${encodeURIComponent(body1.data.nextCursor!)}`);
    const body2 = (await page2.json()) as ApiSuccess<{ items: ProjectView[]; nextCursor: string | null }>;
    expect(body2.data.items).toHaveLength(5);
    expect(body2.data.nextCursor).toBeNull();

    const allIds = new Set([...body1.data.items, ...body2.data.items].map((p) => p.id));
    expect(allIds.size).toBe(25);
  });

  it('only returns the caller organization projects', async () => {
    const env = fakeEnv();
    await createProject(env);
    await env.BLUEPRINT_DB.prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at, version)
       VALUES (?, 'other-org', 'other-user', 'Foreign Co', 'greenfield', 'US', 'en', ?, ?, 1)`
    )
      .bind(newId('proj'), nowIso(), nowIso())
      .run();

    const res = await call(env, '/api/blueprint/v1/projects');
    const json = (await res.json()) as ApiSuccess<{ items: ProjectView[]; nextCursor: string | null }>;
    expect(json.data.items).toHaveLength(1);
  });
});

describe('GET /api/blueprint/v1/projects/:id', () => {
  it('returns the project view', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const res = await call(env, `/api/blueprint/v1/projects/${json.data.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiSuccess<ProjectView>;
    expect(body.data.id).toBe(json.data.id);
  });

  it('returns the invisible 404 body for a missing project', async () => {
    const env = fakeEnv();
    const res = await call(env, `/api/blueprint/v1/projects/${newId('proj')}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body).toEqual({ error: 'Not Found' });
  });

  it('returns the invisible 404 body for a project owned by another organization', async () => {
    const env = fakeEnv();
    const foreignId = newId('proj');
    await env.BLUEPRINT_DB.prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at, version)
       VALUES (?, 'other-org', 'other-user', 'Foreign Co', 'greenfield', 'US', 'en', ?, ?, 1)`
    )
      .bind(foreignId, nowIso(), nowIso())
      .run();
    const res = await call(env, `/api/blueprint/v1/projects/${foreignId}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
  });
});

describe('PATCH /api/blueprint/v1/projects/:id', () => {
  it('requires If-Match (400)', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const res = await call(env, `/api/blueprint/v1/projects/${json.data.id}`, { method: 'PATCH', body: validBrief });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiFailure;
    expect(body.error.code).toBe('invalid_input');
  });

  it('rejects a stale If-Match (409 stage_conflict)', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const res = await call(env, `/api/blueprint/v1/projects/${json.data.id}`, {
      method: 'PATCH',
      body: { ...validBrief, businessName: 'New Name' },
      headers: { 'If-Match': '99' },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ApiFailure;
    expect(body.error.code).toBe('stage_conflict');
  });

  it('creates brief version 2, bumps project.version, and clears stale run pointers when the hash changes', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const projectId = json.data.id;
    const fakeRunId = newId('run');
    await env.BLUEPRINT_DB.prepare('UPDATE projects SET latest_run_id = ? WHERE id = ?').bind(fakeRunId, projectId).run();

    const res = await call(env, `/api/blueprint/v1/projects/${projectId}`, {
      method: 'PATCH',
      body: { ...validBrief, businessName: 'Aqua Plumbing Co' },
      headers: { 'If-Match': '1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiSuccess<ProjectView>;
    expect(body.data.version).toBe(2);
    expect(body.data.name).toBe('Aqua Plumbing Co');
    expect(body.data.latestRunId).toBeNull();

    const versionRow = (await env.BLUEPRINT_DB.prepare(
      'SELECT COUNT(*) as c FROM project_brief_versions WHERE project_id = ?'
    )
      .bind(projectId)
      .first()) as { c: number } | null;
    expect(versionRow?.c).toBe(2);
  });

  it('does not clear the latest run pointer when the normalized brief is unchanged', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const projectId = json.data.id;
    const fakeRunId = newId('run');
    await env.BLUEPRINT_DB.prepare('UPDATE projects SET latest_run_id = ? WHERE id = ?').bind(fakeRunId, projectId).run();

    const res = await call(env, `/api/blueprint/v1/projects/${projectId}`, {
      method: 'PATCH',
      body: validBrief,
      headers: { 'If-Match': '1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiSuccess<ProjectView>;
    expect(body.data.version).toBe(2);
    expect(body.data.latestRunId).toBe(fakeRunId);
  });
});

describe('DELETE /api/blueprint/v1/projects/:id', () => {
  it('soft-deletes and returns 204, then the project is invisible', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const res = await call(env, `/api/blueprint/v1/projects/${json.data.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const getRes = await call(env, `/api/blueprint/v1/projects/${json.data.id}`);
    expect(getRes.status).toBe(404);
  });
});

describe('POST /api/blueprint/v1/projects/:id/research-estimates', () => {
  it('returns a stubbed estimate and persists it', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const res = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-estimates`, {
      method: 'POST',
      body: {},
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ApiSuccess<ResearchEstimate>;
    expect(body.data.plannedStages).toHaveLength(19);
    expect(body.data.plannedStages[0].estimatedTasks).toBe(0);
    expect(body.data.plannedStages[0].estimatedMinUsd).toBe('0.00');
    expect(body.data.totals.dataForSeoMinUsd).toBe('0.00');
    expect(body.data.limitations).toEqual([
      'Cost estimation is stubbed until provider adapters ship in Phase 3',
    ]);
    expect(body.data.fanoutAvailability).toBe('disabled');
    expect(body.data.estimateId).toBeTruthy();
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const row = (await env.BLUEPRINT_DB.prepare('SELECT * FROM research_estimates WHERE id = ?')
      .bind(body.data.estimateId)
      .first()) as any;
    expect(row).toBeTruthy();
    expect(row.project_id).toBe(json.data.id);
  });

  it('returns the invisible 404 body for a foreign project', async () => {
    const env = fakeEnv();
    const foreignId = newId('proj');
    await env.BLUEPRINT_DB.prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at, version)
       VALUES (?, 'other-org', 'other-user', 'Foreign Co', 'greenfield', 'US', 'en', ?, ?, 1)`
    )
      .bind(foreignId, nowIso(), nowIso())
      .run();
    const res = await call(env, `/api/blueprint/v1/projects/${foreignId}/research-estimates`, {
      method: 'POST',
      body: {},
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
  });
});

describe('POST /api/blueprint/v1/projects/:id/research-runs', () => {
  async function createEstimate(env: any, projectId: string) {
    const res = await call(env, `/api/blueprint/v1/projects/${projectId}/research-estimates`, {
      method: 'POST',
      body: {},
    });
    const body = (await res.json()) as ApiSuccess<ResearchEstimate>;
    return body.data;
  }

  it('requires Idempotency-Key (400)', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const estimate = await createEstimate(env, json.data.id);
    const res = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-runs`, {
      method: 'POST',
      body: {
        estimateId: estimate.estimateId,
        acceptedDataForSeoCeilingUsd: '5.00',
        acceptedOpenRouterCeilingUsd: '2.00',
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiFailure;
    expect(body.error.code).toBe('invalid_input');
  });

  it('starts a run, enqueues it, and sets project.latestRunId (202)', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const estimate = await createEstimate(env, json.data.id);
    const res = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-runs`, {
      method: 'POST',
      body: {
        estimateId: estimate.estimateId,
        acceptedDataForSeoCeilingUsd: '5.00',
        acceptedOpenRouterCeilingUsd: '2.00',
      },
      headers: { 'Idempotency-Key': newId('idem') },
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('queued');
    expect(body.data.projectId).toBe(json.data.id);
    expect(body.data.stages).toHaveLength(19);
    expect(env.BLUEPRINT_QUEUE.sent).toEqual([{ runId: body.data.id }]);

    const projectRes = await call(env, `/api/blueprint/v1/projects/${json.data.id}`);
    const projectBody = (await projectRes.json()) as ApiSuccess<ProjectView>;
    expect(projectBody.data.latestRunId).toBe(body.data.id);
  });

  it('replays the same run on a duplicate Idempotency-Key + body', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const estimate = await createEstimate(env, json.data.id);
    const key = newId('idem');
    const requestBody = {
      estimateId: estimate.estimateId,
      acceptedDataForSeoCeilingUsd: '5.00',
      acceptedOpenRouterCeilingUsd: '2.00',
    };
    const first = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-runs`, {
      method: 'POST',
      body: requestBody,
      headers: { 'Idempotency-Key': key },
    });
    const second = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-runs`, {
      method: 'POST',
      body: requestBody,
      headers: { 'Idempotency-Key': key },
    });
    const firstBody = (await first.json()) as any;
    const secondBody = (await second.json()) as any;
    expect(secondBody.data.id).toBe(firstBody.data.id);
    // Only one queue send: the second call replayed the stored response
    // rather than re-running the start-run logic.
    expect(env.BLUEPRINT_QUEUE.sent).toHaveLength(1);
  });

  it('rejects an expired estimate (400 invalid_input)', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const estimate = await createEstimate(env, json.data.id);
    await env.BLUEPRINT_DB.prepare('UPDATE research_estimates SET expires_at = ? WHERE id = ?')
      .bind('2000-01-01T00:00:00.000Z', estimate.estimateId)
      .run();

    const res = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-runs`, {
      method: 'POST',
      body: {
        estimateId: estimate.estimateId,
        acceptedDataForSeoCeilingUsd: '5.00',
        acceptedOpenRouterCeilingUsd: '2.00',
      },
      headers: { 'Idempotency-Key': newId('idem') },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiFailure;
    expect(body.error.code).toBe('invalid_input');
  });

  it('rejects an estimate id belonging to a different project (400 invalid_input)', async () => {
    const env = fakeEnv();
    const { json: projectA } = await createProject(env, newId('idem'), { ...validBrief, businessName: 'Project A' });
    const { json: projectB } = await createProject(env, newId('idem'), { ...validBrief, businessName: 'Project B' });
    const estimateA = await createEstimate(env, projectA.data.id);

    const res = await call(env, `/api/blueprint/v1/projects/${projectB.data.id}/research-runs`, {
      method: 'POST',
      body: {
        estimateId: estimateA.estimateId,
        acceptedDataForSeoCeilingUsd: '5.00',
        acceptedOpenRouterCeilingUsd: '2.00',
      },
      headers: { 'Idempotency-Key': newId('idem') },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiFailure;
    expect(body.error.code).toBe('invalid_input');
  });
});
