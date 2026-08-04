import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from '../../test-support/d1';
import { encryptToken } from '../../../lib/token-crypto';
import { nowIso } from '../../db/util';
import { resolveRunOpenRouterKey } from './byok';
import type { BlueprintProviderEnv } from '../../orchestration/process-run';

const ENCRYPTION_KEY = 'test-encryption-key-0123456789';
const USER_ID = 'usr_owner';
const RUN_ID = 'run_byok';

// Minimal stand-in for the MAIN datawise-db: byok.ts only ever reads
// user_llm_configs from it.
function createMainDb(): { db: D1Database; raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.exec(`CREATE TABLE user_llm_configs (
    user_id TEXT PRIMARY KEY,
    config_encrypted TEXT NOT NULL,
    updated_at TEXT
  );`);
  const db = {
    prepare(sql: string) {
      const make = (args: unknown[]): unknown => ({
        bind: (...a: unknown[]) => make(a),
        first: async () => raw.prepare(sql).get(...(args as [])) ?? null,
      });
      return make([]);
    },
  } as unknown as D1Database;
  return { db, raw };
}

async function seedRun(d1: D1Database, createdBy: string): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES ('proj', 'org', ?, 'Aqua', 'greenfield', 'us', 'en', ?, ?)`
    )
    .bind(createdBy, nowIso(), nowIso())
    .run();
  await d1
    .prepare(
      `INSERT INTO research_runs (id, project_id, brief_version_id, estimate_id, status, created_by, created_at)
       VALUES (?, 'proj', 'bv', 'est', 'running', ?, ?)`
    )
    .bind(RUN_ID, createdBy, nowIso())
    .run();
}

async function envWith(
  main: D1Database | undefined,
  encryptionKey: string | undefined
): Promise<BlueprintProviderEnv> {
  return { DB: main, ENCRYPTION_KEY: encryptionKey } as unknown as BlueprintProviderEnv;
}

describe('resolveRunOpenRouterKey', () => {
  it("returns the run creator's saved OpenRouter key", async () => {
    const { d1 } = createTestDb();
    await seedRun(d1, USER_ID);
    const { db, raw } = createMainDb();
    const encrypted = await encryptToken(
      JSON.stringify({ provider: 'openrouter', api_key: 'sk-or-member-key', model: 'x/y' }),
      ENCRYPTION_KEY
    );
    raw.prepare('INSERT INTO user_llm_configs (user_id, config_encrypted) VALUES (?, ?)').run(USER_ID, encrypted);

    const resolved = await resolveRunOpenRouterKey(await envWith(db, ENCRYPTION_KEY), d1, RUN_ID);

    expect(resolved).toEqual({ apiKey: 'sk-or-member-key', userId: USER_ID });
  });

  it('returns null when the member never saved a key', async () => {
    const { d1 } = createTestDb();
    await seedRun(d1, USER_ID);
    const { db } = createMainDb();

    expect(await resolveRunOpenRouterKey(await envWith(db, ENCRYPTION_KEY), d1, RUN_ID)).toBeNull();
  });

  it('returns null (never throws) when the stored config no longer decrypts', async () => {
    const { d1 } = createTestDb();
    await seedRun(d1, USER_ID);
    const { db, raw } = createMainDb();
    const encrypted = await encryptToken(
      JSON.stringify({ provider: 'openrouter', api_key: 'sk-or-member-key' }),
      'a-different-encryption-key'
    );
    raw.prepare('INSERT INTO user_llm_configs (user_id, config_encrypted) VALUES (?, ?)').run(USER_ID, encrypted);

    expect(await resolveRunOpenRouterKey(await envWith(db, ENCRYPTION_KEY), d1, RUN_ID)).toBeNull();
  });

  it('returns null when the stored config carries no api_key', async () => {
    const { d1 } = createTestDb();
    await seedRun(d1, USER_ID);
    const { db, raw } = createMainDb();
    const encrypted = await encryptToken(JSON.stringify({ provider: 'openrouter', model: 'x/y' }), ENCRYPTION_KEY);
    raw.prepare('INSERT INTO user_llm_configs (user_id, config_encrypted) VALUES (?, ?)').run(USER_ID, encrypted);

    expect(await resolveRunOpenRouterKey(await envWith(db, ENCRYPTION_KEY), d1, RUN_ID)).toBeNull();
  });

  it('returns null for an unknown run', async () => {
    const { d1 } = createTestDb();
    const { db } = createMainDb();

    expect(await resolveRunOpenRouterKey(await envWith(db, ENCRYPTION_KEY), d1, 'run_missing')).toBeNull();
  });

  it('returns null when the main DB binding or encryption key is absent', async () => {
    const { d1 } = createTestDb();
    await seedRun(d1, USER_ID);
    const { db } = createMainDb();

    expect(await resolveRunOpenRouterKey(await envWith(undefined, ENCRYPTION_KEY), d1, RUN_ID)).toBeNull();
    expect(await resolveRunOpenRouterKey(await envWith(db, undefined), d1, RUN_ID)).toBeNull();
  });
});
