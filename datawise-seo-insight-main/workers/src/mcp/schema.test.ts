import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';

describe('mcp schema', () => {
  it('creates the three MCP tables', () => {
    const { raw } = createTestDb();
    const names = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('api_tokens','mcp_usage_daily','mcp_calls') ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(names).toEqual(['api_tokens', 'mcp_calls', 'mcp_usage_daily']);
  });

  it('api_tokens has the columns tokens.ts relies on', () => {
    const { raw } = createTestDb();
    const cols = raw.prepare('PRAGMA table_info(api_tokens)').all().map((r: any) => r.name);
    for (const c of ['id', 'user_id', 'name', 'token_hash', 'token_suffix', 'scopes', 'created_at', 'last_used_at', 'expires_at', 'revoked_at']) {
      expect(cols).toContain(c);
    }
  });
});
