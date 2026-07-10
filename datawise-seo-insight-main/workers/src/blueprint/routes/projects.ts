import type { ProjectView, ResearchEstimate, StartResearchRunInput } from '../contracts/api';
import type { ProjectMode } from '../contracts/enums';
import type { NormalizedProjectBrief } from '../contracts/types';
import { V1_LIMITS } from '../contracts/limits';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { hashNormalizedInput } from '../domain/hash';
import { BlueprintApiError } from '../domain/api-errors';
import { newId, nowIso, usdToMicro } from '../db/util';
import { assertProjectAccess, type Actor, type ProjectRow } from '../db/access';
import { beginIdempotentRequest, completeIdempotentRequest, failIdempotentRequest } from '../db/idempotency';
import { STAGE_REGISTRY } from '../orchestration/stages';
import type { BlueprintQueueEnv } from '../orchestration/process-run';
import { ok, noContent, successEnvelope, readJsonBody, JSON_HEADERS } from './envelope';
import { buildRunView } from './runs';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
function idempotencyExpiry(): string {
  return new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
}

const ROUTE_KEY_CREATE_PROJECT = 'POST /projects';
const ROUTE_KEY_START_RUN = 'POST /projects/:id/research-runs';

async function buildProjectView(d1: D1Database, project: ProjectRow): Promise<ProjectView> {
  if (!project.active_brief_version_id) {
    throw new Error(`Project ${project.id} has no active brief version`);
  }
  const briefRow = await d1
    .prepare('SELECT normalized_json FROM project_brief_versions WHERE id = ?')
    .bind(project.active_brief_version_id)
    .first<{ normalized_json: string }>();
  if (!briefRow) {
    throw new Error(`Active brief version missing for project ${project.id}`);
  }
  const brief: NormalizedProjectBrief = JSON.parse(briefRow.normalized_json);
  return {
    id: project.id,
    name: project.name,
    mode: project.mode as ProjectMode,
    brief,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    latestRunId: project.latest_run_id,
    latestBlueprintVersionId: project.latest_blueprint_version_id,
    latestBlueprintRevisionId: project.latest_blueprint_revision_id,
    version: project.version,
  };
}

function encodeCursor(value: { createdAt: string; id: string }): string {
  return btoa(JSON.stringify(value));
}

function decodeCursor(raw: string): { createdAt: string; id: string } {
  try {
    const parsed = JSON.parse(atob(raw));
    if (typeof parsed?.createdAt !== 'string' || typeof parsed?.id !== 'string') {
      throw new Error('malformed cursor payload');
    }
    return parsed;
  } catch {
    throw new BlueprintApiError('invalid_input', 'Malformed cursor');
  }
}

// POST /projects: creates the project row and its first (version 1) brief
// version atomically, guarded by an Idempotency-Key so a client retry after
// a dropped response never creates a duplicate project.
export async function createProject(
  request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  _params: Record<string, string>
): Promise<Response> {
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) {
    throw new BlueprintApiError('invalid_input', 'Idempotency-Key header is required');
  }

  const rawBody = await readJsonBody(request);
  const requestHash = await hashNormalizedInput(rawBody);
  const begin = await beginIdempotentRequest(env.BLUEPRINT_DB, {
    organizationId: actor.organizationId,
    routeKey: ROUTE_KEY_CREATE_PROJECT,
    idempotencyKey,
    requestHash,
    expiresAt: idempotencyExpiry(),
  });
  if (begin.kind === 'completed') {
    return new Response(begin.responseJson, { status: begin.responseStatus, headers: JSON_HEADERS });
  }
  if (begin.kind === 'in_progress') {
    throw new BlueprintApiError('stage_conflict', 'Request is already in progress');
  }
  if (begin.kind === 'conflict') {
    throw new BlueprintApiError('stage_conflict', 'Idempotency-Key was reused with a different payload');
  }

  try {
    const parsedBrief = parseProjectBrief(rawBody);
    const normalized = await normalizeProjectBrief(parsedBrief, V1_LIMITS);

    const projectId = newId('proj');
    const briefVersionId = newId('briefver');
    const now = nowIso();

    await env.BLUEPRINT_DB.batch([
      env.BLUEPRINT_DB
        .prepare(
          `INSERT INTO projects
            (id, organization_id, owner_user_id, name, mode, website_domain, country_iso, language_code,
             active_brief_version_id, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .bind(
          projectId,
          actor.organizationId,
          actor.userId,
          normalized.businessName,
          normalized.mode,
          normalized.websiteDomain,
          normalized.countryIso,
          normalized.languageCode,
          briefVersionId,
          now,
          now
        ),
      env.BLUEPRINT_DB
        .prepare(
          `INSERT INTO project_brief_versions
            (id, project_id, version_number, input_json, normalized_json, input_hash, created_by, created_at)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
        )
        .bind(
          briefVersionId,
          projectId,
          JSON.stringify(parsedBrief),
          JSON.stringify(normalized),
          normalized.inputHash,
          actor.userId,
          now
        ),
    ]);

    const view: ProjectView = {
      id: projectId,
      name: normalized.businessName,
      mode: normalized.mode,
      brief: normalized,
      createdAt: now,
      updatedAt: now,
      latestRunId: null,
      latestBlueprintVersionId: null,
      latestBlueprintRevisionId: null,
      version: 1,
    };

    const responseJson = JSON.stringify(successEnvelope(view));
    await completeIdempotentRequest(env.BLUEPRINT_DB, begin.recordId, {
      resourceType: 'project',
      resourceId: projectId,
      responseStatus: 201,
      responseJson,
    });
    return new Response(responseJson, { status: 201, headers: JSON_HEADERS });
  } catch (err) {
    await failIdempotentRequest(env.BLUEPRINT_DB, begin.recordId, true);
    throw err;
  }
}

const PAGE_SIZE = 20;

export async function listProjects(
  request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  _params: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const cursorParam = url.searchParams.get('cursor');

  const bindings: unknown[] = [actor.organizationId];
  let cursorClause = '';
  if (cursorParam) {
    const cursor = decodeCursor(cursorParam);
    cursorClause = ' AND (created_at < ? OR (created_at = ? AND id < ?))';
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  bindings.push(PAGE_SIZE + 1);

  const result = await env.BLUEPRINT_DB
    .prepare(
      `SELECT * FROM projects
       WHERE organization_id = ? AND deleted_at IS NULL${cursorClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .bind(...bindings)
    .all<ProjectRow>();

  const rows = result.results;
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const items = await Promise.all(page.map((row) => buildProjectView(env.BLUEPRINT_DB, row)));
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

  return ok({ items, nextCursor });
}

export async function getProject(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const project = await assertProjectAccess(env.BLUEPRINT_DB, actor, params.id);
  const view = await buildProjectView(env.BLUEPRINT_DB, project);
  return ok(view);
}

export async function updateProject(
  request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const project = await assertProjectAccess(env.BLUEPRINT_DB, actor, params.id);

  const ifMatch = request.headers.get('If-Match');
  if (!ifMatch) {
    throw new BlueprintApiError('invalid_input', 'If-Match header is required');
  }
  if (ifMatch !== String(project.version)) {
    throw new BlueprintApiError('stage_conflict', 'If-Match version does not match the current project version');
  }

  const rawBody = await readJsonBody(request);
  const parsedBrief = parseProjectBrief(rawBody);
  const normalized = await normalizeProjectBrief(parsedBrief, V1_LIMITS);

  const previousBrief = project.active_brief_version_id
    ? await env.BLUEPRINT_DB
        .prepare('SELECT input_hash FROM project_brief_versions WHERE id = ?')
        .bind(project.active_brief_version_id)
        .first<{ input_hash: string }>()
    : null;
  const hashChanged = !previousBrief || previousBrief.input_hash !== normalized.inputHash;

  const newVersion = project.version + 1;
  const briefVersionId = newId('briefver');
  const now = nowIso();

  await env.BLUEPRINT_DB
    .prepare(
      `INSERT INTO project_brief_versions
        (id, project_id, version_number, input_json, normalized_json, input_hash, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      briefVersionId,
      project.id,
      newVersion,
      JSON.stringify(parsedBrief),
      JSON.stringify(normalized),
      normalized.inputHash,
      actor.userId,
      now
    )
    .run();

  // Research becomes stale only when the normalized brief actually changed;
  // a no-op PATCH (identical content, new version number) leaves the
  // project's latest run/blueprint pointers intact.
  const staleClause = hashChanged
    ? ', latest_run_id = NULL, latest_blueprint_version_id = NULL, latest_blueprint_revision_id = NULL'
    : '';
  const update = await env.BLUEPRINT_DB
    .prepare(
      `UPDATE projects
       SET name = ?, mode = ?, website_domain = ?, country_iso = ?, language_code = ?,
           active_brief_version_id = ?, version = ?, updated_at = ?${staleClause}
       WHERE id = ? AND version = ?`
    )
    .bind(
      normalized.businessName,
      normalized.mode,
      normalized.websiteDomain,
      normalized.countryIso,
      normalized.languageCode,
      briefVersionId,
      newVersion,
      now,
      project.id,
      project.version
    )
    .run();

  if (update.meta.changes === 0) {
    // Someone else's write landed between our If-Match check and this CAS
    // update; the client's If-Match is now stale too.
    throw new BlueprintApiError('stage_conflict', 'Project was updated concurrently; retry with a fresh If-Match');
  }

  const refreshed = await assertProjectAccess(env.BLUEPRINT_DB, actor, project.id);
  const view = await buildProjectView(env.BLUEPRINT_DB, refreshed);
  return ok(view);
}

export async function deleteProject(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const project = await assertProjectAccess(env.BLUEPRINT_DB, actor, params.id);
  const now = nowIso();
  await env.BLUEPRINT_DB
    .prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, project.id)
    .run();
  return noContent();
}

// POST /projects/:id/research-estimates: Phase 2 estimate is fully stubbed
// (cost estimation ships with the provider adapters in Phase 3). The input
// body is read (to reject malformed JSON) but otherwise unused.
export async function createEstimate(
  request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const project = await assertProjectAccess(env.BLUEPRINT_DB, actor, params.id);
  await readJsonBody(request);

  if (!project.active_brief_version_id) {
    throw new BlueprintApiError('invalid_input', 'Project has no active brief version');
  }

  const estimateId = newId('est');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const plannedStages = STAGE_REGISTRY.map((meta) => ({
    stage: meta.stage,
    required: meta.required,
    estimatedTasks: 0,
    estimatedMinUsd: '0.00',
    estimatedMaxUsd: '0.00',
    cacheEligible: false,
  }));

  const estimate: ResearchEstimate = {
    estimateId,
    expiresAt,
    plannedStages,
    totals: {
      dataForSeoMinUsd: '0.00',
      dataForSeoMaxUsd: '0.00',
      openRouterMaxUsd: '0.00',
      estimatedDurationSecondsMin: 60,
      estimatedDurationSecondsMax: 300,
    },
    limitations: ['Cost estimation is stubbed until provider adapters ship in Phase 3'],
    fanoutAvailability: 'disabled',
  };

  await env.BLUEPRINT_DB
    .prepare(
      `INSERT INTO research_estimates
        (id, project_id, brief_version_id, plan_json, min_cost_usd_micro, max_cost_usd_micro, expires_at, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
    )
    .bind(
      estimateId,
      project.id,
      project.active_brief_version_id,
      JSON.stringify(plannedStages),
      expiresAt,
      now.toISOString()
    )
    .run();

  return ok(estimate, 201);
}

interface EstimateRow {
  id: string;
  project_id: string;
  brief_version_id: string;
  expires_at: string;
}

function parseStartRunInput(body: unknown): StartResearchRunInput {
  if (typeof body !== 'object' || body === null) {
    throw new BlueprintApiError('invalid_input', 'Request body must be an object');
  }
  const b = body as Record<string, unknown>;
  const fieldErrors: Record<string, string[]> = {};
  if (typeof b.estimateId !== 'string' || !b.estimateId) {
    fieldErrors.estimateId = ['estimateId is required'];
  }
  if (typeof b.acceptedDataForSeoCeilingUsd !== 'string' || !b.acceptedDataForSeoCeilingUsd) {
    fieldErrors.acceptedDataForSeoCeilingUsd = ['acceptedDataForSeoCeilingUsd is required'];
  }
  if (typeof b.acceptedOpenRouterCeilingUsd !== 'string' || !b.acceptedOpenRouterCeilingUsd) {
    fieldErrors.acceptedOpenRouterCeilingUsd = ['acceptedOpenRouterCeilingUsd is required'];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new BlueprintApiError('invalid_input', 'Invalid research run input', { fieldErrors });
  }
  return {
    estimateId: b.estimateId as string,
    acceptedDataForSeoCeilingUsd: b.acceptedDataForSeoCeilingUsd as string,
    acceptedOpenRouterCeilingUsd: b.acceptedOpenRouterCeilingUsd as string,
  };
}

function toMicroOrThrow(field: string, usd: string): number {
  try {
    return usdToMicro(usd);
  } catch {
    throw new BlueprintApiError('invalid_input', `Invalid USD amount for ${field}`, {
      fieldErrors: { [field]: [`Invalid USD amount: ${usd}`] },
    });
  }
}

// POST /projects/:id/research-runs: validates the estimate, records the
// accepted budget ceilings, queues the run, and enqueues the first
// processing message. Guarded by Idempotency-Key like createProject.
export async function startResearchRun(
  request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const project = await assertProjectAccess(env.BLUEPRINT_DB, actor, params.id);

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) {
    throw new BlueprintApiError('invalid_input', 'Idempotency-Key header is required');
  }

  const rawBody = await readJsonBody(request);
  const requestHash = await hashNormalizedInput(rawBody);
  const begin = await beginIdempotentRequest(env.BLUEPRINT_DB, {
    organizationId: actor.organizationId,
    routeKey: ROUTE_KEY_START_RUN,
    idempotencyKey,
    requestHash,
    expiresAt: idempotencyExpiry(),
  });
  if (begin.kind === 'completed') {
    return new Response(begin.responseJson, { status: begin.responseStatus, headers: JSON_HEADERS });
  }
  if (begin.kind === 'in_progress') {
    throw new BlueprintApiError('stage_conflict', 'Request is already in progress');
  }
  if (begin.kind === 'conflict') {
    throw new BlueprintApiError('stage_conflict', 'Idempotency-Key was reused with a different payload');
  }

  try {
    const input = parseStartRunInput(rawBody);

    const estimate = await env.BLUEPRINT_DB
      .prepare('SELECT id, project_id, brief_version_id, expires_at FROM research_estimates WHERE id = ? AND project_id = ?')
      .bind(input.estimateId, project.id)
      .first<EstimateRow>();
    if (!estimate) {
      throw new BlueprintApiError('invalid_input', 'Unknown research estimate for this project', {
        fieldErrors: { estimateId: ['Estimate not found for this project'] },
      });
    }
    if (estimate.expires_at <= nowIso()) {
      throw new BlueprintApiError('invalid_input', 'Research estimate has expired', {
        fieldErrors: { estimateId: ['Estimate has expired; request a new one'] },
      });
    }
    if (!project.active_brief_version_id) {
      throw new BlueprintApiError('invalid_input', 'Project has no active brief version');
    }

    const dataForSeoBudgetMicro = toMicroOrThrow('acceptedDataForSeoCeilingUsd', input.acceptedDataForSeoCeilingUsd);
    const openRouterBudgetMicro = toMicroOrThrow('acceptedOpenRouterCeilingUsd', input.acceptedOpenRouterCeilingUsd);

    const runId = newId('run');
    const now = nowIso();

    await env.BLUEPRINT_DB
      .prepare(
        `INSERT INTO research_runs
          (id, project_id, brief_version_id, estimate_id, status,
           dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
      )
      .bind(
        runId,
        project.id,
        project.active_brief_version_id,
        estimate.id,
        dataForSeoBudgetMicro,
        openRouterBudgetMicro,
        actor.userId,
        now
      )
      .run();

    await env.BLUEPRINT_DB
      .prepare('UPDATE projects SET latest_run_id = ?, updated_at = ? WHERE id = ?')
      .bind(runId, now, project.id)
      .run();

    await env.BLUEPRINT_QUEUE.send({ runId });

    const view = await buildRunView(env.BLUEPRINT_DB, runId);
    const responseJson = JSON.stringify(successEnvelope(view));
    await completeIdempotentRequest(env.BLUEPRINT_DB, begin.recordId, {
      resourceType: 'research_run',
      resourceId: runId,
      responseStatus: 202,
      responseJson,
    });
    return new Response(responseJson, { status: 202, headers: JSON_HEADERS });
  } catch (err) {
    await failIdempotentRequest(env.BLUEPRINT_DB, begin.recordId, true);
    throw err;
  }
}
