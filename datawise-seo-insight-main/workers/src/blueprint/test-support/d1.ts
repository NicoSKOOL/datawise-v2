// Test-only adapter presenting a D1Database-compatible surface over better-sqlite3.
// D1 is SQLite, so schema.sql and all statements run unmodified.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PreparedLike {
  bind(...args: unknown[]): PreparedLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[]; meta: { changes: number } }>;
  run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
  __sql: string;
  __args: unknown[];
}

function makeStatement(db: Database.Database, sql: string, args: unknown[] = []): PreparedLike {
  return {
    __sql: sql,
    __args: args,
    bind(...newArgs: unknown[]) {
      return makeStatement(db, sql, newArgs);
    },
    async first<T>() {
      const row = db.prepare(sql).get(...(args as [])) as T | undefined;
      return row ?? null;
    },
    async all<T>() {
      const results = db.prepare(sql).all(...(args as [])) as T[];
      return { results, meta: { changes: 0 } };
    },
    async run() {
      const info = db.prepare(sql).run(...(args as []));
      return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
    },
  };
}

export function createTestDb(): { d1: D1Database; raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');
  raw.exec(readFileSync(schemaPath, 'utf8'));
  const d1 = {
    prepare(sql: string) {
      return makeStatement(raw, sql);
    },
    async batch(statements: PreparedLike[]) {
      const tx = raw.transaction(() => {
        for (const s of statements) raw.prepare(s.__sql).run(...(s.__args as []));
      });
      tx();
      return statements.map(() => ({ meta: { changes: 0 } }));
    },
    async exec(sql: string) {
      raw.exec(sql);
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
  return { d1, raw };
}
