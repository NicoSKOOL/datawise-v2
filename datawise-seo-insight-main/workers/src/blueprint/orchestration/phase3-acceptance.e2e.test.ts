import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleBlueprintRequest } from '../routes/router';
import { newId } from '../db/util';
import { processResearchRun } from './process-run';
import type { BlueprintProviderEnv } from './process-run';
import { fakeEnv } from '../test-support/env';
import type { AuthUser } from '../../auth/google';
import type {
  ApiSuccess,
  ProjectView,
  ResearchEstimate,
  ResearchRunView,
} from '../contracts/api';

// Phase 3 acceptance e2e (Task 14): the FULL Phase 3 orchestration stack
// (real resolve_market, plan_research, collect_keyword_evidence,
// discover_competitors, collect_competitor_evidence,
// validate_serps_and_questions -- Tasks 6/8/10/11/12/13, all registered by
// this same task) driven end to end through the real route handlers plus
// the real processResearchRun stage-by-stage processor, exactly as
// acceptance.e2e.test.ts already does for Phase 2. This file is TEST-ONLY:
// an assertion failing here means an earlier Phase 3 task drifted from its
// own settled contract, not that this file's expectations are wrong. Do not
// "fix" production code to make this pass without first re-reading the
// handler this task registers.
//
// Every DataForSEO call in this run is answered by the router-style fetch
// stub below (installPhase3FetchStub): no real network, fully deterministic.
// The `dfs-catalog.ts` shared stub does not cover competitor
// ranked_keywords/relevant_pages or the SERP task_post/task_get pair, so
// this file builds its own stub instead of extending the shared one (the
// shared one is also used by tests that intentionally keep discover/collect
// competitor stages at their empty-item convention; this file needs real,
// nonzero-cost content flowing through every stage to exercise the full
// assertion list).

const adminUser = {
  id: 'u1',
  google_id: 'g1',
  email: 'nico@airankingskool.com',
  name: 'Nico',
  avatar_url: '',
  subscription_tier: 'pro',
  is_community_member: false,
  is_admin: true,
  credits_used: 0,
} as AuthUser;

function makeRequest(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Request {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  return new Request(`https://api.test${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function call(
  env: any,
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<Response> {
  const method = opts.method ?? 'GET';
  const pathname = path.split('?')[0];
  return handleBlueprintRequest(makeRequest(path, opts), env, adminUser, pathname, method);
}

// Greenfield brief per this task's brief: 1 service (AC Repair), 1 primary
// area (Austin), no websiteUrl -- normalizeProjectBrief derives mode
// 'greenfield' purely from the absence of websiteUrl (domain/brief.ts).
const SAMPLE_BRIEF = {
  businessName: 'CoolBreeze HVAC',
  category: 'HVAC Contractor',
  countryIso: 'us',
  languageCode: 'en',
  services: [{ clientId: 's1', name: 'AC Repair' }],
  serviceAreas: [{ clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true }],
};

async function createProject(env: any, key = newId('idem')) {
  const res = await call(env, '/api/blueprint/v1/projects', {
    method: 'POST',
    body: SAMPLE_BRIEF,
    headers: { 'Idempotency-Key': key },
  });
  const json = (await res.json()) as ApiSuccess<ProjectView>;
  return { res, json };
}

async function createEstimate(env: any, projectId: string): Promise<ResearchEstimate> {
  const res = await call(env, `/api/blueprint/v1/projects/${projectId}/research-estimates`, {
    method: 'POST',
    body: {},
  });
  const body = (await res.json()) as ApiSuccess<ResearchEstimate>;
  return body.data;
}

// Ceilings per this task's brief: DataForSEO $2.00 (real spend across all
// six paid stages stays well under this, see the router stub's canned costs
// below), OpenRouter $0.00 (no Phase 3 handler spends OpenRouter budget).
async function startRun(
  env: any,
  projectId: string,
  estimateId: string,
  key: string
): Promise<{ res: Response; json: ApiSuccess<ResearchRunView> }> {
  const res = await call(env, `/api/blueprint/v1/projects/${projectId}/research-runs`, {
    method: 'POST',
    body: {
      estimateId,
      acceptedDataForSeoCeilingUsd: '2.00',
      acceptedOpenRouterCeilingUsd: '0.00',
    },
    headers: { 'Idempotency-Key': key },
  });
  const json = (await res.json()) as ApiSuccess<ResearchRunView>;
  return { res, json };
}

async function getRunStatus(d1: D1Database, runId: string): Promise<string> {
  const row = await d1.prepare(`SELECT status FROM research_runs WHERE id = ?`).bind(runId).first<{ status: string }>();
  if (!row) throw new Error(`run not found: ${runId}`);
  return row.status;
}

const TERMINAL_STATUSES = new Set(['succeeded', 'partial', 'failed', 'cancelled']);

// Drives a run to a terminal status without any wall-clock sleep. This
// extends the standard drainQueue helper (test-support/env.ts) with the
// retry_wait bounce validate_serps_and_questions needs: drainQueue alone
// stalls forever on this run because processResearchRun's finalizeStageAttempt
// never re-enqueues a 'wait' outcome (see env.ts's own doc comment), and
// this stage deliberately lands in retry_wait at least twice (once after
// posting the SERP task batch, once more on a not-ready task_get poll)
// before its task_get comes back ready. Each iteration either drains a
// genuinely queued message (the normal path every other stage in this run
// takes) or, when the queue is empty and the run isn't terminal yet, forces
// every retry_wait row's next_retry_at into the past and invokes
// processResearchRun directly -- standing in for the queue's delayed
// redelivery, exactly the technique acceptance.e2e.test.ts's
// driveRequiredStageToFailure and process-run.test.ts's forceRetryNow use for
// the same reason (this in-memory harness has no real timer to wait on).
async function driveRunToTerminal(
  env: BlueprintProviderEnv,
  d1: D1Database,
  runId: string,
  sent: unknown[],
  maxIterations = 60
): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    const status = await getRunStatus(d1, runId);
    if (TERMINAL_STATUSES.has(status)) return;
    if (sent.length) {
      const msg = sent.pop() as { runId: string };
      await processResearchRun(env, msg.runId, 'w1');
      continue;
    }
    await d1
      .prepare(`UPDATE research_stage_runs SET next_retry_at = ? WHERE run_id = ? AND status = 'retry_wait'`)
      .bind(new Date(Date.now() - 1000).toISOString(), runId)
      .run();
    await processResearchRun(env, runId, 'w1');
  }
  const finalStatus = await getRunStatus(d1, runId);
  if (!TERMINAL_STATUSES.has(finalStatus)) {
    throw new Error(`run ${runId} did not reach a terminal status within ${maxIterations} iterations (stuck at ${finalStatus})`);
  }
}

function catalogTaskResponse(records: unknown[]) {
  return {
    status_code: 20000,
    tasks: [{ id: 'catalog-task', status_code: 20000, status_message: 'Ok.', cost: 0, result: records }],
  };
}

const LABS_COUNTRIES = [
  {
    location_code: 2840,
    location_name: 'United States',
    country_iso_code: 'US',
    location_type: 'Country',
    languages: [{ language_code: 'en', language_name: 'English' }],
  },
];

const SERP_LOCATIONS_US = [
  { location_code: 2840, location_name: 'United States', country_iso_code: 'US', location_type: 'Country' },
  { location_code: 1023191, location_name: 'Austin,Texas,United States', country_iso_code: 'US', location_type: 'City' },
];

const SERP_LANGUAGES = [{ language_code: 'en', language_name: 'English' }];

function labsResponse(items: any[], cost: number) {
  return {
    status_code: 20000,
    tasks: [{ id: 'labs-task', status_code: 20000, status_message: 'Ok.', cost, result: [{ items }] }],
  };
}

// Builds the shared, stateful DataForSEO fetch stub this whole e2e drives
// through. Stateful pieces (serpTaskCounter, serpPollCounts) are scoped to
// one call of this function so run1 and run2 (both driven through the SAME
// installed stub instance across the whole test, per this task's brief:
// "same fetch stub, same KV") never cross-contaminate SERP task ids/poll
// counts between the two runs -- each run's own task_post call mints a fresh
// task id via the counter, and that id's poll count starts at zero.
function installPhase3FetchStub(): () => void {
  const original = globalThis.fetch;
  let serpTaskSeq = 0;
  const serpPollCounts = new Map<string, number>();

  globalThis.fetch = (async (url: any, init?: any) => {
    const href = String(url);
    const rawBody = init?.body ? JSON.parse(init.body) : undefined;
    const body = Array.isArray(rawBody) ? rawBody[0] : rawBody ?? {};

    if (href.includes('/dataforseo_labs/locations_and_languages')) {
      return { ok: true, status: 200, json: async () => catalogTaskResponse(LABS_COUNTRIES) } as any;
    }
    if (href.includes('/serp/google/locations/')) {
      return { ok: true, status: 200, json: async () => catalogTaskResponse(SERP_LOCATIONS_US) } as any;
    }
    if (href.includes('/serp/google/languages')) {
      return { ok: true, status: 200, json: async () => catalogTaskResponse(SERP_LANGUAGES) } as any;
    }

    // collect_keyword_evidence: keyword_ideas gets data ONLY for the
    // service-in-primary-area seed ("ac repair austin"); the bare category
    // ("hvac contractor") and service ("ac repair") seeds get nothing from
    // ANY provider call below, so they survive only via
    // appendMissingUserSeeds's all-null-metrics user-seed retention --
    // guaranteeing at least one persisted keywords row with
    // metrics_missing = 1 and NULL search_volume/cpc/difficulty, per this
    // task's brief assertion 2.
    if (href.includes('/dataforseo_labs/google/keyword_ideas/live')) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          labsResponse([{ keyword: 'ac repair austin', keyword_info: { search_volume: 800, cpc: 5.5 } }], 0.05),
      } as any;
    }
    if (href.includes('/dataforseo_labs/google/keyword_suggestions/live')) {
      if (body.keyword === 'ac repair austin') {
        return {
          ok: true,
          status: 200,
          json: async () => labsResponse([{ keyword: 'ac repair austin', keyword_info: { search_volume: 800 } }], 0.02),
        } as any;
      }
      return { ok: true, status: 200, json: async () => labsResponse([], 0.02) } as any;
    }
    if (href.includes('/dataforseo_labs/google/keyword_overview/live')) {
      // Deliberately empty: 'hvac contractor'/'ac repair' stay volume-null
      // forever (assertion 2's metrics_missing=1 row).
      return { ok: true, status: 200, json: async () => labsResponse([], 0.01) } as any;
    }
    if (href.includes('/dataforseo_labs/google/bulk_keyword_difficulty/live')) {
      return {
        ok: true,
        status: 200,
        json: async () => labsResponse([{ keyword: 'ac repair austin', keyword_difficulty: 42 }], 0.02),
      } as any;
    }

    // discover_competitors (greenfield -> serp_competitors): yelp.com is an
    // EXCLUDED_COMPETITOR_DOMAINS entry and must never survive selection
    // (assertion 3); rivalhvac.com/coolairaustin.com are real candidates,
    // both selected (2, inside the 1-5 range assertion 3 requires).
    if (href.includes('/dataforseo_labs/google/serp_competitors/live')) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          labsResponse(
            [
              { domain: 'yelp.com', avg_position: 1 },
              { domain: 'rivalhvac.com', avg_position: 3 },
              { domain: 'coolairaustin.com', avg_position: 5 },
            ],
            0.05
          ),
      } as any;
    }

    // collect_competitor_evidence: both selected competitors return real
    // (non-error) ranked_keywords/relevant_pages content, so
    // collectCompetitorEvidenceHandler's anyFailure stays false and the
    // stage reports 'succeeded' (never 'partial' -- this run's assertion 1
    // requires none of the six real stages appear in partial_reasons_json).
    if (href.includes('/dataforseo_labs/google/ranked_keywords/live')) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          labsResponse(
            [
              {
                keyword_data: {
                  keyword: `${body.target} ac repair`,
                  keyword_info: { search_volume: 40, cpc: 2 },
                  keyword_properties: { keyword_difficulty: 25 },
                },
                ranked_serp_element: {
                  serp_item: { url: `https://${body.target}/ac-repair`, rank_group: 4, type: 'organic', etv: 8 },
                },
              },
            ],
            0.05
          ),
      } as any;
    }
    if (href.includes('/dataforseo_labs/google/relevant_pages/live')) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          labsResponse([{ page_address: `https://${body.target}/ac-repair/`, metrics: { organic: { count: 3, etv: 12 } } }], 0.03),
      } as any;
    }

    // validate_serps_and_questions: task_post mints a fresh task id per call
    // (keeps run1/run2 fully independent); task_get polls that same id
    // 'not ready' on its first poll, then 'ready' with one organic result and
    // one People Also Ask question (assertion 4: serp_snapshots >= 1,
    // faq_evidence >= 1; assertion 5's serp_snapshot/paa_question evidence
    // kinds).
    if (href.includes('/serp/google/organic/task_post')) {
      serpTaskSeq += 1;
      const taskId = `serp-task-${serpTaskSeq}`;
      serpPollCounts.set(taskId, 0);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status_code: 20000,
          tasks: [{ id: taskId, status_code: 20100, status_message: 'Task Created.', cost: 0.01, result: [{ id: taskId }] }],
        }),
      } as any;
    }
    if (href.includes('/serp/google/organic/task_get/advanced/')) {
      const taskId = href.split('/serp/google/organic/task_get/advanced/')[1];
      const polls = (serpPollCounts.get(taskId) ?? 0) + 1;
      serpPollCounts.set(taskId, polls);
      if (polls === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status_code: 20000,
            tasks: [{ id: taskId, status_code: 40601, status_message: 'Task In Queue.', cost: 0, result: null }],
          }),
        } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status_code: 20000,
          tasks: [
            {
              id: taskId,
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0,
              result: [
                {
                  items: [
                    {
                      type: 'organic',
                      rank_group: 1,
                      url: 'https://rivalhvac.com/ac-repair-austin',
                      title: 'AC Repair Austin',
                      domain: 'rivalhvac.com',
                    },
                    {
                      type: 'people_also_ask',
                      items: [
                        {
                          title: 'How much does AC repair cost in Austin?',
                          expanded_element: [
                            {
                              description: 'Typically $150-$400 depending on the issue.',
                              title: 'AC Repair Cost Guide',
                              url: 'https://example.com/ac-repair-cost-guide',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      } as any;
    }

    throw new Error(`installPhase3FetchStub: unexpected fetch to ${href}`);
  }) as any;

  return () => {
    globalThis.fetch = original;
  };
}

interface KeywordRow {
  metrics_missing: number;
  search_volume: number | null;
  cpc_usd_micro: number | null;
  keyword_difficulty: number | null;
}

interface StageCostRow {
  stage_name: string;
  cost_usd_micro: number;
}

describe('Phase 3 orchestration acceptance', () => {
  let restoreFetch: () => void;
  beforeEach(() => {
    restoreFetch = installPhase3FetchStub();
  });
  afterEach(() => {
    restoreFetch();
  });

  it('acceptance: a full greenfield drive through all six real Phase 3 stages ends partial (collect_us_fanout gap only), with real keyword/competitor/SERP evidence and reconciled DataForSEO spend; a second identical run on warm KV costs strictly less', async () => {
    const env = fakeEnv();
    const { json: project } = await createProject(env);
    const projectId = project.data.id;

    // --- Run 1: cold KV, every DFS call is a real (non-cached) miss. ---
    const estimate1 = await createEstimate(env, projectId);
    const { json: run1 } = await startRun(env, projectId, estimate1.estimateId, newId('idem'));
    expect(run1.data.status).toBe('queued');

    await driveRunToTerminal(env, env.BLUEPRINT_DB, run1.data.id, env.BLUEPRINT_QUEUE.sent);

    // Assertion 1: run partial with reasons containing collect_us_fanout and
    // nothing about the six real stages (every one of them must have
    // reached 'succeeded', never 'skipped'/'partial'/'failed').
    const finalStatus = await getRunStatus(env.BLUEPRINT_DB, run1.data.id);
    expect(finalStatus).toBe('partial');
    const runRow = await env.BLUEPRINT_DB
      .prepare(
        `SELECT partial_reasons_json, dataforseo_actual_usd_micro, dataforseo_reserved_usd_micro
         FROM research_runs WHERE id = ?`
      )
      .bind(run1.data.id)
      .first<{ partial_reasons_json: string; dataforseo_actual_usd_micro: number; dataforseo_reserved_usd_micro: number }>();
    const partialReasons: string[] = JSON.parse(runRow!.partial_reasons_json);
    expect(partialReasons).toContain('collect_us_fanout');
    const sixRealStages = [
      'resolve_market',
      'plan_research',
      'collect_keyword_evidence',
      'discover_competitors',
      'collect_competitor_evidence',
      'validate_serps_and_questions',
    ];
    for (const stage of sixRealStages) {
      expect(partialReasons).not.toContain(stage);
    }

    // Assertion 2: keywords count > 0, at least one row with
    // metrics_missing = 1 and NULL metric columns (the bare
    // 'hvac contractor'/'ac repair' user seeds, never covered by any
    // provider response in the stub above).
    const keywordRows = await env.BLUEPRINT_DB
      .prepare(`SELECT metrics_missing, search_volume, cpc_usd_micro, keyword_difficulty FROM keywords WHERE run_id = ?`)
      .bind(run1.data.id)
      .all<KeywordRow>();
    expect(keywordRows.results.length).toBeGreaterThan(0);
    const missingMetricsRow = keywordRows.results.find((r) => r.metrics_missing === 1);
    expect(missingMetricsRow).toBeTruthy();
    expect(missingMetricsRow!.search_volume).toBeNull();
    expect(missingMetricsRow!.cpc_usd_micro).toBeNull();
    expect(missingMetricsRow!.keyword_difficulty).toBeNull();

    // Assertion 3: competitors selected between 1 and 5, no excluded
    // directory domain (yelp.com) among them.
    const selectedCompetitors = await env.BLUEPRINT_DB
      .prepare(`SELECT domain FROM competitors WHERE run_id = ? AND selected = 1`)
      .bind(run1.data.id)
      .all<{ domain: string }>();
    expect(selectedCompetitors.results.length).toBeGreaterThanOrEqual(1);
    expect(selectedCompetitors.results.length).toBeLessThanOrEqual(5);
    expect(selectedCompetitors.results.map((r) => r.domain)).not.toContain('yelp.com');

    // Assertion 4: serp_snapshots >= 1, faq_evidence >= 1.
    const serpSnapshotCount = await env.BLUEPRINT_DB
      .prepare(`SELECT COUNT(*) AS count FROM serp_snapshots WHERE run_id = ?`)
      .bind(run1.data.id)
      .first<{ count: number }>();
    expect(serpSnapshotCount!.count).toBeGreaterThanOrEqual(1);
    const faqEvidenceCount = await env.BLUEPRINT_DB
      .prepare(`SELECT COUNT(*) AS count FROM faq_evidence WHERE run_id = ?`)
      .bind(run1.data.id)
      .first<{ count: number }>();
    expect(faqEvidenceCount!.count).toBeGreaterThanOrEqual(1);

    // Assertion 5: evidence_refs has rows for all four expected kinds.
    const evidenceKinds = await env.BLUEPRINT_DB
      .prepare(`SELECT DISTINCT kind FROM evidence_refs WHERE run_id = ?`)
      .bind(run1.data.id)
      .all<{ kind: string }>();
    const kindSet = new Set(evidenceKinds.results.map((r) => r.kind));
    for (const kind of ['keyword_metric', 'ranking', 'serp_snapshot', 'paa_question']) {
      expect(kindSet.has(kind)).toBe(true);
    }

    // Assertion 6: real, bounded DataForSEO spend, fully reconciled (nothing
    // left reserved once the run has settled).
    expect(runRow!.dataforseo_actual_usd_micro).toBeGreaterThan(0);
    expect(runRow!.dataforseo_actual_usd_micro).toBeLessThanOrEqual(2_000_000);
    expect(runRow!.dataforseo_reserved_usd_micro).toBe(0);

    // Assertion 7: every one of the six real stages recorded a
    // research_stage_runs.cost_usd_micro. Five of them (collect_keyword_
    // evidence, discover_competitors, collect_competitor_evidence,
    // validate_serps_and_questions) pay real DataForSEO cost and must show
    // > 0. resolve_market and plan_research make ONLY documented-free
    // catalog GETs / no DFS calls at all (see providers/dataforseo/
    // catalogs.ts's estimateUsdMicro: 0 on every catalog fetch) -- their
    // stage row cost is legitimately 0, not a bug, so this only asserts >= 0
    // for them.
    //
    // Task 4 fixed the prior "documented exception" here: cost_usd_micro is
    // now the SUM of the stage's own provider_usage rows (process-run.ts),
    // not a value forwarded from the handler's own output. That fixed
    // validateSerpsAndQuestionsHandler specifically, since its output object
    // is `{ snapshots, failed }` (no stageCostUsdMicro field) and its real
    // spend (the task_post call) lands on an earlier attempt than the one
    // that finally completes -- exactly the two failure modes Task 4's brief
    // called out. It now shows real cost > 0 like every other paying stage.
    const stageCostRows = await env.BLUEPRINT_DB
      .prepare(`SELECT stage_name, cost_usd_micro FROM research_stage_runs WHERE run_id = ? AND stage_name IN (${sixRealStages.map(() => '?').join(',')})`)
      .bind(run1.data.id, ...sixRealStages)
      .all<StageCostRow>();
    const costByStage = new Map(stageCostRows.results.map((r) => [r.stage_name, r.cost_usd_micro]));
    expect(costByStage.size).toBe(6);
    for (const stage of sixRealStages) {
      expect(costByStage.get(stage)).toBeGreaterThanOrEqual(0);
    }
    for (const payingStage of [
      'collect_keyword_evidence',
      'discover_competitors',
      'collect_competitor_evidence',
      'validate_serps_and_questions',
    ]) {
      expect(costByStage.get(payingStage)).toBeGreaterThan(0);
    }

    // Assertion 8: a second identical run on the SAME env (same KV, same
    // fetch stub) reports strictly lower dataforseo_actual_usd_micro. Every
    // Labs POST/catalog GET body in this run is identical run-to-run (same
    // brief -> same seeds/queries/domains), and blueprintDfsCall's cache key
    // is hashed from [method, endpoint, body] BEFORE the per-run `tag` field
    // is appended (call.ts) -- so every one of those calls is a KV cache hit
        // (cost 0) on run 2. Only serp/google/organic/task_post embeds the run
    // id directly inside its request body's own `tag` field (serp.ts builds
    // that tag before ever reaching blueprintDfsCall), so it alone remains a
    // real, paid cache miss every run -- run 2's actual cost is exactly that
    // one task_post charge, strictly less than run 1's full six-stage spend.
    const estimate2 = await createEstimate(env, projectId);
    const { json: run2 } = await startRun(env, projectId, estimate2.estimateId, newId('idem'));
    expect(run2.data.id).not.toBe(run1.data.id);

    await driveRunToTerminal(env, env.BLUEPRINT_DB, run2.data.id, env.BLUEPRINT_QUEUE.sent);
    expect(await getRunStatus(env.BLUEPRINT_DB, run2.data.id)).toBe('partial');

    const run2Row = await env.BLUEPRINT_DB
      .prepare(`SELECT dataforseo_actual_usd_micro FROM research_runs WHERE id = ?`)
      .bind(run2.data.id)
      .first<{ dataforseo_actual_usd_micro: number }>();
    expect(run2Row!.dataforseo_actual_usd_micro).toBeGreaterThan(0);
    expect(run2Row!.dataforseo_actual_usd_micro).toBeLessThan(runRow!.dataforseo_actual_usd_micro);
  });
});
