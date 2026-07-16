// Read-only Blueprint Canvas UI endpoints: the latest published version for
// a project, the page graph for a revision, and single-page detail. Every
// handler is thin, ownership resolution and data assembly both live in
// db/blueprint-reads.ts; errors propagate to router.ts's failFrom.
import type { Actor } from '../db/access';
import type { BlueprintQueueEnv } from '../orchestration/process-run';
import { loadLatestBlueprint, loadRevisionOwned, loadGraph, loadPageDetail } from '../db/blueprint-reads';
import { ok } from './envelope';

export async function getLatestBlueprint(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const view = await loadLatestBlueprint(env.BLUEPRINT_DB, actor, params.id);
  return ok(view);
}

export async function getBlueprintGraph(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const { revisionId, runId } = await loadRevisionOwned(env.BLUEPRINT_DB, actor, params.id);
  const nodes = await loadGraph(env.BLUEPRINT_DB, revisionId, runId);
  return ok({ revisionId, nodes });
}

export async function getBlueprintPage(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const { revisionId, runId } = await loadRevisionOwned(env.BLUEPRINT_DB, actor, params.id);
  const detail = await loadPageDetail(env.BLUEPRINT_DB, revisionId, runId, params.pageId);
  return ok(detail);
}
