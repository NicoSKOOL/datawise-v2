// Ordering policy for the nightly GSC sync queue.
//
// The due set is routinely larger than one cron window can process, so the
// order decides who gets data and who waits another day. Ordering never-synced
// properties last (the previous policy) meant a property that had never synced
// could only run after every stale refresh had run, and the refresh backlog
// alone filled the window. On 2026-08-04 that had left 5,140 of 6,210 enabled
// properties never synced, including 52 signed-in users whose dashboards were
// completely empty.
//
// Three classes, by what the owner currently sees:
//   onboarding: never synced, and the owner has no synced property at all.
//               Their dashboard is empty, so they go first.
//   expansion:  never synced, but the owner already sees data elsewhere.
//   refresh:    synced before, now stale.
//
// Onboarding runs first (bounded: 382 properties over 52 users on 2026-08-04),
// round-robined by user so one account with a long property list cannot push
// another account out of the window entirely. Expansion and refresh then
// alternate, so neither class can starve the other however lopsided the two
// backlogs are.

export interface SyncQueueRow {
  id: string;
  user_id: string;
  last_synced_at: string | null;
  /** 1 when the owner has at least one enabled GSC property that has synced. */
  user_has_synced: number;
}

export interface SyncQueueComposition {
  onboarding: number;
  expansion: number;
  refresh: number;
}

/** Deal one property per user per pass, so breadth beats depth. */
function roundRobinByUser<T extends { user_id: string }>(rows: T[]): T[] {
  const byUser = new Map<string, T[]>();
  for (const r of rows) {
    const queue = byUser.get(r.user_id);
    if (queue) queue.push(r);
    else byUser.set(r.user_id, [r]);
  }

  const queues = [...byUser.values()];
  const out: T[] = [];
  for (let depth = 0; out.length < rows.length; depth++) {
    for (const queue of queues) {
      if (depth < queue.length) out.push(queue[depth]);
    }
  }
  return out;
}

/** Alternate between two queues, appending whatever the longer one has left. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

function classify(rows: SyncQueueRow[]) {
  const onboarding: SyncQueueRow[] = [];
  const expansion: SyncQueueRow[] = [];
  const refresh: SyncQueueRow[] = [];

  for (const r of rows) {
    if (r.last_synced_at === null) {
      if (r.user_has_synced) expansion.push(r);
      else onboarding.push(r);
    } else {
      refresh.push(r);
    }
  }

  return { onboarding, expansion, refresh };
}

/**
 * Order the nightly sync queue so no class of property can starve.
 *
 * This function owns the whole ordering contract: the selection query does not
 * need an ORDER BY, and callers must not re-sort the result.
 */
export function orderSyncQueue(rows: SyncQueueRow[]): SyncQueueRow[] {
  const { onboarding, expansion, refresh } = classify(rows);

  // Oldest refresh first, so last night's survivors lead tonight's run and the
  // queue self-rotates instead of replaying the same head every night.
  refresh.sort((a, b) => (a.last_synced_at! < b.last_synced_at! ? -1 : 1));

  return [
    ...roundRobinByUser(onboarding),
    ...interleave(refresh, roundRobinByUser(expansion)),
  ];
}

/** Class counts for the run summary, so starvation is visible in the logs. */
export function describeSyncQueue(rows: SyncQueueRow[]): SyncQueueComposition {
  const { onboarding, expansion, refresh } = classify(rows);
  return {
    onboarding: onboarding.length,
    expansion: expansion.length,
    refresh: refresh.length,
  };
}
