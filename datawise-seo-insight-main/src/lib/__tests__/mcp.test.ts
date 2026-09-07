import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api', () => ({ getSessionToken: () => 'sess-123' }));

import { mcpApi, claudeCodeCommand, MCP_SERVER_URL } from '@/lib/mcp';

describe('mcpApi', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends the session bearer, JSON body, and omits credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await mcpApi('/account/tokens', { method: 'POST', body: { name: 'x' } });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe(`${MCP_SERVER_URL.replace(/\/mcp$/, '')}/account/tokens`);
    expect(init.headers.Authorization).toBe('Bearer sess-123');
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body)).toEqual({ name: 'x' });
  });

  it('throws the server message on error responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'token_limit', message: 'Revoke one first.' }), { status: 409 })));
    await expect(mcpApi('/account/tokens', { method: 'POST', body: {} })).rejects.toThrow('Revoke one first.');
  });
});

describe('claudeCodeCommand', () => {
  it('produces the documented claude mcp add command', () => {
    expect(claudeCodeCommand('dwmcp_abc')).toBe(
      `claude mcp add --transport http datawise ${MCP_SERVER_URL} --header "Authorization: Bearer dwmcp_abc"`,
    );
  });
});
