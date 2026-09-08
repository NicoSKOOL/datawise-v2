import { useQuery } from '@tanstack/react-query';
import { getSessionToken } from '@/lib/api';

// The MCP worker is a separate deployment (spec 3.1). Same rule as
// VITE_API_URL: never put a localhost override in .env.local.
export const MCP_BASE = import.meta.env.VITE_MCP_URL || 'http://localhost:8788';
export const MCP_SERVER_URL = `${MCP_BASE}/mcp`;

export interface McpToken {
  id: string;
  name: string;
  token_suffix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface McpUsage {
  access: boolean;
  denial: 'paused' | 'not_member' | 'early_access' | null;
  day: string;
  spent_usd: number;
  cap_usd: number | null;
  calls: number;
  resets_at: string;
  mcp_url: string;
  max_tokens: number;
}

export interface McpGrant {
  id: string;
  client_id: string;
  client_name: string;
  created_at: string;
  scope: string[];
}

export interface AuthorizeRequestInfo {
  client_name: string;
  client_uri: string | null;
  redirect_host: string;
  loopback: boolean;
  scope: string[];
  email: string;
  access: boolean;
  denial: McpUsage['denial'];
  denial_message: string | null;
}

export class McpApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'McpApiError';
    this.status = status;
    this.code = code;
  }
}

interface McpApiOptions {
  method?: string;
  body?: unknown;
}

export async function mcpApi<T = unknown>(path: string, options: McpApiOptions = {}): Promise<T> {
  const token = getSessionToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${MCP_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'omit',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new McpApiError(data.message || data.error || `Request failed (${response.status})`, response.status, data.error ?? null);
  }
  return response.json() as Promise<T>;
}

export function claudeCodeCommand(token: string): string {
  return `claude mcp add --transport http datawise ${MCP_SERVER_URL} --header "Authorization: Bearer ${token}"`;
}

export const MCP_TOKENS_KEY = ['mcp', 'tokens'] as const;
export const MCP_USAGE_KEY = ['mcp', 'usage'] as const;

export function useMcpTokens() {
  return useQuery({ queryKey: MCP_TOKENS_KEY, queryFn: () => mcpApi<{ tokens: McpToken[] }>('/account/tokens').then((r) => r.tokens) });
}

export function useMcpUsage() {
  return useQuery({ queryKey: MCP_USAGE_KEY, queryFn: () => mcpApi<McpUsage>('/account/usage'), staleTime: 30_000 });
}

export function createMcpToken(name: string): Promise<McpToken & { token: string }> {
  return mcpApi<McpToken & { token: string }>('/account/tokens', { method: 'POST', body: { name } });
}

export async function revokeMcpToken(id: string): Promise<void> {
  await mcpApi(`/account/tokens/${id}`, { method: 'DELETE' });
}

// Stage 2: OAuth sign-in from Claude Code. No token in the command; Claude
// Code opens the browser for consent when you run /mcp.
export function claudeCodeOauthCommand(): string {
  return `claude mcp add --transport http datawise ${MCP_SERVER_URL}`;
}

export const MCP_GRANTS_KEY = ['mcp', 'grants'] as const;

export function useMcpGrants() {
  return useQuery({ queryKey: MCP_GRANTS_KEY, queryFn: () => mcpApi<{ grants: McpGrant[] }>('/account/grants').then((r) => r.grants) });
}

export async function revokeMcpGrant(id: string): Promise<void> {
  await mcpApi(`/account/grants/${id}`, { method: 'DELETE' });
}

export function getAuthorizeRequest(req: string): Promise<AuthorizeRequestInfo> {
  return mcpApi<AuthorizeRequestInfo>(`/account/authorize-request?req=${encodeURIComponent(req)}`);
}

export function approveAuthorizeRequest(req: string): Promise<{ redirect_to: string }> {
  return mcpApi<{ redirect_to: string }>('/account/authorize-request/approve', { method: 'POST', body: { req } });
}

export function denyAuthorizeRequest(req: string): Promise<{ redirect_to: string }> {
  return mcpApi<{ redirect_to: string }>('/account/authorize-request/deny', { method: 'POST', body: { req } });
}
