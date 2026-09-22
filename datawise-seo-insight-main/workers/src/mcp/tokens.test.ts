import { describe, it, expect } from 'vitest';
import { makeMcpTestEnv, seedUser } from './test-support';
import {
  TOKEN_PREFIX, MAX_ACTIVE_TOKENS, TokenLimitError,
  generateToken, hashToken, createApiToken, validateApiToken, listApiTokens, revokeApiToken,
} from './tokens';

describe('tokens', () => {
  it('generates prefixed, 46-char, base62 tokens', () => {
    const t = generateToken();
    expect(t.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(t).toHaveLength(TOKEN_PREFIX.length + 40);
    expect(/^[A-Za-z0-9]+$/.test(t.slice(TOKEN_PREFIX.length))).toBe(true);
    expect(generateToken()).not.toBe(t);
  });

  it('stores only the hash and returns the secret once', async () => {
    const { env, raw } = makeMcpTestEnv();
    const userId = await seedUser(env);
    const created = await createApiToken(env, userId, 'Claude Code');
    expect(created.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(created.token_suffix).toBe(created.token.slice(-4));
    const row = raw.prepare('SELECT token_hash FROM api_tokens WHERE id = ?').get(created.id) as any;
    expect(row.token_hash).toBe(await hashToken(created.token));
    expect(row.token_hash).not.toContain(created.token);
  });

  it('validates a live token, caches it in KV, and rejects garbage', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    const userId = await seedUser(env);
    const created = await createApiToken(env, userId, 'laptop');
    const id = await validateApiToken(env, created.token);
    expect(id).toEqual({ userId, tokenId: created.id, tokenName: 'laptop' });
    expect(kvStore.has('mcptoken:' + (await hashToken(created.token)))).toBe(true);
    expect(await validateApiToken(env, 'dwmcp_nope')).toBeNull();
    expect(await validateApiToken(env, '')).toBeNull();
  });

  it('revocation removes the KV entry and invalidates the token', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    const userId = await seedUser(env);
    const created = await createApiToken(env, userId, 'x');
    await validateApiToken(env, created.token);
    expect(await revokeApiToken(env, userId, created.id)).toBe(true);
    expect(kvStore.size).toBe(0);
    expect(await validateApiToken(env, created.token)).toBeNull();
    expect(await revokeApiToken(env, 'someone-else', created.id)).toBe(false);
  });

  it('caps active tokens per user and lists only active ones', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env);
    for (let i = 0; i < MAX_ACTIVE_TOKENS; i++) await createApiToken(env, userId, `t${i}`);
    await expect(createApiToken(env, userId, 'one too many')).rejects.toBeInstanceOf(TokenLimitError);
    const list = await listApiTokens(env, userId);
    expect(list).toHaveLength(MAX_ACTIVE_TOKENS);
    await revokeApiToken(env, userId, list[0].id);
    expect(await listApiTokens(env, userId)).toHaveLength(MAX_ACTIVE_TOKENS - 1);
    await expect(createApiToken(env, userId, 'fits now')).resolves.toBeTruthy();
  });

  it('rejects expired tokens', async () => {
    const { env, raw } = makeMcpTestEnv();
    const userId = await seedUser(env);
    const created = await createApiToken(env, userId, 'old');
    raw.prepare("UPDATE api_tokens SET expires_at = datetime('now', '-1 day') WHERE id = ?").run(created.id);
    expect(await validateApiToken(env, created.token)).toBeNull();
  });
});
