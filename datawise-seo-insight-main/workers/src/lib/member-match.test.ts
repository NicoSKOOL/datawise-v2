import { describe, it, expect } from 'vitest';
import {
  MATCH_THRESHOLD,
  scoreMatch,
  suggestMembers,
  type BlockedAccount,
  type RosterCandidate,
} from './member-match';

function account(over: Partial<BlockedAccount> = {}): BlockedAccount {
  return {
    id: 'u1',
    email: 'someone@gmail.com',
    name: 'Someone',
    created_at: '2026-08-17 00:40:38',
    credits_used: 5,
    ...over,
  };
}

function member(over: Partial<RosterCandidate> = {}): RosterCandidate {
  return {
    email: 'member@gmail.com',
    first_name: 'Member',
    last_name: 'Person',
    joined_date: '2026-08-17 00:51:16',
    ...over,
  };
}

describe('scoreMatch', () => {
  it('flags the real Taz Street pair above threshold', () => {
    const { score, reasons } = scoreMatch(
      account({ email: 'seostreetconsulting@gmail.com', name: 'Taz', created_at: '2026-08-17 00:40:38' }),
      member({ email: 'positiveoutloud@gmail.com', first_name: 'Taz', last_name: 'Street', joined_date: '2026-08-17 00:51:16' }),
    );
    expect(score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(reasons.join(' ')).toContain('street');
    expect(reasons.join(' ')).toContain('Skool');
  });

  it('flags a shared custom domain pair above threshold', () => {
    const { score, reasons } = scoreMatch(
      account({ email: 'principal@berelvant.com', name: 'Renzo Proano' }),
      member({ email: 'renzo@berelvant.com', first_name: 'Renzo', last_name: 'Proano' }),
    );
    expect(score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(reasons.join(' ')).toContain('berelvant.com');
  });

  it('keeps a first-name-only collision below threshold', () => {
    // Three unrelated Michaels was the dominant false positive in the first
    // weighting, where a shared first name alone scored as high as a surname.
    const { score } = scoreMatch(
      account({ email: 'm.rapino@gmail.com', name: 'Michael Rapino', created_at: '2026-01-05 10:00:00' }),
      member({ email: 'mwhe865050@gmail.com', first_name: 'Michael', last_name: 'Wheaton', joined_date: '2026-06-02 10:00:00' }),
    );
    expect(score).toBeLessThan(MATCH_THRESHOLD);
  });

  it('does not award domain points for shared freemail providers', () => {
    const shared = scoreMatch(
      account({ email: 'aaa@gmail.com', name: 'Aaa', created_at: '2026-01-05 10:00:00' }),
      member({ email: 'bbb@gmail.com', first_name: 'Bbb', last_name: 'Ccc', joined_date: '2026-06-02 10:00:00' }),
    );
    expect(shared.score).toBe(0);
  });

  it('ignores agency-boilerplate tokens in the email local part', () => {
    // 'seo' and 'consulting' must not match a member actually named that way.
    const { score } = scoreMatch(
      account({ email: 'seoconsulting@gmail.com', name: null, created_at: '2026-01-05 10:00:00' }),
      member({ email: 'x@gmail.com', first_name: 'Seo', last_name: 'Consulting', joined_date: '2026-06-02 10:00:00' }),
    );
    expect(score).toBe(0);
  });

  it('awards the close-signup bonus only inside 48 hours', () => {
    const near = scoreMatch(
      account({ created_at: '2026-08-17 00:40:38' }),
      member({ joined_date: '2026-08-17 00:51:16' }),
    );
    const far = scoreMatch(
      account({ created_at: '2026-08-17 00:40:38' }),
      member({ joined_date: '2026-05-01 00:00:00' }),
    );
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('survives missing names and dates without throwing', () => {
    const { score } = scoreMatch(
      account({ name: null, created_at: '' }),
      member({ first_name: null, last_name: null, joined_date: null }),
    );
    expect(score).toBe(0);
  });

  it('does not double-count a surname that is both a token and a substring', () => {
    const { score } = scoreMatch(
      account({ email: 'street@example.org', name: 'Street', created_at: '2026-01-05 10:00:00' }),
      member({ email: 'x@gmail.com', first_name: 'Taz', last_name: 'Street', joined_date: '2026-06-02 10:00:00' }),
    );
    // surname credited once (+4), not twice
    expect(score).toBe(4);
  });
});

describe('suggestMembers', () => {
  const roster: RosterCandidate[] = [
    member({ email: 'positiveoutloud@gmail.com', first_name: 'Taz', last_name: 'Street', joined_date: '2026-08-17 00:51:16' }),
    member({ email: 'other@gmail.com', first_name: 'Jane', last_name: 'Doe', joined_date: '2026-02-01 00:00:00' }),
  ];

  it('returns only above-threshold candidates, best first', () => {
    const out = suggestMembers(
      account({ email: 'seostreetconsulting@gmail.com', name: 'Taz', created_at: '2026-08-17 00:40:38' }),
      roster,
    );
    expect(out).toHaveLength(1);
    expect(out[0].member.email).toBe('positiveoutloud@gmail.com');
  });

  it('returns nothing when no candidate clears the threshold', () => {
    expect(suggestMembers(account({ email: 'nomatch@gmail.com', name: 'Nobody' }), roster)).toEqual([]);
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      member({ email: `m${i}@acme.com`, first_name: 'Taz', last_name: 'Street', joined_date: '2026-08-17 00:51:16' }),
    );
    expect(suggestMembers(account({ email: 'street@acme.com', name: 'Taz' }), many, 3)).toHaveLength(3);
  });
});
