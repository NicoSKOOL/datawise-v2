import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api', () => ({ getSessionToken: () => 'sess-123' }));

import {
  mcpApi,
  claudeCodeCommand,
  MCP_SERVER_URL,
  McpApiError,
  getAuthorizeRequest,
  approveAuthorizeRequest,
  denyAuthorizeRequest,
  revokeMcpGrant,
  claudeCodeOauthCommand,
} from '@/lib/mcp';

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

describe('consent and grant calls', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('mcpApi throws McpApiError carrying status and code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'expired', message: 'Gone.' }), { status: 410 })));
    const err = await getAuthorizeRequest('abc').catch((e) => e);
    expect(err).toBeInstanceOf(McpApiError);
    expect(err.status).toBe(410);
    expect(err.code).toBe('expired');
    expect(err.message).toBe('Gone.');
  });

  it('calls the consent endpoints with the request nonce', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ redirect_to: 'https://claude.ai/cb?code=1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getAuthorizeRequest('n1');
    await approveAuthorizeRequest('n1');
    await denyAuthorizeRequest('n1');
    await revokeMcpGrant('g1');
    const calls = fetchMock.mock.calls.map(([url, init]: any) => [String(url).replace(/^https?:\/\/[^/]+/, ''), init.method, init.body]);
    expect(calls).toEqual([
      ['/account/authorize-request?req=n1', 'GET', undefined],
      ['/account/authorize-request/approve', 'POST', JSON.stringify({ req: 'n1' })],
      ['/account/authorize-request/deny', 'POST', JSON.stringify({ req: 'n1' })],
      ['/account/grants/g1', 'DELETE', undefined],
    ]);
  });

  it('claudeCodeOauthCommand has no token in it', () => {
    expect(claudeCodeOauthCommand()).toBe(`claude mcp add --transport http datawise ${MCP_SERVER_URL}`);
  });
});
