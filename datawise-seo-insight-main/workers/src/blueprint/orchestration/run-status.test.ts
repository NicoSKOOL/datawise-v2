import { describe, it, expect } from 'vitest';
import { BLUEPRINT_STAGES } from '../contracts/enums';
import type { BlueprintStage, StageStatus } from '../contracts/enums';
import { STAGE_REGISTRY, stageMeta } from './stages';
import { nextRunnableStage, deriveRunStatus } from './run-status';
import type { StageRowLite } from './run-status';

const REQUIRED_STAGES: BlueprintStage[] = [
  'validate_intake',
  'resolve_market',
  'normalize_brief',
  'plan_research',
  'collect_keyword_evidence',
  'build_provisional_clusters',
  'build_page_plan',
  'validate_blueprint',
  'publish_blueprint',
];

const NOW = new Date('2026-07-10T12:00:00.000Z');

// Builds a full 19-row snapshot, defaulting every stage to 'succeeded' and
// letting the caller override individual stages by name. Rows omitted via
// `omit` are dropped entirely (simulating a stage that has no row yet).
function makeRows(
  overrides: Partial<Record<BlueprintStage, Partial<StageRowLite>>> = {},
  omit: BlueprintStage[] = []
): StageRowLite[] {
  return BLUEPRINT_STAGES.filter((stage) => !omit.includes(stage)).map((stage) => {
    const override = overrides[stage] ?? {};
    return {
      stage_name: stage,
      status: 'succeeded',
      required: REQUIRED_STAGES.includes(stage) ? 1 : 0,
      next_retry_at: null,
      ...override,
    } satisfies StageRowLite;
  });
}

describe('STAGE_REGISTRY', () => {
  it('has 19 entries in BLUEPRINT_STAGES order', () => {
    expect(STAGE_REGISTRY.length).toBe(19);
    expect(STAGE_REGISTRY.map((m) => m.stage)).toEqual([...BLUEPRINT_STAGES]);
  });

  it('marks exactly the 9 required stages (Manual §8 critical path + build_page_plan)', () => {
    const required = STAGE_REGISTRY.filter((m) => m.required).map((m) => m.stage);
    expect(required.sort()).toEqual([...REQUIRED_STAGES].sort());
    expect(required.length).toBe(9);
  });

  it('marks every other stage as not required', () => {
    const optional = STAGE_REGISTRY.filter((m) => !m.required).map((m) => m.stage);
    expect(optional.length).toBe(10);
    for (const stage of optional) {
      expect(REQUIRED_STAGES).not.toContain(stage);
    }
  });

  it('stageMeta returns the same metadata as the registry', () => {
    expect(stageMeta('validate_intake')).toEqual({ stage: 'validate_intake', required: true });
    expect(stageMeta('discover_competitors')).toEqual({ stage: 'discover_competitors', required: false });
  });
});

describe('nextRunnableStage', () => {
  it('returns the first stage as runnable when no rows exist at all', () => {
    expect(nextRunnableStage([], NOW)).toEqual({ kind: 'run', stage: 'validate_intake' });
  });

  it('treats a missing row as pending and runnable', () => {
    const rows = makeRows({}, ['plan_research']);
    // validate_intake, resolve_market, normalize_brief default to 'succeeded'
    // above; plan_research has no row at all.
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'run', stage: 'plan_research' });
  });

  it('returns a pending row as runnable', () => {
    const rows = makeRows({ resolve_market: { status: 'pending' } });
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'run', stage: 'resolve_market' });
  });

  it('returns a queued row as runnable', () => {
    const rows = makeRows({ resolve_market: { status: 'queued' } });
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'run', stage: 'resolve_market' });
  });

  it('skips succeeded, skipped, and partial rows to find the next candidate', () => {
    const rows = makeRows({
      validate_intake: { status: 'succeeded' },
      resolve_market: { status: 'skipped' },
      normalize_brief: { status: 'partial' },
      plan_research: { status: 'pending' },
    });
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'run', stage: 'plan_research' });
  });

  it('treats a cancelled row as terminal and continues scanning', () => {
    const rows = makeRows({
      validate_intake: { status: 'cancelled' },
      resolve_market: { status: 'pending' },
    });
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'run', stage: 'resolve_market' });
  });

  it('returns runnable for a retry_wait row whose next_retry_at has passed', () => {
    const rows = makeRows({
      resolve_market: { status: 'retry_wait', next_retry_at: '2026-07-10T11:59:59.000Z' },
    });
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'run', stage: 'resolve_market' });
  });

  it('returns wait for a retry_wait row whose next_retry_at is in the future, blocking later stages', () => {
    const rows = makeRows({
      resolve_market: { status: 'retry_wait', next_retry_at: '2026-07-10T12:05:00.000Z' },
      normalize_brief: { status: 'pending' },
    });
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'wait', until: '2026-07-10T12:05:00.000Z' });
  });

  it('returns wait for a running row, blocking later stages even if they are pending', () => {
    const rows = makeRows({
      resolve_market: { status: 'running' },
      normalize_brief: { status: 'pending' },
    });
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'wait', until: NOW.toISOString() });
  });

  it('returns failed when a REQUIRED stage row is failed', () => {
    const rows = makeRows({
      resolve_market: { status: 'failed', required: 1 },
    });
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'failed', stage: 'resolve_market' });
  });

  it('degrades past a failed OPTIONAL stage and keeps scanning', () => {
    const rows = makeRows({
      discover_competitors: { status: 'failed', required: 0 },
      collect_competitor_evidence: { status: 'pending' },
    });
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'run', stage: 'collect_competitor_evidence' });
  });

  it('returns done when all 19 stages are succeeded, skipped, or partial', () => {
    const rows = makeRows({
      discover_competitors: { status: 'skipped', required: 0 },
      refine_clusters: { status: 'partial', required: 0 },
    });
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'done' });
  });

  it('returns done when the only non-succeeded rows are failed-optional stages', () => {
    const rows = makeRows({
      discover_competitors: { status: 'failed', required: 0 },
      collect_us_fanout: { status: 'failed', required: 0 },
    });
    expect(nextRunnableStage(rows, NOW)).toEqual({ kind: 'done' });
  });
});

describe('deriveRunStatus', () => {
  it('passes through cancel_requested unchanged regardless of row state', () => {
    const rows = makeRows({ resolve_market: { status: 'pending' } });
    expect(deriveRunStatus(rows, 'cancel_requested')).toBe('cancel_requested');
  });

  it('passes through cancelled unchanged regardless of row state', () => {
    const rows = makeRows();
    expect(deriveRunStatus(rows, 'cancelled')).toBe('cancelled');
  });

  it('returns failed when any REQUIRED stage failed, even mid-run', () => {
    const rows = makeRows({
      resolve_market: { status: 'failed', required: 1 },
      plan_research: { status: 'pending' },
    });
    expect(deriveRunStatus(rows, 'running')).toBe('failed');
  });

  it('returns running when stages are still in flight and no required stage failed', () => {
    const rows = makeRows({ plan_research: { status: 'pending' } });
    expect(deriveRunStatus(rows, 'running')).toBe('running');
  });

  it('returns running when a stage row is entirely missing', () => {
    const rows = makeRows({}, ['discover_competitors']);
    expect(deriveRunStatus(rows, 'running')).toBe('running');
  });

  it('returns succeeded when all 19 stages succeeded cleanly', () => {
    const rows = makeRows();
    expect(deriveRunStatus(rows, 'running')).toBe('succeeded');
  });

  it('returns partial when all stages are terminal but an optional stage was skipped', () => {
    const rows = makeRows({ discover_competitors: { status: 'skipped', required: 0 } });
    expect(deriveRunStatus(rows, 'running')).toBe('partial');
  });

  it('returns partial when all stages are terminal but an optional stage ended partial', () => {
    const rows = makeRows({ refine_clusters: { status: 'partial', required: 0 } });
    expect(deriveRunStatus(rows, 'running')).toBe('partial');
  });

  it('returns partial when all stages are terminal but an optional stage failed (degraded, not fatal)', () => {
    const rows = makeRows({ collect_us_fanout: { status: 'failed', required: 0 } });
    expect(deriveRunStatus(rows, 'running')).toBe('partial');
  });

  // Finding 1 (final whole-branch review): collect_keyword_evidence is a
  // REQUIRED stage (per REQUIRED_STAGES above) that can still return status
  // 'partial' on its own (enrichmentTruncated, research-handlers.ts) rather
  // than throwing. The old inline check here (`!row.required && ...`) only
  // ever counted a 'partial' row as a gap when it was OPTIONAL, so a
  // required-partial run would fold straight to 'succeeded' -- silently
  // disagreeing with partial_reasons_json (loadGapStageNames counted ANY
  // 'partial' row, required or not). A required stage ending 'partial' must
  // degrade the run exactly like an optional 'skipped'/'partial' does.
  it('returns partial (not succeeded) when a REQUIRED stage ends partial', () => {
    const rows = makeRows({ collect_keyword_evidence: { status: 'partial', required: 1 } });
    expect(deriveRunStatus(rows, 'running')).toBe('partial');
  });

  it('publish_blueprint succeeding with only optional gaps is a final partial, not running', () => {
    const rows = makeRows({
      discover_competitors: { status: 'skipped', required: 0 },
      publish_blueprint: { status: 'succeeded', required: 1 },
    });
    expect(deriveRunStatus(rows, 'running')).toBe('partial');
  });
});
