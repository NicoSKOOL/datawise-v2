import { describe, it, expect } from 'vitest';

import {
  handleActivityOverview, handleActivityFeatures, handleActivityUsers,
  handleActivityFunnel, handleActivityEvents, handleActivityUserDetail,
  handleActivitySummary,
} from './admin-activity';

const nonAdmin = { id: 'u1', email: 'user@example.com', is_admin: 0 } as any;
const env = { DB: null } as any; // must never be touched for a non-admin

function req(url = 'https://api/x', method = 'GET') {
  return new Request(url, { method, ...(method === 'POST' ? { body: '{}' } : {}) });
}

describe('admin activity authz', () => {
  it('rejects non-admin users on every endpoint without touching the DB', async () => {
    const responses = await Promise.all([
      handleActivityOverview(req(), env, nonAdmin),
      handleActivityFeatures(req(), env, nonAdmin),
      handleActivityUsers(req(), env, nonAdmin),
      handleActivityFunnel(req(), env, nonAdmin),
      handleActivityEvents(req(), env, nonAdmin),
      handleActivityUserDetail(req(), env, nonAdmin, 'u2'),
      handleActivitySummary(req('https://api/x', 'POST'), env, nonAdmin),
    ]);
    // env.DB is null, so any DB access would have thrown instead of returning.
    for (const res of responses) expect(res.status).toBe(403);
  });

  it('rejects malformed date ranges for admins before querying', async () => {
    const admin = { id: 'a1', email: 'nico@airankingskool.com', is_admin: 1 } as any;
    const res = await handleActivityOverview(
      req('https://api/x?from=not-a-date&to=2026-07-02'), env, admin,
    );
    expect(res.status).toBe(400);
  });
});
