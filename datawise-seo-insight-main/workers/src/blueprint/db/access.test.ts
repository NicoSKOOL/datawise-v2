import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from './util';
import { actorFromUser, assertProjectAccess, assertRunAccess, type Actor } from './access';
import { NotFoundError } from '../domain/api-errors';
import type { AuthUser } from '../../auth/google';

async function seedProject(d1: D1Database, overrides: Partial<{
  id: string;
  organizationId: string;
  deletedAt: string | null;
}> = {}) {
  const id = overrides.id ?? newId('proj');
  const organizationId = overrides.organizationId ?? 'org1';
  await d1
    .prepare(
      `INSERT INTO projects
        (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, organizationId, 'user1', 'Test Project', 'greenfield', 'US', 'en', nowIso(), nowIso(), overrides.deletedAt ?? null)
    .run();
  return id;
}

async function seedRun(d1: D1Database, projectId: string) {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, projectId, 'brief1', 'estimate1', 'draft', 'user1', nowIso())
    .run();
  return id;
}

function actorFor(organizationId: string): Actor {
  return { userId: 'user1', organizationId, roles: ['owner'] };
}

describe('actorFromUser', () => {
  it('derives a single-tenant actor where organizationId equals the user id', () => {
    const user = { id: 'user1', google_id: 'g1', email: 'a@b.com', name: 'A', avatar_url: '', subscription_tier: 'free', is_community_member: false, credits_used: 0 } as AuthUser;
    const actor = actorFromUser(user);
    expect(actor.userId).toBe('user1');
    expect(actor.organizationId).toBe('user1');
    expect(actor.roles).toContain('owner');
  });

  it('grants the admin role when the user is flagged as admin', () => {
    const user = { id: 'user1', google_id: 'g1', email: 'a@b.com', name: 'A', avatar_url: '', subscription_tier: 'free', is_community_member: false, is_admin: true, credits_used: 0 } as AuthUser;
    const actor = actorFromUser(user);
    expect(actor.roles).toContain('admin');
  });
});

describe('assertProjectAccess', () => {
  it('returns the project row for the owning organization', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, { organizationId: 'org1' });
    const row = await assertProjectAccess(d1, actorFor('org1'), projectId);
    expect(row.id).toBe(projectId);
    expect(row.organization_id).toBe('org1');
  });

  it('throws NotFoundError for a cross-tenant actor', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, { organizationId: 'org1' });
    await expect(assertProjectAccess(d1, actorFor('org2'), projectId)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError for a soft-deleted project', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, { organizationId: 'org1', deletedAt: nowIso() });
    await expect(assertProjectAccess(d1, actorFor('org1'), projectId)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError for a missing project id', async () => {
    const { d1 } = createTestDb();
    await expect(assertProjectAccess(d1, actorFor('org1'), newId('proj'))).rejects.toThrow(NotFoundError);
  });
});

describe('assertRunAccess', () => {
  it('returns the run row when the parent project belongs to the actor org', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, { organizationId: 'org1' });
    const runId = await seedRun(d1, projectId);
    const row = await assertRunAccess(d1, actorFor('org1'), runId);
    expect(row.id).toBe(runId);
    expect(row.project_id).toBe(projectId);
  });

  it('throws NotFoundError when the parent project belongs to a different organization', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, { organizationId: 'org1' });
    const runId = await seedRun(d1, projectId);
    await expect(assertRunAccess(d1, actorFor('org2'), runId)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the parent project is soft-deleted', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, { organizationId: 'org1', deletedAt: nowIso() });
    const runId = await seedRun(d1, projectId);
    await expect(assertRunAccess(d1, actorFor('org1'), runId)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError for a missing run id', async () => {
    const { d1 } = createTestDb();
    await expect(assertRunAccess(d1, actorFor('org1'), newId('run'))).rejects.toThrow(NotFoundError);
  });
});
