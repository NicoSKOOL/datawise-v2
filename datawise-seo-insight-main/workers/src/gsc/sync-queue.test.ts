import { describe, it, expect } from 'vitest';

import { orderSyncQueue, type SyncQueueRow } from './sync-queue';

function row(
  id: string,
  user_id: string,
  last_synced_at: string | null,
  user_has_synced: number
): SyncQueueRow {
  return { id, user_id, last_synced_at, user_has_synced };
}

// A property that has never synced, belonging to a user who has no synced
// property at all: the user's dashboard is completely empty.
function onboarding(id: string, user_id: string): SyncQueueRow {
  return row(id, user_id, null, 0);
}

// A property that has never synced, belonging to a user who already sees data
// from some other property.
function expansion(id: string, user_id: string): SyncQueueRow {
  return row(id, user_id, null, 1);
}

// A property that has synced before and is now due for a refresh.
function refresh(id: string, user_id: string, at: string): SyncQueueRow {
  return row(id, user_id, at, 1);
}

describe('orderSyncQueue', () => {
  it('puts empty-dashboard properties ahead of refreshes', () => {
    const ordered = orderSyncQueue([
      refresh('r1', 'u1', '2026-08-01'),
      refresh('r2', 'u1', '2026-07-30'),
      onboarding('o1', 'u2'),
    ]);

    expect(ordered[0].id).toBe('o1');
  });

  it('gives every empty-dashboard user a slot before any user gets a second', () => {
    // u2 connected 5 properties, u3 connected 1. Ordering by user_id alone
    // would make u3 wait behind all of u2's backlog.
    const ordered = orderSyncQueue([
      onboarding('a1', 'u2'),
      onboarding('a2', 'u2'),
      onboarding('a3', 'u2'),
      onboarding('a4', 'u2'),
      onboarding('a5', 'u2'),
      onboarding('b1', 'u3'),
    ]);

    expect(ordered.slice(0, 2).map((r) => r.user_id).sort()).toEqual(['u2', 'u3']);
  });

  it('does not push never-synced properties behind every refresh', () => {
    // The production shape: a user with one working property and a long tail of
    // never-synced ones, competing with a large refresh backlog.
    const refreshes = Array.from({ length: 20 }, (_, i) =>
      refresh(`r${i}`, 'u1', `2026-07-${String(i + 1).padStart(2, '0')}`)
    );
    const expansions = Array.from({ length: 20 }, (_, i) => expansion(`e${i}`, 'u2'));

    const ordered = orderSyncQueue([...refreshes, ...expansions]);
    const firstTen = ordered.slice(0, 10);

    expect(firstTen.filter((r) => r.last_synced_at === null).length).toBeGreaterThan(0);
    expect(firstTen.filter((r) => r.last_synced_at !== null).length).toBeGreaterThan(0);
  });

  it('keeps refreshes in oldest-synced-first order', () => {
    const ordered = orderSyncQueue([
      refresh('newest', 'u1', '2026-08-01'),
      refresh('oldest', 'u1', '2026-06-01'),
      refresh('middle', 'u1', '2026-07-01'),
    ]);

    expect(ordered.map((r) => r.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('returns every input row exactly once', () => {
    const input = [
      refresh('r1', 'u1', '2026-08-01'),
      onboarding('o1', 'u2'),
      onboarding('o2', 'u2'),
      expansion('e1', 'u1'),
      refresh('r2', 'u3', '2026-07-01'),
    ];

    const ordered = orderSyncQueue(input);

    expect(ordered).toHaveLength(input.length);
    expect(ordered.map((r) => r.id).sort()).toEqual(['e1', 'o1', 'o2', 'r1', 'r2']);
  });

  it('handles an empty queue', () => {
    expect(orderSyncQueue([])).toEqual([]);
  });

  it('starves nobody when one class is empty', () => {
    const onlyRefreshes = [
      refresh('r1', 'u1', '2026-07-01'),
      refresh('r2', 'u1', '2026-06-01'),
    ];

    expect(orderSyncQueue(onlyRefreshes).map((r) => r.id)).toEqual(['r2', 'r1']);
  });
});
