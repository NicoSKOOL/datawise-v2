import { describe, it, expect } from 'vitest';
import { isAdmin } from './admin';
import type { AuthUser } from '../auth/google';

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    google_id: 'g1',
    email: 'someone@example.com',
    name: 'Someone',
    avatar_url: '',
    subscription_tier: 'free',
    is_community_member: false,
    is_admin: false,
    credits_used: 0,
    ...overrides,
  } as AuthUser;
}

describe('isAdmin', () => {
  it('is true when user.is_admin is set, regardless of env', () => {
    expect(isAdmin(makeUser({ is_admin: true }))).toBe(true);
    expect(isAdmin(makeUser({ is_admin: true }), { ADMIN_EMAILS: '' })).toBe(true);
  });

  it('falls back to the hardcoded admin email when env is absent', () => {
    expect(isAdmin(makeUser({ email: 'nico@airankingskool.com' }))).toBe(true);
    expect(isAdmin(makeUser({ email: 'nico@airankingskool.com' }), undefined)).toBe(true);
  });

  it('is false for a non-admin email not present in the env allowlist', () => {
    expect(isAdmin(makeUser({ email: 'random@nobody.com' }), { ADMIN_EMAILS: 'a@x.com,b@y.com' })).toBe(false);
  });

  it('is true for an email present in a two-entry ADMIN_EMAILS env string', () => {
    expect(
      isAdmin(makeUser({ email: 'b@y.com' }), { ADMIN_EMAILS: 'a@x.com,b@y.com' })
    ).toBe(true);
  });

  it('is case-insensitive and trims whitespace in the allowlist', () => {
    expect(
      isAdmin(makeUser({ email: 'B@Y.com' }), { ADMIN_EMAILS: ' a@x.com , b@y.com ' })
    ).toBe(true);
  });
});
