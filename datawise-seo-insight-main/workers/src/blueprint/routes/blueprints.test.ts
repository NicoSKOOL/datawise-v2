import { describe, it, expect } from 'vitest';
import { handleBlueprintRequest } from './router';
import { newId, nowIso } from '../db/util';
import { fakeEnv } from '../test-support/env';
import type { AuthUser } from '../../auth/google';
import type { ApiSuccess } from '../contracts/api';
import type { BlueprintLatestView, BlueprintGraphNode, BlueprintPageDetail } from '../db/blueprint-reads';

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

const otherUser = { ...adminUser, id: 'u2' } as AuthUser;

function makeRequest(path: string): Request {
  return new Request(`https://api.test${path}`, { headers: { 'Content-Type': 'application/json' } });
}

async function call(env: any, path: string, user: AuthUser = adminUser): Promise<Response> {
  // Mirrors index.ts's real dispatch: path is url.pathname (query string
  // stripped), not the raw request path. Route patterns are anchored with
  // `$` and would never match a path that still carries a `?format=...`
  // suffix.
  const pathname = new URL(`https://api.test${path}`).pathname;
  return handleBlueprintRequest(makeRequest(path), env, user, pathname, 'GET');
}

// Seed helpers below mirror db/blueprint-reads.test.ts's fixtures (that file
// asserts on the loaders directly; these route tests assert on the HTTP
// envelope on top of them, so the seeding is duplicated rather than shared).
async function seedProject(d1: D1Database, organizationId: string): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects
        (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, organizationId, 'user1', 'Test Project', 'existing_site', 'US', 'en', nowIso(), nowIso())
    .run();
  return id;
}

async function seedRun(d1: D1Database, projectId: string): Promise<string> {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, created_by, created_at)
       VALUES (?, ?, ?, ?, 'succeeded', ?, ?)`
    )
    .bind(id, projectId, 'brief1', 'estimate1', 'user1', nowIso())
    .run();
  return id;
}

async function seedPublishedBlueprint(
  d1: D1Database,
  projectId: string,
  runId: string
): Promise<{ versionId: string; revisionId: string }> {
  const versionId = newId('bpv');
  await d1
    .prepare(
      `INSERT INTO blueprint_versions
        (id, project_id, run_id, version_number, status, schema_version, ruleset_version,
         completeness, partial_reasons_json, summary_json, latest_revision_id, published_at, created_at)
       VALUES (?, ?, ?, 1, 'published', 'v1', 'r1', 'complete', ?, ?, NULL, ?, ?)`
    )
    .bind(versionId, projectId, runId, JSON.stringify([]), JSON.stringify({ pageCount: 1 }), nowIso(), nowIso())
    .run();

  const revisionId = newId('bprev');
  await d1
    .prepare(
      `INSERT INTO blueprint_revisions
        (id, blueprint_version_id, parent_revision_id, revision_number, revision_hash, created_by, created_at)
       VALUES (?, ?, NULL, 1, ?, ?, ?)`
    )
    .bind(revisionId, versionId, 'hash1', 'user1', nowIso())
    .run();

  await d1.prepare(`UPDATE blueprint_versions SET latest_revision_id = ? WHERE id = ?`).bind(revisionId, versionId).run();

  return { versionId, revisionId };
}

async function seedPage(
  d1: D1Database,
  revisionId: string,
  logicalPageId: string,
  pageJson: Record<string, unknown> = {}
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO blueprint_pages
        (row_id, blueprint_revision_id, logical_page_id, parent_logical_page_id, page_type, title, slug,
         primary_keyword_normalized, recommendation, approval, priority, confidence_label, page_json)
       VALUES (?, ?, ?, NULL, 'service', ?, ?, NULL, 'create', 'approved', 'high', 'high', ?)`
    )
    .bind(newId('bppage'), revisionId, logicalPageId, logicalPageId, `/${logicalPageId}`, JSON.stringify(pageJson))
    .run();
}

async function seedFixture(env: any) {
  const projectId = await seedProject(env.BLUEPRINT_DB, 'u1');
  const runId = await seedRun(env.BLUEPRINT_DB, projectId);
  const { versionId, revisionId } = await seedPublishedBlueprint(env.BLUEPRINT_DB, projectId, runId);
  await seedPage(env.BLUEPRINT_DB, revisionId, 'home');
  return { projectId, runId, versionId, revisionId };
}

describe('GET /api/blueprint/v1/projects/:id/blueprints/latest', () => {
  it('returns the latest published version + revision', async () => {
    const env = fakeEnv();
    const { projectId, versionId, revisionId } = await seedFixture(env);

    const res = await call(env, `/api/blueprint/v1/projects/${projectId}/blueprints/latest`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiSuccess<BlueprintLatestView>;
    expect(body.requestId).toBeTruthy();
    expect(body.data.versionId).toBe(versionId);
    expect(body.data.revision.id).toBe(revisionId);
  });

  it('returns the invisible 404 body for a project belonging to another organization', async () => {
    const env = fakeEnv();
    const { projectId } = await seedFixture(env);

    const res = await call(env, `/api/blueprint/v1/projects/${projectId}/blueprints/latest`, otherUser);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
  });

  it('returns 404 for a project with no published blueprint version', async () => {
    const env = fakeEnv();
    const projectId = await seedProject(env.BLUEPRINT_DB, 'u1');

    const res = await call(env, `/api/blueprint/v1/projects/${projectId}/blueprints/latest`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
  });
});

describe('GET /api/blueprint/v1/blueprint-revisions/:id/graph', () => {
  it('returns the revision id and its page nodes', async () => {
    const env = fakeEnv();
    const { revisionId } = await seedFixture(env);

    const res = await call(env, `/api/blueprint/v1/blueprint-revisions/${revisionId}/graph`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiSuccess<{ revisionId: string; nodes: BlueprintGraphNode[] }>;
    expect(body.data.revisionId).toBe(revisionId);
    expect(body.data.nodes.map((n) => n.logicalPageId)).toEqual(['home']);
  });

  it('returns the invisible 404 body for a revision belonging to another organization', async () => {
    const env = fakeEnv();
    const { revisionId } = await seedFixture(env);

    const res = await call(env, `/api/blueprint/v1/blueprint-revisions/${revisionId}/graph`, otherUser);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
  });
});

async function seedClusterWithDecisionReason(d1: D1Database, runId: string, clusterId: string, decisionReason: string): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO keyword_clusters (id, run_id, label, decision_reason)
       VALUES (?, ?, 'Test Cluster', ?)`
    )
    .bind(clusterId, runId, decisionReason)
    .run();
}

describe('GET /api/blueprint/v1/blueprint-revisions/:id/export', () => {
  it('returns 400 for an unknown format value', async () => {
    const env = fakeEnv();
    const { revisionId } = await seedFixture(env);

    const res = await call(env, `/api/blueprint/v1/blueprint-revisions/${revisionId}/export?format=weird`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_input');
  });

  it('returns the invisible 404 body for a revision belonging to another organization', async () => {
    const env = fakeEnv();
    const { revisionId } = await seedFixture(env);

    const res = await call(env, `/api/blueprint/v1/blueprint-revisions/${revisionId}/export`, otherUser);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
  });

  describe('format=csv', () => {
    it('returns a csv attachment with the exact header row and the page\'s decision reason', async () => {
      const env = fakeEnv();
      const { projectId, runId, revisionId } = await seedFixture(env);
      await seedClusterWithDecisionReason(env.BLUEPRINT_DB, runId, 'kcl_export', 'Primary landing page for the head keyword.');
      await env.BLUEPRINT_DB
        .prepare(`UPDATE blueprint_pages SET page_json = ? WHERE blueprint_revision_id = ? AND logical_page_id = 'home'`)
        .bind(JSON.stringify({ clusterIds: ['kcl_export'] }), revisionId)
        .run();

      const res = await call(env, `/api/blueprint/v1/blueprint-revisions/${revisionId}/export?format=csv`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
      expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="blueprint-${projectId}.csv"`);
      const csv = await res.text();
      const lines = csv.split('\r\n');
      expect(lines[0]).toBe(
        'slug,title,page_type,primary_keyword,volume,intent,parent_slug,recommendation,priority,supporting_keywords,decision_reason'
      );
      expect(lines[1]).toContain('Primary landing page for the head keyword.');
    });

    it('defaults to html when no format is given but csv is explicit opt-in', async () => {
      const env = fakeEnv();
      const { revisionId } = await seedFixture(env);

      const res = await call(env, `/api/blueprint/v1/blueprint-revisions/${revisionId}/export`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    });
  });

  describe('format=html', () => {
    it('returns an inline html document containing the doctype and the project name', async () => {
      const env = fakeEnv();
      const { revisionId } = await seedFixture(env);

      const res = await call(env, `/api/blueprint/v1/blueprint-revisions/${revisionId}/export?format=html`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('Content-Disposition')).toBeNull();
      const html = await res.text();
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('Test Project');
    });

    it('escapes a hostile page title instead of rendering it raw', async () => {
      const env = fakeEnv();
      const { revisionId } = await seedFixture(env);
      await env.BLUEPRINT_DB
        .prepare(`UPDATE blueprint_pages SET title = ? WHERE blueprint_revision_id = ? AND logical_page_id = 'home'`)
        .bind('<script>alert(1)</script>', revisionId)
        .run();

      const res = await call(env, `/api/blueprint/v1/blueprint-revisions/${revisionId}/export?format=html`);

      const html = await res.text();
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });
});

describe('GET /api/blueprint/v1/blueprint-revisions/:id/pages/:pageId', () => {
  it('returns the page detail composed from node + evidence', async () => {
    const env = fakeEnv();
    const { revisionId } = await seedFixture(env);

    const res = await call(env, `/api/blueprint/v1/blueprint-revisions/${revisionId}/pages/home`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiSuccess<BlueprintPageDetail>;
    expect(body.data.node.logicalPageId).toBe('home');
    expect(body.data.fanOut).toEqual({ status: 'pending_phase_5' });
  });

  it('returns the invisible 404 body for a revision belonging to another organization', async () => {
    const env = fakeEnv();
    const { revisionId } = await seedFixture(env);

    const res = await call(env, `/api/blueprint/v1/blueprint-revisions/${revisionId}/pages/home`, otherUser);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
  });

  it('returns 404 for an unknown pageId', async () => {
    const env = fakeEnv();
    const { revisionId } = await seedFixture(env);

    const res = await call(env, `/api/blueprint/v1/blueprint-revisions/${revisionId}/pages/does-not-exist`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
  });
});
