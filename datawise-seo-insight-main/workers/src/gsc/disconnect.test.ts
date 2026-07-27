import { describe, it, expect } from 'vitest';

import { handleGSCDisconnect } from './oauth';

// handleGSCDisconnect erases every gsc_search_data row for the user BEFORE it
// removes the connection and property rows. That ordering is forced (deleting
// the properties cascades the same delete in one statement, which blows D1's
// 30s statement cap on large accounts), so the closing batch must be incapable
// of failing — otherwise the user is left connected, holding properties whose
// last_synced_at still claims fresh data, over an empty dashboard.
//
// chat_conversations.property_id is the only FK to gsc_properties declared with
// no ON DELETE action, so any user who has pointed the SEO Assistant at a
// property used to hit "FOREIGN KEY constraint failed" there. Measured on
// 2026-07-27: 87 properties across 46 users already wiped that way, 208 users
// one click from it (bug 536e8205).
function makeFakeDB(opts: { failPropertyDeleteWhileChatRefsExist?: boolean } = {}) {
  const statements: string[] = [];
  let chatRefsDetached = false;

  const db: any = {
    prepare(sql: string) {
      const stmt: any = {
        sql,
        bind() {
          return stmt;
        },
        async run() {
          statements.push(sql);
          if (/UPDATE chat_conversations/i.test(sql)) chatRefsDetached = true;
          // Chunk loop terminates on the first short delete.
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
    async batch(stmts: any[]) {
      for (const s of stmts) statements.push(s.sql);
      if (
        opts.failPropertyDeleteWhileChatRefsExist
        && !chatRefsDetached
        && stmts.some((s) => /DELETE FROM gsc_properties/i.test(s.sql))
      ) {
        throw new Error('D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT');
      }
      return stmts.map(() => ({ success: true }));
    },
  };

  const indexOfMatch = (re: RegExp) => statements.findIndex((s) => re.test(s));
  return {
    db,
    statements,
    detachIndex: () => indexOfMatch(/UPDATE chat_conversations/i),
    dataDeleteIndex: () => indexOfMatch(/DELETE FROM gsc_search_data/i),
    propertyDeleteIndex: () => indexOfMatch(/DELETE FROM gsc_properties/i),
  };
}

describe('handleGSCDisconnect', () => {
  it('detaches chat_conversations before destroying any Search Console data', async () => {
    const fake = makeFakeDB();

    const res = await handleGSCDisconnect({ DB: fake.db } as any, 'user-1');

    expect(res.status).toBe(200);
    expect(fake.detachIndex()).toBeGreaterThanOrEqual(0);
    // Ordering is the whole fix: detach, then wipe, then drop the properties.
    expect(fake.detachIndex()).toBeLessThan(fake.dataDeleteIndex());
    expect(fake.dataDeleteIndex()).toBeLessThan(fake.propertyDeleteIndex());
  });

  it('succeeds for a user whose properties are referenced by SEO Assistant conversations', async () => {
    // The fake throws the real FK error if the property delete runs while chat
    // references are still attached — i.e. it reproduces the shipped bug.
    const fake = makeFakeDB({ failPropertyDeleteWhileChatRefsExist: true });

    const res = await handleGSCDisconnect({ DB: fake.db } as any, 'user-1');
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
