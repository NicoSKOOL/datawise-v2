import { describe, it, expect } from 'vitest';
import { fakeKv, makeMcpTestEnv, seedUser, seedSession } from './test-support';
import { authMiddleware } from '../middleware/auth';
import { asWorkerEnv } from './env';

describe('test support', () => {
  it('fakeKv lists by prefix and reads json', async () => {
    const store = new Map<string, string>();
    const kv = fakeKv(store);
    await kv.put('grant:u1:a', JSON.stringify({ id: 'a' }));
    await kv.put('grant:u1:b', JSON.stringify({ id: 'b' }));
    await kv.put('grant:u2:c', JSON.stringify({ id: 'c' }));
    const listed = await kv.list({ prefix: 'grant:u1:' });
    expect(listed.keys.map((k) => k.name).sort()).toEqual(['grant:u1:a', 'grant:u1:b']);
    expect(listed.list_complete).toBe(true);
    expect(await kv.get('grant:u1:a', { type: 'json' })).toEqual({ id: 'a' });
    expect(await kv.get('grant:u1:a', 'json')).toEqual({ id: 'a' });
  });

  it('makeMcpTestEnv exposes OAUTH_KV, OAUTH_PROVIDER and a working session seed', async () => {
    const { env } = makeMcpTestEnv();
    expect(env.OAUTH_KV).toBeDefined();
    expect(typeof env.OAUTH_PROVIDER.parseAuthRequest).toBe('function');
    const userId = await seedUser(env, { email: 's@test.dev' });
    const bearer = await seedSession(env, userId);
    const user = await authMiddleware(new Request('https://mcp.test/x', { headers: { Authorization: `Bearer ${bearer}` } }), asWorkerEnv(env));
    expect(user?.id).toBe(userId);
  });
});
