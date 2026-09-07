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
    throw new Error(data.message || data.error || `Request failed (${response.status})`);
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
