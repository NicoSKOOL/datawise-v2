import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { chunk, runBatchedStatements, assertRowBudget, D1_MAX_BOUND_PARAMS, STATEMENTS_PER_BATCH } from './batch';

describe('chunk', () => {
  it('splits an array into groups of the given size, with a shorter final group', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns an empty array for empty input', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('returns one group when size exceeds the input length', () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});

describe('assertRowBudget', () => {
  it('does not throw when rows * params stays within the D1 bound-parameter cap', () => {
    expect(() => assertRowBudget(10, 8, 'test insert')).not.toThrow();
    expect(10 * 8).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
  });

  it('throws when rows * params would exceed the D1 bound-parameter cap', () => {
    expect(() => assertRowBudget(20, 8, 'test insert')).toThrow(/exceeds D1's 100-bound-parameter-per-statement limit/);
  });
});

describe('runBatchedStatements', () => {
  it('sends statements through d1.batch() in groups of STATEMENTS_PER_BATCH', async () => {
    const { d1, raw } = createTestDb();
    raw.exec(`CREATE TABLE batch_probe (id INTEGER PRIMARY KEY, value TEXT)`);

    const totalStatements = STATEMENTS_PER_BATCH * 2 + 5; // spans 3 batch() groups
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < totalStatements; i++) {
      statements.push(d1.prepare(`INSERT INTO batch_probe (id, value) VALUES (?, ?)`).bind(i, `v${i}`));
    }

    let batchCalls = 0;
    const countingD1: D1Database = {
      ...(d1 as unknown as Record<string, unknown>),
      batch: async <T = unknown>(stmts: D1PreparedStatement[]) => {
        batchCalls += 1;
        return (d1 as unknown as { batch: <U>(s: D1PreparedStatement[]) => Promise<U[]> }).batch<T>(stmts);
      },
    } as unknown as D1Database;

    await runBatchedStatements(countingD1, statements);

    expect(batchCalls).toBe(3);
    const rowCount = raw.prepare(`SELECT COUNT(*) AS n FROM batch_probe`).get() as { n: number };
    expect(rowCount.n).toBe(totalStatements);
  });

  it('is a no-op for an empty statement list (no d1.batch() call)', async () => {
    const { d1 } = createTestDb();
    let batchCalls = 0;
    const countingD1: D1Database = {
      ...(d1 as unknown as Record<string, unknown>),
      batch: async <T = unknown>(stmts: D1PreparedStatement[]) => {
        batchCalls += 1;
        return [] as T[];
      },
    } as unknown as D1Database;

    await runBatchedStatements(countingD1, []);
    expect(batchCalls).toBe(0);
  });
});

// Statement-budget regression guard (Task 21). Every multi-row INSERT that
// Phase 3/4 persistence emits sends `rowsPerStatement * paramsPerRow` bound
// parameters in a single prepared statement, and D1 caps that at
// D1_MAX_BOUND_PARAMS (100). Each persistence module already calls
// assertRowBudget at MODULE LOAD with its own (rows, params) constants, so a
// future column addition that raises paramsPerRow without lowering
// rowsPerStatement throws at import time. Those constants are module-private,
// so this block does two complementary things the brief asks for:
//   1. Documents every Phase 3/4 multi-row insert's (rows, params) with its
//      call-site reference and asserts the product stays within the cap, so the
//      ledger of what fits is reviewable in one place.
//   2. Imports every persistence module, which RUNS its load-time
//      assertRowBudget guards -- the non-tautological anchor: if a real module
//      constant ever exceeds the cap, that import throws and this test fails,
//      independent of the documented numbers below.
describe('Phase 4 statement-budget regression', () => {
  // label -> [rowsPerStatement, paramsPerRow, call-site]. Mirrors the private
  // constants at each assertRowBudget call site; keep in sync when a table's
  // column count changes (the module import below is what actually enforces it).
  const MULTI_ROW_INSERTS: Record<string, [number, number, string]> = {
    'keywords insert': [10, 8, 'orchestration/research-handlers.ts:133'],
    'research join table insert': [45, 2, 'orchestration/research-handlers.ts:134'],
    'clustering join table insert': [45, 2, 'orchestration/clustering-handlers.ts:151'],
    'keyword_clusters insert': [5, 17, 'orchestration/clustering-handlers.ts:630'],
    'cluster_keywords insert': [20, 4, 'orchestration/clustering-handlers.ts:635'],
    'cluster_adjudications insert': [10, 9, 'orchestration/clustering-handlers.ts:1030'],
    'parsed_competitor_pages insert': [6, 15, 'orchestration/page-plan-handlers.ts:148'],
    'keyword_clusters page_candidate write-back': [1, 3, 'orchestration/page-plan-handlers.ts:601'],
    'existing_pages insert': [11, 9, 'orchestration/page-plan-handlers.ts:796'],
    'blueprint_pages materialization': [1, 14, 'orchestration/handlers.ts:135'],
  };

  it('every documented multi-row insert fits within the D1 bound-parameter cap', () => {
    for (const [label, [rows, params, ref]] of Object.entries(MULTI_ROW_INSERTS)) {
      expect(rows * params, `${label} (${ref})`).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
      // assertRowBudget agrees with the arithmetic for the documented values.
      expect(() => assertRowBudget(rows, params, label), `${label} (${ref})`).not.toThrow();
    }
  });

  it('importing every persistence module runs its load-time assertRowBudget guards without throwing', async () => {
    // A throw here means a real module constant blew the cap at load: the
    // dynamic import re-executes the module top level (assertRowBudget included).
    await expect(import('../orchestration/research-handlers')).resolves.toBeDefined();
    await expect(import('../orchestration/clustering-handlers')).resolves.toBeDefined();
    await expect(import('../orchestration/page-plan-handlers')).resolves.toBeDefined();
    await expect(import('../orchestration/handlers')).resolves.toBeDefined();
  });

  it('assertRowBudget rejects a one-column overflow at the exact boundary', () => {
    // Exactly 100 is allowed; one more bound parameter is not. This pins the
    // boundary so the guard can never silently drift to a >100 ceiling.
    expect(() => assertRowBudget(10, 10, 'boundary')).not.toThrow();
    expect(10 * 10).toBe(D1_MAX_BOUND_PARAMS);
    expect(() => assertRowBudget(10, 11, 'boundary')).toThrow(/exceeds D1's 100-bound-parameter-per-statement limit/);
    // Concretely: the tightest current insert (existing_pages, 11x9=99) has room
    // for zero extra params/row -- adding one column (11x10=110) must fail.
    expect(() => assertRowBudget(11, 10, 'existing_pages + 1 column')).toThrow();
  });
});
