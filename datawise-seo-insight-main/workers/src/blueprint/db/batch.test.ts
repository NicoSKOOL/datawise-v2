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
