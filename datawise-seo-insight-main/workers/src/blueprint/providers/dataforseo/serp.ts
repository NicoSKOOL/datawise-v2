import type { StageContext } from '../../orchestration/handlers';
import { blueprintDfsCall } from './call';
import type { DfsCallResult } from './call';
import type { DfsTaskMeta } from './envelope';
import { newId, nowIso } from '../../db/util';
import { hashNormalizedInput } from '../../domain/hash';
import { normalizeKeyword } from '../../domain/keyword';
import type { DfsCostEstimates } from './costs';

// Catalog Sec 15: SERP tasks cache 24h positive / 2h empty. task_post itself
// is never actually cached in practice (see the DfsCallSpec.skipCache doc
// comment in call.ts and its sibling note below at the task_get call site):
// each task object's `tag` embeds the run id, so the request hash naturally
// differs run-to-run and this batch is only ever posted once per run (the
// handler never calls postSerpTasks a second time for a run that already
// has dfs_serp_tasks rows). These constants exist for completeness/parity
// with the other adapters' TTL conventions, not because a hit is expected.
const SERP_TASK_POST_TTL_SECONDS = 86_400;
const SERP_TASK_POST_EMPTY_TTL_SECONDS = 7_200;

// Catalog Sec 12: "max 100 task objects per POST". The handler already caps
// its query list at 20 (catalog Sec 15 V1 operating point); this is a
// defensive backstop at the adapter boundary, not the intended operating
// cap.
const MAX_SERP_TASKS_PER_POST = 100;

// Thrown by validate_serps_and_questions (research-handlers.ts) whenever
// there is more SERP task work outstanding for this run -- either it just
// posted a fresh batch, or collect_serp_tasks still has rows sitting in
// 'posted'. This is a plain Error subclass, NOT a BlueprintApiError: per the
// controller's design decision (see process-run.ts), it is classified in
// the processor's generic catch-all like any other retryable failure, but
// tagged with its own safe_error_code ('provider_timeout') and message
// instead of falling through to the generic internal_error label a raw
// non-BlueprintApiError throw would normally get. Landing this stage in
// retry_wait (rather than treating it as a hard failure) is exactly what
// stages.ts's enlarged `maxAttempts: 12` / `retryBackoffMs: 30_000` exists
// to make viable: DataForSEO's async SERP task can take real wall-clock time
// to finish, so this stage needs many more, longer-spaced attempts than a
// genuine transient provider error would ever need.
export class SerpTasksPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SerpTasksPendingError';
  }
}

export interface SerpQuery {
  keyword: string;
  serviceAreaId: string | null;
  locationCode: number; // GRANULAR SERP location code (catalog Sec 12), not the Labs country code
}

// Catalog Sec 12 verbatim body, one task object per query, batched into a
// single task_post call. `bodies` (call.ts Task 13 extension) is used
// instead of `body` because this is the one adapter that needs more than
// one task object per POST, each with its own per-query tag rather than one
// tag the wrapper appends to a single shared body.
export async function postSerpTasks(
  ctx: StageContext,
  queries: SerpQuery[],
  costs: DfsCostEstimates
): Promise<void> {
  const capped = queries.slice(0, MAX_SERP_TASKS_PER_POST);
  if (capped.length === 0) return;

  const languageCode = ctx.normalizedBrief.languageCode;
  const bodies = capped.map((q) => ({
    keyword: q.keyword,
    location_code: q.locationCode,
    language_code: languageCode,
    device: 'desktop',
    os: 'windows',
    depth: 10,
    people_also_ask_click_depth: 1,
    priority: 1,
    tag: `run:${ctx.runId}:serp:${q.serviceAreaId ?? 'primary'}`,
  }));

  // ONE reservation for the whole batch (budget.ts operationKey 'batch'),
  // matching this task's brief: estimate = serpTaskUsdMicro * queries.length.
  const result = await blueprintDfsCall(ctx, {
    method: 'POST',
    endpoint: '/serp/google/organic/task_post',
    bodies,
    ttlSeconds: SERP_TASK_POST_TTL_SECONDS,
    emptyTtlSeconds: SERP_TASK_POST_EMPTY_TTL_SECONDS,
    kind: 'serp_snapshot',
    operation: 'serp_task_post',
    scopeId: 'batch',
    estimateUsdMicro: costs.serpTaskUsdMicro * capped.length,
  });

  // DataForSEO returns tasks in the same order the bodies were submitted
  // (same assumption the shared envelope's callers already rely on
  // elsewhere in this module for ordered batch responses). A task that
  // failed to post at all (rare -- a malformed single query in an otherwise
  // valid batch) has no provider_task_id to poll later and is simply not
  // persisted; every other, successfully created task gets its own
  // dfs_serp_tasks row so collectSerpTasks can poll it independently.
  const postedAt = nowIso();
  for (let i = 0; i < capped.length; i++) {
    const meta: DfsTaskMeta | undefined = result.taskMetas[i];
    if (!meta || !meta.taskId) continue;
    await ctx.d1
      .prepare(
        `INSERT OR IGNORE INTO dfs_serp_tasks
          (id, run_id, keyword, service_area_id, location_code, provider_task_id, status, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, 'posted', ?)`
      )
      .bind(
        newId('serpt'),
        ctx.runId,
        capped[i].keyword,
        capped[i].serviceAreaId,
        capped[i].locationCode,
        meta.taskId,
        postedAt
      )
      .run();
  }
}

// DataForSEO's own not-ready vocabulary for task_get/advanced polled before
// the task has finished (catalog Sec 12: "Task In Queue"/"Task Handed"), NOT
// a real per-task error. Matched case-insensitively against status_message
// since the exact casing/punctuation is not itself part of the documented
// contract, only the substance of the phrase.
const NOT_READY_STATUS_PATTERN = /task in queue|task handed/i;

// A task_get response can be a genuine DataForSEO SUCCESS status
// (isSuccessfulDataForSeoTask's 20000-29999 band) that simply has not
// produced a result payload yet -- DfsTaskMeta.resultCount stays 0 when the
// task's `result` field is null. That is functionally "not ready", not a
// real (if oddly empty) completed SERP snapshot, so it is folded into the
// same not-ready bucket as the named in-queue phrases above rather than
// treated as `isTaskReady`.
function isTaskReady(meta: DfsTaskMeta): boolean {
  return meta.statusCode >= 20000 && meta.statusCode < 30000 && meta.resultCount > 0;
}

function isTaskNotReady(meta: DfsTaskMeta): boolean {
  if (isTaskReady(meta)) return false;
  if (NOT_READY_STATUS_PATTERN.test(meta.statusMessage)) return true;
  return meta.statusCode >= 20000 && meta.statusCode < 30000 && meta.resultCount === 0;
}

export interface CollectSerpTasksResult {
  completed: number;
  pending: number;
  failed: number;
}

interface DfsSerpTaskRow {
  id: string;
  keyword: string;
  service_area_id: string | null;
  location_code: number;
  provider_task_id: string | null;
}

interface ParsedOrganicItem {
  rank: number | null;
  url: string | null;
  title: string | null;
  domain: string | null;
}

interface ParsedPaaQuestion {
  question: string;
  answerText: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  paaDepth: number;
}

interface ParsedSerpPayload {
  organic: ParsedOrganicItem[];
  paaQuestions: ParsedPaaQuestion[];
  relatedSearches: string[];
  localPackPresent: boolean;
  featuredSnippetPresent: boolean;
}

const MAX_ORGANIC_RESULTS = 10; // catalog Sec 12 depth: 10

// DataForSEO SERP Advanced's `items` array is heterogeneous: every entry
// carries a `type` discriminator ('organic', 'people_also_ask',
// 'related_searches', 'local_pack', 'featured_snippet', ...). This is a
// best-effort field mapping against DataForSEO's documented SERP Advanced
// item schema (the catalog itself only names the item TYPES to parse, not
// their internal shape) -- same documented-assumption caveat prior adapters
// in this phase have flagged (competitors.ts's RelevantPageRecord mapping,
// keywords.ts's traffic-estimate field); spot-check against a real response
// in Task 15's staging smoke run. AI Overview is deliberately never
// inspected here: Phase 3 never requests `load_async_ai_overview`, so its
// status is always the fixed 'unchecked' (never 'not_observed'), per the
// catalog's AIO nuance note and this task's global constraints.
function parseSerpPayload(items: any[]): ParsedSerpPayload {
  const safeItems = Array.isArray(items) ? items : [];

  const organic: ParsedOrganicItem[] = safeItems
    .filter((item) => item?.type === 'organic')
    .slice(0, MAX_ORGANIC_RESULTS)
    .map((item) => ({
      rank: typeof item.rank_group === 'number' ? item.rank_group : null,
      url: typeof item.url === 'string' ? item.url : null,
      title: typeof item.title === 'string' ? item.title : null,
      domain: typeof item.domain === 'string' ? item.domain : null,
    }));

  const paaQuestions: ParsedPaaQuestion[] = [];
  for (const container of safeItems.filter((item) => item?.type === 'people_also_ask')) {
    const elements = Array.isArray(container.items) ? container.items : [];
    for (const element of elements) {
      const question = typeof element?.title === 'string' ? element.title : null;
      if (!question) continue;
      // click-depth-1 expansion nests further PAA elements under
      // expanded_element; only the first expanded answer is surfaced here
      // (the answer text/source), not deeper recursive expansion variants --
      // documented-assumption caveat, see the function doc comment above.
      const expanded = Array.isArray(element?.expanded_element) ? element.expanded_element[0] : null;
      paaQuestions.push({
        question,
        answerText: typeof expanded?.description === 'string' ? expanded.description : null,
        sourceTitle: typeof expanded?.title === 'string' ? expanded.title : null,
        sourceUrl: typeof expanded?.url === 'string' ? expanded.url : null,
        paaDepth: 1,
      });
    }
  }

  const relatedSearches: string[] = safeItems
    .filter((item) => item?.type === 'related_searches')
    .flatMap((item) => (Array.isArray(item.items) ? item.items : []))
    .filter((entry): entry is string => typeof entry === 'string');

  return {
    organic,
    paaQuestions,
    relatedSearches,
    localPackPresent: safeItems.some((item) => item?.type === 'local_pack'),
    featuredSnippetPresent: safeItems.some((item) => item?.type === 'featured_snippet'),
  };
}

// evidence_refs rows for collected SERP data are written MANUALLY here
// rather than via blueprintDfsCall's own evidence insertion: task_get is
// called with estimateUsdMicro: 0 (real cost was already reserved/charged
// once at task_post time), which means the wrapper treats it as a free call
// and never writes an evidence_refs row for it (call.ts only inserts
// evidence for non-free calls) -- exactly the "avoid duplication" property
// this task's brief calls for. This mirrors the wrapper's own insertEvidenceRef
// shape (provider 'dataforseo', fetched_at now, cost 0) but is not itself a
// call.ts helper, so it is re-declared narrowly here instead of exported
// from call.ts (which has no reason to expose an insert helper whose only
// caller manually opts out of its own evidence path).
async function insertManualEvidenceRef(
  d1: D1Database,
  args: { runId: string; kind: 'serp_snapshot' | 'paa_question'; providerTaskId: string; requestHashSeed: unknown }
): Promise<void> {
  const requestHash = await hashNormalizedInput(args.requestHashSeed);
  await d1
    .prepare(
      `INSERT INTO evidence_refs
        (id, run_id, provider, kind, operation, request_hash, provider_task_id, fetched_at, cost_usd_micro, artifact_id)
       VALUES (?, ?, 'dataforseo', ?, 'serp_task_get', ?, ?, ?, 0, NULL)`
    )
    .bind(newId('evr'), args.runId, args.kind, requestHash, args.providerTaskId, nowIso())
    .run();
}

// Polls every still-'posted' dfs_serp_tasks row for this run via
// task_get/advanced. Not-ready rows are left untouched (status stays
// 'posted') and counted as `pending`; a genuine per-task DataForSEO error
// marks the row 'failed' and the loop continues (one bad task never blocks
// the others' collection); a ready row is parsed and persisted into
// serp_snapshots + faq_evidence, marked 'completed' with its snapshot_id,
// and counted toward `completed`. A network-level throw from the task_get
// call itself (as opposed to a DataForSEO-reported per-task status) is
// treated the same as not-ready rather than a hard per-row failure: a
// transient blip on one poll should not permanently fail a row that might
// resolve cleanly on the very next attempt.
export async function collectSerpTasks(ctx: StageContext): Promise<CollectSerpTasksResult> {
  const rows = await ctx.d1
    .prepare(
      `SELECT id, keyword, service_area_id, location_code, provider_task_id
       FROM dfs_serp_tasks WHERE run_id = ? AND status = 'posted'`
    )
    .bind(ctx.runId)
    .all<DfsSerpTaskRow>();

  const locale = `${ctx.normalizedBrief.languageCode}-${ctx.normalizedBrief.countryIso}`;
  let completed = 0;
  let failed = 0;
  let pending = 0;

  for (const row of rows.results ?? []) {
    if (!row.provider_task_id) {
      pending += 1;
      continue;
    }

    let result: DfsCallResult;
    try {
      result = await blueprintDfsCall(ctx, {
        method: 'GET',
        endpoint: `/serp/google/organic/task_get/advanced/${row.provider_task_id}`,
        ttlSeconds: SERP_TASK_POST_TTL_SECONDS,
        emptyTtlSeconds: SERP_TASK_POST_EMPTY_TTL_SECONDS,
        kind: 'serp_snapshot',
        operation: 'serp_task_get',
        scopeId: row.id,
        estimateUsdMicro: 0,
        skipCache: true,
      });
    } catch {
      pending += 1;
      continue;
    }

    const meta = result.taskMetas[0];
    if (!meta) {
      pending += 1;
      continue;
    }

    if (isTaskNotReady(meta)) {
      pending += 1;
      continue;
    }

    if (!isTaskReady(meta)) {
      await ctx.d1
        .prepare(`UPDATE dfs_serp_tasks SET status = 'failed', completed_at = ? WHERE id = ?`)
        .bind(nowIso(), row.id)
        .run();
      failed += 1;
      continue;
    }

    const normalizedKeyword = normalizeKeyword(row.keyword, locale);
    const keywordRow = await ctx.d1
      .prepare(`SELECT id FROM keywords WHERE run_id = ? AND normalized_keyword = ?`)
      .bind(ctx.runId, normalizedKeyword)
      .first<{ id: string }>();
    if (!keywordRow) {
      // Defensive: every SERP query originates from a service-in-primary-area
      // seed that collect_keyword_evidence (a required, earlier stage) is
      // guaranteed to have already persisted with all-user-seeds-survive
      // retention. A missing row here means something upstream is broken,
      // not a legitimate "not ready" state -- fail this row rather than
      // violate serp_snapshots.keyword_id's NOT NULL constraint.
      await ctx.d1
        .prepare(`UPDATE dfs_serp_tasks SET status = 'failed', completed_at = ? WHERE id = ?`)
        .bind(nowIso(), row.id)
        .run();
      failed += 1;
      continue;
    }

    const snapshot = parseSerpPayload(result.items);
    const snapshotId = newId('serpsnap');
    const checkedAt = nowIso();
    await ctx.d1
      .prepare(
        `INSERT INTO serp_snapshots
          (id, run_id, keyword_id, service_area_id, location_code, language_code, checked_at,
           organic_json, related_searches_json, local_pack_present, featured_snippet_present, ai_overview_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unchecked')`
      )
      .bind(
        snapshotId,
        ctx.runId,
        keywordRow.id,
        row.service_area_id,
        row.location_code,
        ctx.normalizedBrief.languageCode,
        checkedAt,
        JSON.stringify(snapshot.organic),
        JSON.stringify(snapshot.relatedSearches),
        snapshot.localPackPresent ? 1 : 0,
        snapshot.featuredSnippetPresent ? 1 : 0
      )
      .run();

    for (const paa of snapshot.paaQuestions) {
      await ctx.d1
        .prepare(
          `INSERT INTO faq_evidence
            (id, run_id, serp_snapshot_id, question, answer_text, source_title, source_url, parent_question_id, paa_depth)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
        )
        .bind(
          newId('faq'),
          ctx.runId,
          snapshotId,
          paa.question,
          paa.answerText,
          paa.sourceTitle,
          paa.sourceUrl,
          paa.paaDepth
        )
        .run();
    }

    await insertManualEvidenceRef(ctx.d1, {
      runId: ctx.runId,
      kind: 'serp_snapshot',
      providerTaskId: row.provider_task_id,
      requestHashSeed: { taskId: row.provider_task_id, kind: 'serp_snapshot' },
    });
    for (const paa of snapshot.paaQuestions) {
      await insertManualEvidenceRef(ctx.d1, {
        runId: ctx.runId,
        kind: 'paa_question',
        providerTaskId: row.provider_task_id,
        requestHashSeed: { taskId: row.provider_task_id, kind: 'paa_question', question: paa.question },
      });
    }

    await ctx.d1
      .prepare(`UPDATE dfs_serp_tasks SET status = 'completed', completed_at = ?, snapshot_id = ? WHERE id = ?`)
      .bind(checkedAt, snapshotId, row.id)
      .run();
    completed += 1;
  }

  return { completed, pending, failed };
}
