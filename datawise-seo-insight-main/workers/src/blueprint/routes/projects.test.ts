import { describe, it, expect } from 'vitest';
import { handleBlueprintRequest } from './router';
import { newId, nowIso } from '../db/util';
import { processResearchRun } from '../orchestration/process-run';
import { fakeEnv } from '../test-support/env';
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

  it('returns 409 stage_conflict, not 500, when a second PATCH races with an already-applied one', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const projectId = json.data.id;

    // First PATCH wins the race and bumps the project to version 2.
    const first = await call(env, `/api/blueprint/v1/projects/${projectId}`, {
      method: 'PATCH',
      body: { ...validBrief, businessName: 'Aqua Plumbing Co' },
      headers: { 'If-Match': '1' },
    });
    expect(first.status).toBe(200);

    // Second PATCH racing against the first still carries the now-stale
    // If-Match value ('1'). Before the fix, the fenced version check ran
    // AFTER an unconditional brief-version insert, so a losing racer with a
    // colliding version_number could hit the UNIQUE constraint and surface
    // a raw 500 instead of the fenced 409. The fence now runs first, so this
    // is rejected as a clean 409 before any brief-version row is written.
    const second = await call(env, `/api/blueprint/v1/projects/${projectId}`, {
      method: 'PATCH',
      body: { ...validBrief, businessName: 'Aqua Plumbing Racer' },
      headers: { 'If-Match': '1' },
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as ApiFailure;
    expect(body.error.code).toBe('stage_conflict');

    const versionRow = (await env.BLUEPRINT_DB.prepare(
      'SELECT COUNT(*) as c FROM project_brief_versions WHERE project_id = ?'
    )
      .bind(projectId)
      .first()) as { c: number } | null;
    expect(versionRow?.c).toBe(2);
  });

  it('returns 409 stage_conflict, not 500, when a brief_version row already occupies the target version_number', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const projectId = json.data.id;

    // Simulate a stray/pre-existing brief_version row at the version_number
    // this PATCH would otherwise claim (project.version is still 1, so the
    // fenced update below will succeed and try to insert version_number 2).
    await env.BLUEPRINT_DB.prepare(
      `INSERT INTO project_brief_versions
        (id, project_id, version_number, input_json, normalized_json, input_hash, created_by, created_at)
       VALUES (?, ?, 2, '{}', '{}', 'stray-hash', 'u1', ?)`
    )
      .bind(newId('briefver'), projectId, nowIso())
      .run();

    const res = await call(env, `/api/blueprint/v1/projects/${projectId}`, {
      method: 'PATCH',
      body: { ...validBrief, businessName: 'Aqua Plumbing Co' },
      headers: { 'If-Match': '1' },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ApiFailure;
    expect(body.error.code).toBe('stage_conflict');

    // The fenced update and the brief-version insert commit in one batch(),
    // so the failed insert (stray row collision) rolls the fenced update
    // back too. The project must still resolve normally and still point at
    // its original brief, not be bricked with "Active brief version
    // missing" by a dangling active_brief_version_id pointer.
    const getRes = await call(env, `/api/blueprint/v1/projects/${projectId}`);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as ApiSuccess<ProjectView>;
    expect(getBody.data.version).toBe(1);
    expect(getBody.data.name).toBe('Aqua Plumbing');
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

  it('cancels the project\'s in-flight run so a queued consumer pass does not advance it', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);

    const estimateRes = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-estimates`, {
      method: 'POST',
      body: {},
    });
    const estimate = ((await estimateRes.json()) as ApiSuccess<ResearchEstimate>).data;

    const startRes = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-runs`, {
      method: 'POST',
      body: {
        estimateId: estimate.estimateId,
        acceptedDataForSeoCeilingUsd: '5.00',
        acceptedOpenRouterCeilingUsd: '2.00',
      },
      headers: { 'Idempotency-Key': newId('idem') },
    });
    const startBody = (await startRes.json()) as any;
    const runId = startBody.data.id;
    expect(startBody.data.status).toBe('queued');

    const delRes = await call(env, `/api/blueprint/v1/projects/${json.data.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    const runRow = (await env.BLUEPRINT_DB.prepare('SELECT status FROM research_runs WHERE id = ?')
      .bind(runId)
      .first()) as { status: string };
    expect(['cancel_requested', 'cancelled']).toContain(runRow.status);

    // A queued consumer pass (e.g. the message already in flight when the
    // delete landed) must convert the run to cancelled instead of advancing
    // any stage on a project that no longer exists.
    const result = await processResearchRun(env, runId, 'worker-1');
    expect(result.runStatus).toBe('cancelled');
    expect(result.advanced).toBe(false);

    const succeededStages = (await env.BLUEPRINT_DB
      .prepare("SELECT stage_name FROM research_stage_runs WHERE run_id = ? AND status = 'succeeded'")
      .bind(runId)
      .all()).results;
    expect(succeededStages).toHaveLength(0);
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
    expect(Number(body.data.totals.dataForSeoMinUsd)).toBeGreaterThan(0);
    expect(Number(body.data.totals.dataForSeoMaxUsd)).toBeGreaterThan(0);
    expect(Number(body.data.totals.dataForSeoMaxUsd)).toBeGreaterThanOrEqual(
      Number(body.data.totals.dataForSeoMinUsd)
    );
    expect(body.data.limitations).toEqual([
      'US fan-out, content parsing, and clustering land in later phases; costs shown cover keyword, competitor, and SERP research.',
    ]);
    expect(body.data.fanoutAvailability).toBe('disabled');
    expect(body.data.estimateId).toBeTruthy();
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const row = (await env.BLUEPRINT_DB.prepare('SELECT * FROM research_estimates WHERE id = ?')
      .bind(body.data.estimateId)
      .first()) as any;
    expect(row).toBeTruthy();
    expect(row.project_id).toBe(json.data.id);
    expect(row.min_cost_usd_micro).toBeGreaterThan(0);
    expect(row.max_cost_usd_micro).toBeGreaterThan(0);

    const project = (await env.BLUEPRINT_DB.prepare('SELECT active_brief_version_id FROM projects WHERE id = ?')
      .bind(json.data.id)
      .first()) as any;
    expect(row.brief_version_id).toBe(project.active_brief_version_id);

    const plan = JSON.parse(row.plan_json) as { lines: Array<{ operation: string }> };
    const operations = plan.lines.map((line) => line.operation);
    expect(operations).toContain('keyword_ideas');
    expect(operations).toContain('serp_task_post');
  });

  it('floors the min cost above zero for a serp-less plan (zero service areas)', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env, newId('idem'), {
      ...validBrief,
      websiteUrl: undefined, // greenfield
      serviceAreas: [],
    });
    const res = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-estimates`, {
      method: 'POST',
      body: {},
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ApiSuccess<ResearchEstimate>;
    expect(Number(body.data.totals.dataForSeoMinUsd)).toBeGreaterThan(0);
    expect(Number(body.data.totals.dataForSeoMaxUsd)).toBeGreaterThanOrEqual(
      Number(body.data.totals.dataForSeoMinUsd)
    );
    const serpStage = body.data.plannedStages.find((s) => s.stage === 'validate_serps_and_questions')!;
    expect(serpStage.estimatedTasks).toBe(0);

    const row = (await env.BLUEPRINT_DB.prepare(
      'SELECT min_cost_usd_micro, max_cost_usd_micro, plan_json FROM research_estimates WHERE id = ?'
    )
      .bind(body.data.estimateId)
      .first()) as any;
    expect(row.min_cost_usd_micro).toBeGreaterThan(0);
    expect(row.min_cost_usd_micro).toBeLessThanOrEqual(row.max_cost_usd_micro);
    const plan = JSON.parse(row.plan_json) as { lines: Array<{ operation: string }> };
    expect(plan.lines.map((line) => line.operation)).not.toContain('serp_task_post');
  });

  it('rejects run-start with an estimate bound to a since-superseded brief version (409 stage_conflict)', async () => {
    const env = fakeEnv();
    const { json } = await createProject(env);
    const estimateRes = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-estimates`, {
      method: 'POST',
      body: {},
    });
    const estimate = ((await estimateRes.json()) as ApiSuccess<ResearchEstimate>).data;

    // Supersede the active brief version: the estimate above is now stale.
    const patchRes = await call(env, `/api/blueprint/v1/projects/${json.data.id}`, {
      method: 'PATCH',
      body: { ...validBrief, businessName: 'Aqua Plumbing Co' },
      headers: { 'If-Match': String(json.data.version) },
    });
    expect(patchRes.status).toBe(200);

    const runRes = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-runs`, {
      method: 'POST',
      body: {
        estimateId: estimate.estimateId,
        acceptedDataForSeoCeilingUsd: '100.00',
        acceptedOpenRouterCeilingUsd: '10.00',
      },
      headers: { 'Idempotency-Key': newId('idem') },
    });
    expect(runRes.status).toBe(409);
    const runBody = (await runRes.json()) as ApiFailure;
    expect(runBody.error.code).toBe('stage_conflict');
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

  it('still returns 202 and survives a queue.send failure without creating a duplicate run on replay', async () => {
    const env = fakeEnv();
    env.BLUEPRINT_QUEUE.send = async () => {
      throw new Error('queue unavailable');
    };
    const { json } = await createProject(env);
    const estimate = await createEstimate(env, json.data.id);
    const key = newId('idem');
    const requestBody = {
      estimateId: estimate.estimateId,
      acceptedDataForSeoCeilingUsd: '5.00',
      acceptedOpenRouterCeilingUsd: '2.00',
    };

    const res = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-runs`, {
      method: 'POST',
      body: requestBody,
      headers: { 'Idempotency-Key': key },
    });
    // The queue send fails, but the run itself was already durably created
    // before the send was attempted, so the route still returns 202 (the
    // run exists; recovery is starting a new run with a new key) instead of
    // surfacing the send failure as a 500.
    expect(res.status).toBe(202);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('queued');
    expect(body.meta).toEqual({ enqueue: 'failed' });

    const runRows = (await env.BLUEPRINT_DB.prepare('SELECT COUNT(*) as c FROM research_runs WHERE project_id = ?')
      .bind(json.data.id)
      .first()) as { c: number } | null;
    expect(runRows?.c).toBe(1);

    const idemRow = (await env.BLUEPRINT_DB.prepare(
      "SELECT status FROM idempotency_records WHERE idempotency_key = ?"
    )
      .bind(key)
      .first()) as { status: string } | null;
    expect(idemRow?.status).toBe('completed');

    // A retry with the same key replays the stored response: no second run,
    // no second (attempted) send.
    const replay = await call(env, `/api/blueprint/v1/projects/${json.data.id}/research-runs`, {
      method: 'POST',
      body: requestBody,
      headers: { 'Idempotency-Key': key },
    });
    const replayBody = (await replay.json()) as any;
    expect(replayBody.data.id).toBe(body.data.id);

    const runRowsAfterReplay = (await env.BLUEPRINT_DB.prepare(
      'SELECT COUNT(*) as c FROM research_runs WHERE project_id = ?'
    )
      .bind(json.data.id)
      .first()) as { c: number } | null;
    expect(runRowsAfterReplay?.c).toBe(1);
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
