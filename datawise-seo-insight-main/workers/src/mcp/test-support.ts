import type Database from 'better-sqlite3';
import { createTestDb } from '../test-support/d1';
import type { McpEnv } from './env';

// In-memory KV that honours get/put/delete and ignores TTLs. Tests that care
// about expiry set entries directly on kvStore.
export function fakeKv(store: Map<string, string>): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  } as unknown as KVNamespace;
}

export function makeMcpTestEnv(): { env: McpEnv; kvStore: Map<string, string>; raw: Database.Database } {
  const { d1, raw } = createTestDb();
  const kvStore = new Map<string, string>();
  const env: McpEnv = {
    DB: d1,
    KV: fakeKv(kvStore),
    DATAFORSEO_EMAIL: 'dfs@test',
    DATAFORSEO_PASSWORD: 'secret',
    ENCRYPTION_KEY: 'test-key',
    FRONTEND_URL: 'https://app.test',
    ADMIN_EMAILS: 'nico@airankingskool.com',
    MCP_PUBLIC_URL: 'http://localhost:8788',
  };
  return { env, kvStore, raw };
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
