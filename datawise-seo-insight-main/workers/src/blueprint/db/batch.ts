// Shared D1 batching helpers.
//
// Extracted from orchestration/research-handlers.ts (Task 10, Phase 3):
// that module's collect_keyword_evidence / collect_competitor_evidence
// persistence originally did 3 sequential D1 round-trips PER merged
// keyword (INSERT, re-SELECT id, evidence-ref INSERT). Persisting ~2,500
// candidates meant ~7,600 statements in one queue-consumer invocation,
// which blew Cloudflare's per-invocation subrequest ceiling (D1
// statements count against it) and failed the whole stage with a
// sanitized internal_error. The fix: chunked, multi-row
// `INSERT OR IGNORE ... VALUES (?,?,...),(?,?,...)` statements, sent
// through as few d1.batch() calls as possible.
//
// This module is the shared home for that pattern so Phase 4 persistence
// (clusters, adjudications, parsed competitor pages, existing-site
// inventory) can reuse it instead of re-deriving the same chunking and
// subrequest-budget math research-handlers.ts already worked out.

// D1 caps bound parameters at 100 per prepared statement.
export const D1_MAX_BOUND_PARAMS = 100;

// How many prepared statements ride in a single d1.batch() call. D1 has no
// documented hard statement-count-per-batch ceiling, but batching
// everything into one call would still make one very large request;
// splitting into groups keeps each batch() call itself modest.
export const STATEMENTS_PER_BATCH = 40;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Sends `statements` through d1.batch() in groups of STATEMENTS_PER_BATCH.
// d1.batch() is transactional per call (not across calls); callers that
// need atomicity across the whole set must not rely on this function for
// that -- it only bounds how large any single batch() call gets.
export async function runBatchedStatements(d1: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (const group of chunk(statements, STATEMENTS_PER_BATCH)) {
    if (group.length === 0) continue;
    await d1.batch(group);
  }
}

// Runtime guard (this codebase has no compile-time static_assert): if a
// column addition to some table changes params-per-row without updating
// the matching rows-per-statement constant, this throws immediately at
// module load instead of silently reintroducing the subrequest-cap bug
// this module exists to fix.
export function assertRowBudget(rowsPerStatement: number, paramsPerRow: number, label: string): void {
  const total = rowsPerStatement * paramsPerRow;
  if (total > D1_MAX_BOUND_PARAMS) {
    throw new Error(
      `${label}: ${rowsPerStatement} rows * ${paramsPerRow} params/row = ${total} exceeds D1's ${D1_MAX_BOUND_PARAMS}-bound-parameter-per-statement limit`
    );
  }
}
