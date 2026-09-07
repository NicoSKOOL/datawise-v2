import { describe, it, expect } from 'vitest';
import { makeMcpTestEnv, seedUser } from './test-support';
import { loadIdentity, hasMemberAccess, checkAccess, denialMessage } from './access';

const tok = (userId: string) => ({ userId, tokenId: 't1', tokenName: 'laptop' });

describe('access', () => {
  it('loads identity from the users row', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { email: 'a@test.dev', subscription_tier: 'pro', is_community_member: 0 });
    const id = await loadIdentity(env, tok(userId));
    expect(id).toMatchObject({ userId, email: 'a@test.dev', tier: 'pro', isAdmin: false, isCommunityMember: false, tokenName: 'laptop', authKind: 'api_token' });
    expect(id!.defaultLocationCode).toBe(2840);
    expect(id!.defaultLanguageCode).toBe('en');
  });

  it('returns null for banned or missing users', async () => {
    const { env } = makeMcpTestEnv();
    const banned = await seedUser(env, { banned: 1 });
    expect(await loadIdentity(env, tok(banned))).toBeNull();
    expect(await loadIdentity(env, tok('ghost'))).toBeNull();
  });

  it('member access: admin, community member, pro, community tier pass; free fails', async () => {
    const { env } = makeMcpTestEnv();
    const cases: Array<[Parameters<typeof seedUser>[1], boolean]> = [
      [{ subscription_tier: 'free', is_community_member: 0 }, false],
      [{ subscription_tier: 'pro', is_community_member: 0 }, true],
      [{ subscription_tier: 'community', is_community_member: 0 }, true],
      [{ subscription_tier: 'free', is_community_member: 1 }, true],
      [{ subscription_tier: 'free', is_community_member: 0, is_admin: 1 }, true],
      [{ subscription_tier: 'free', is_community_member: 0, email: 'nico@airankingskool.com' }, true],
    ];
    for (const [overrides, expected] of cases) {
      const id = await loadIdentity(env, tok(await seedUser(env, overrides)));
      expect(hasMemberAccess(id!)).toBe(expected);
    }
  });

  it('checkAccess order: paused, then membership, then allowlist', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    const member = (await loadIdentity(env, tok(await seedUser(env, { email: 'm@test.dev' }))))!;
    const free = (await loadIdentity(env, tok(await seedUser(env, { subscription_tier: 'free', is_community_member: 0 }))))!;
    const admin = (await loadIdentity(env, tok(await seedUser(env, { is_admin: 1 }))))!;

    expect(await checkAccess(env, member)).toBeNull();
    expect(await checkAccess(env, free)).toBe('not_member');

    kvStore.set('mcp-allowlist', 'someone@else.dev, other@x.dev');
    expect(await checkAccess(env, member)).toBe('early_access');
    expect(await checkAccess(env, admin)).toBeNull();
    kvStore.set('mcp-allowlist', 'M@test.dev');
    expect(await checkAccess(env, member)).toBeNull();

    kvStore.set('mcp-paused', '1');
    expect(await checkAccess(env, admin)).toBe('paused');
  });

  it('denial messages never mention join-for-free', () => {
    for (const d of ['paused', 'not_member', 'early_access'] as const) {
      expect(denialMessage(d).toLowerCase()).not.toContain('free');
    }
  });
});
