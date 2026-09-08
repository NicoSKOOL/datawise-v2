import type Database from 'better-sqlite3';
import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { createTestDb } from '../test-support/d1';
import type { McpEnv } from './env';
import { oauthOptions } from './oauth';

// In-memory KV that honours get (text or json), put, delete and list-by-prefix
// and ignores TTLs. Tests that care about expiry set entries directly on the
// store. The OAuth provider needs list(); everything else only needs get/put.
export function fakeKv(store: Map<string, string>): KVNamespace {
  const readType = (arg: unknown): string | undefined =>
    typeof arg === 'string' ? arg : (arg as { type?: string } | undefined)?.type;
  return {
    get: async (key: string, arg?: unknown) => {
      const v = store.get(key);
      if (v == null) return null;
      return readType(arg) === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async (opts: { prefix?: string; limit?: number; cursor?: string } = {}) => {
      const names = [...store.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix)).sort();
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const limit = opts.limit ?? 1000;
      const page = names.slice(start, start + limit);
      const done = start + limit >= names.length;
      return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + limit) };
    },
  } as unknown as KVNamespace;
}

export function makeMcpTestEnv(): { env: McpEnv; kvStore: Map<string, string>; oauthStore: Map<string, string>; raw: Database.Database } {
  const { d1, raw } = createTestDb();
  const kvStore = new Map<string, string>();
  const oauthStore = new Map<string, string>();
  const publicUrl = 'http://localhost:8788';
  const env = {
    DB: d1,
    KV: fakeKv(kvStore),
    OAUTH_KV: fakeKv(oauthStore),
    DATAFORSEO_EMAIL: 'dfs@test',
    DATAFORSEO_PASSWORD: 'secret',
    ENCRYPTION_KEY: 'test-key',
    FRONTEND_URL: 'https://app.test',
    ADMIN_EMAILS: 'nico@airankingskool.com',
    MCP_PUBLIC_URL: publicUrl,
  } as McpEnv;
  env.OAUTH_PROVIDER = getOAuthApi(oauthOptions(publicUrl), env);
  return { env, kvStore, oauthStore, raw };
}

export interface SeedUser {
  id: string;
  email: string;
  subscription_tier: 'free' | 'pro' | 'community';
  is_community_member: 0 | 1;
  is_admin: 0 | 1;
  banned: 0 | 1;
}

export async function seedUser(env: McpEnv, overrides: Partial<SeedUser> = {}): Promise<string> {
  const u: SeedUser = {
    id: 'u_' + Math.random().toString(36).slice(2, 10),
    email: `${Math.random().toString(36).slice(2, 8)}@test.dev`,
    subscription_tier: 'community',
    is_community_member: 1,
    is_admin: 0,
    banned: 0,
    ...overrides,
  };
  await env.DB.prepare(
    'INSERT INTO users (id, email, subscription_tier, is_community_member, is_admin, banned) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(u.id, u.email, u.subscription_tier, u.is_community_member, u.is_admin, u.banned).run();
  return u.id;
}

// A DataWise session the real authMiddleware accepts (KV fast path).
export async function seedSession(env: McpEnv, userId: string): Promise<string> {
  const bearer = 'sess_' + Math.random().toString(36).slice(2, 14);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer));
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.KV.put(`session:${hex}`, userId);
  return bearer;
}
