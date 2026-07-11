import type { AuthUser } from '../../auth/google';
import { NotFoundError } from '../domain/api-errors';

export interface Actor {
  userId: string;
  organizationId: string;
  roles: string[];
}

// Row shapes match the Task 1 schema columns (workers/src/blueprint/db/schema.sql) verbatim, snake_case.
export interface ProjectRow {
  id: string;
  organization_id: string;
  owner_user_id: string;
  name: string;
  mode: string;
  website_domain: string | null;
  country_iso: string;
  language_code: string;
  active_brief_version_id: string | null;
  latest_run_id: string | null;
  latest_blueprint_version_id: string | null;
  latest_blueprint_revision_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
}

export interface RunRow {
  id: string;
  project_id: string;
  brief_version_id: string;
  estimate_id: string;
  status: string;
  dataforseo_budget_usd_micro: number;
  openrouter_budget_usd_micro: number;
  dataforseo_reserved_usd_micro: number;
  openrouter_reserved_usd_micro: number;
  dataforseo_actual_usd_micro: number;
  openrouter_actual_usd_micro: number;
  current_stage: string | null;
  partial_reasons_json: string;
  started_at: string | null;
  finished_at: string | null;
  created_by: string;
  created_at: string;
}

// DataWise is single-tenant per Google account today: there is no separate
// `organizations` table wired up yet, so organizationId is adapted to the
// user's own id. This keeps the actor/access shape ready for a future
// multi-user organization without a migration once one exists.
export function actorFromUser(user: AuthUser): Actor {
  const roles = ['owner'];
  if (user.is_admin) roles.push('admin');
  return {
    userId: user.id,
    organizationId: user.id,
    roles,
  };
}

// Invisible-404 rule: missing, cross-tenant, and soft-deleted projects are
// all indistinguishable NotFoundError to the caller.
export async function assertProjectAccess(
  d1: D1Database,
  actor: Actor,
  projectId: string
): Promise<ProjectRow> {
  const row = await d1
    .prepare('SELECT * FROM projects WHERE id = ? AND organization_id = ? AND deleted_at IS NULL')
    .bind(projectId, actor.organizationId)
    .first<ProjectRow>();
  if (!row) throw new NotFoundError(`Project not found: ${projectId}`);
  return row;
}

// Follows the run to its parent project so the same tenant/soft-delete
// guards apply without duplicating them on research_runs.
export async function assertRunAccess(
  d1: D1Database,
  actor: Actor,
  runId: string
): Promise<RunRow> {
  const row = await d1
    .prepare(
      `SELECT research_runs.*
       FROM research_runs
       JOIN projects ON projects.id = research_runs.project_id
       WHERE research_runs.id = ?
         AND projects.organization_id = ?
         AND projects.deleted_at IS NULL`
    )
    .bind(runId, actor.organizationId)
    .first<RunRow>();
  if (!row) throw new NotFoundError(`Research run not found: ${runId}`);
  return row;
}
