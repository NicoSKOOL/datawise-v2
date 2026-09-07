import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv, seedUser } from './test-support';
import { createApiToken } from './tokens';

vi.mock('./server', () => ({
  handleMcpRequest: vi.fn(async (_req: Request, _env: unknown, _ctx: unknown, identity: any) => new Response(JSON.stringify({ mcp: true, email: identity.email }))),
}));
vi.mock('./account', () => ({
  handleAccountRequest: vi.fn(async () => new Response('account')),
}));

import worker from './index';
import { handleMcpRequest } from './server';

const ctx = {} as ExecutionContext;

describe('datawise-mcp worker', () => {
  it('health', async () => {
    const { env } = makeMcpTestEnv();
    const res = await worker.fetch(new Request('https://mcp.test/health'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'datawise-mcp' });
  });

  it('401 with WWW-Authenticate when the bearer is missing, malformed, or unknown', async () => {
    const { env } = makeMcpTestEnv();
    const headerVariants: Record<string, string>[] = [{}, { Authorization: 'Bearer nope' }, { Authorization: 'Bearer dwmcp_' + 'a'.repeat(40) }];
    for (const headers of headerVariants) {
      const res = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'POST', headers }), env, ctx);
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    }
    expect(handleMcpRequest).not.toHaveBeenCalled();
  });

  it('routes a valid token to the MCP handler with the loaded identity', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { email: 'm@test.dev' });
    const { token } = await createApiToken(env, userId, 'cli');
    const res = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }), env, ctx);
    expect(await res.json()).toEqual({ mcp: true, email: 'm@test.dev' });
  });

  it('rejects a valid token whose user is banned', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { banned: 1 });
    const { token } = await createApiToken(env, userId, 'cli');
    const res = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }), env, ctx);
    expect(res.status).toBe(401);
  });

  it('delegates /account/* and 404s everything else', async () => {
    const { env } = makeMcpTestEnv();
    expect(await (await worker.fetch(new Request('https://mcp.test/account/tokens'), env, ctx)).text()).toBe('account');
    expect((await worker.fetch(new Request('https://mcp.test/nope'), env, ctx)).status).toBe(404);
  });

  it('scheduled purge deletes mcp_calls older than 30 days', async () => {
    const { env, raw } = makeMcpTestEnv();
    raw.prepare("INSERT INTO mcp_calls (user_id, tool, auth_kind, created_at) VALUES ('u','t','api_token', datetime('now','-31 days')), ('u','t','api_token', datetime('now'))").run();
    await worker.scheduled({} as ScheduledEvent, env, ctx);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM mcp_calls').get() as any).n).toBe(1);
  });
});
