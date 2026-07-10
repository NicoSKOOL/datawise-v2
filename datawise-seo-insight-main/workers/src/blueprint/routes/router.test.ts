import { describe, it, expect } from 'vitest';
import { handleBlueprintRequest, isBlueprintAuthorized } from './router';

const adminUser = { id: 'u1', email: 'nico@airankingskool.com', is_admin: true } as any;
const memberUser = { id: 'u2', email: 'member@example.com', is_admin: false } as any;

function fakeEnv(): any {
  return {
    BLUEPRINT_DB: { prepare: () => ({ first: async () => ({ value: '0' }) }) },
    BLUEPRINT_KV: { put: async () => undefined },
  };
}
const req = (path: string) => new Request(`https://api.test${path}`);

describe('isBlueprintAuthorized', () => {
  it('allows admin flag or admin email, denies everyone else', () => {
    expect(isBlueprintAuthorized(adminUser)).toBe(true);
    expect(isBlueprintAuthorized(memberUser)).toBe(false);
    expect(isBlueprintAuthorized(null)).toBe(false);
  });
});

describe('handleBlueprintRequest', () => {
  it('returns 404 for non-admin (feature invisible)', async () => {
    const res = await handleBlueprintRequest(req('/api/blueprint/v1/health'), fakeEnv(), memberUser, '/api/blueprint/v1/health', 'GET');
    expect(res.status).toBe(404);
  });
  it('serves health checks to admin', async () => {
    const res = await handleBlueprintRequest(req('/api/blueprint/v1/health'), fakeEnv(), adminUser, '/api/blueprint/v1/health', 'GET');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.checks.d1).toContain('ok');
    expect(body.checks.kv).toBe('ok');
  });
  it('404s unknown blueprint paths even for admin', async () => {
    const res = await handleBlueprintRequest(req('/api/blueprint/v1/nope'), fakeEnv(), adminUser, '/api/blueprint/v1/nope', 'GET');
    expect(res.status).toBe(404);
  });
});
