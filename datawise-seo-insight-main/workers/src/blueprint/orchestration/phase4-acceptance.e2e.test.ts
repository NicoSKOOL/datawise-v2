import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleBlueprintRequest } from '../routes/router';
import { newId } from '../db/util';
import { processResearchRun } from './process-run';
import type { BlueprintProviderEnv } from './process-run';
import { fakeEnv } from '../test-support/env';
import { BLUEPRINT_STAGES } from '../contracts/enums';
import type { AuthUser } from '../../auth/google';
import type { ApiSuccess, ProjectView, ResearchEstimate, ResearchRunView } from '../contracts/api';

// Page types the engine mints from the brief skeleton (home, hubs, service,
// location, contact/about). Everything else (resource/faq/comparison/
// service_location) is a dedicated, cluster-derived "non-skeleton" page -- the
// pages the Task 16 fix requires to carry a scoreBreakdown AND non-empty
// evidenceRefs. blueprint_pages has no isSkeleton column, so page_type is the
// deterministic proxy.
const SKELETON_PAGE_TYPES = new Set(['home', 'hub', 'service', 'location', 'contact', 'company']);

// Phase 4 acceptance e2e (Task 21): the FINAL Phase 4 verification. It drives
// the WHOLE clustering + page-planning pipeline for real -- every stage 8-19
// executes its registered handler (normalize_keyword_universe,
// embed_keyword_features against the fake bge-m3 AI binding, real
// build_provisional_clusters, real validate_serps_and_questions posting/
// polling live SERPs, real refine_clusters, real parse_competitor_pages, real
// build_page_plan, real overlay_existing_site over a stubbed sitemap, real
// validate_blueprint, real publish_blueprint) -- with ONLY the external
// providers stubbed: DataForSEO answered by the router-style fetch stub below,
// embeddings by the deterministic fake AI binding, the site crawl by canned
// robots/sitemap/title responses. No stage handler is overridden.
//
// This file is TEST-ONLY: an assertion failing here means an earlier Phase 4
// task drifted from its own settled contract, not that this file's
// expectations are wrong. Each assertion is labeled with the spec acceptance
// item it proves (docs/superpowers/plans/2026-07-14-blueprint-phase-4.md
// Verification section + blueprint-v1-developer-handoff Phase 4 list).

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

// Existing-site brief: websiteUrl present -> normalizeProjectBrief derives mode
// 'existing_site', so overlay_existing_site runs for real. Two services and two
// areas give a 2x2 = 4 service/area combination space; the seeded keyword
// evidence links clusters to SERVICES only (no city tokens), so NO cluster
// demands any service-location combination -- the "no auto service-x-location"
// acceptance item is asserted against all four absent combos. Austin carries a
// uniqueProof so the guardrail's local-proof path is exercised even though no
// cluster earns a service_location page.
const SAMPLE_BRIEF = {
  businessName: 'CoolBreeze HVAC',
  category: 'HVAC Contractor',
  websiteUrl: 'https://coolbreezehvac.com',
  countryIso: 'us',
  languageCode: 'en',
  services: [
    { clientId: 's1', name: 'AC Repair' },
    { clientId: 's2', name: 'Furnace Repair', priority: 'secondary' as const },
  ],
  serviceAreas: [
    { clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true, uniqueProof: ['Office on South Lamar'] },
    { clientId: 'a2', city: 'Round Rock', countryIso: 'us', isPrimary: false },
  ],
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

async function startRun(
  env: any,
  projectId: string,
  estimateId: string,
  key: string
): Promise<ApiSuccess<ResearchRunView>> {
  const res = await call(env, `/api/blueprint/v1/projects/${projectId}/research-runs`, {
    method: 'POST',
    body: { estimateId, acceptedDataForSeoCeilingUsd: '5.00', acceptedOpenRouterCeilingUsd: '0.00' },
    headers: { 'Idempotency-Key': key },
  });
  return (await res.json()) as ApiSuccess<ResearchRunView>;
}

async function getRunStatus(d1: D1Database, runId: string): Promise<string> {
  const row = await d1.prepare(`SELECT status FROM research_runs WHERE id = ?`).bind(runId).first<{ status: string }>();
  if (!row) throw new Error(`run not found: ${runId}`);
  return row.status;
}

const TERMINAL_STATUSES = new Set(['succeeded', 'partial', 'failed', 'cancelled']);

// Drives a run to terminal without wall-clock sleep, bouncing retry_wait rows
// (validate_serps_and_questions posts a SERP batch, lands in retry_wait, then
// polls it ready). Same technique as phase3-acceptance.e2e.test.ts.
async function driveRunToTerminal(
  env: BlueprintProviderEnv,
  d1: D1Database,
  runId: string,
  sent: unknown[],
  maxIterations = 80
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
    throw new Error(`run ${runId} did not reach terminal within ${maxIterations} iterations (stuck at ${finalStatus})`);
  }
}

// ---------- DFS envelope + catalog helpers ----------

function catalogTaskResponse(records: unknown[]) {
  return { status_code: 20000, tasks: [{ id: 'catalog-task', status_code: 20000, status_message: 'Ok.', cost: 0, result: records }] };
}
const LABS_COUNTRIES = [
  { location_code: 2840, location_name: 'United States', country_iso_code: 'US', location_type: 'Country', languages: [{ language_code: 'en', language_name: 'English' }] },
];
const SERP_LOCATIONS_US = [
  { location_code: 2840, location_name: 'United States', country_iso_code: 'US', location_type: 'Country' },
  { location_code: 1023191, location_name: 'Austin,Texas,United States', country_iso_code: 'US', location_type: 'City' },
];
const SERP_LANGUAGES = [{ language_code: 'en', language_name: 'English' }];

function labsResponse(items: any[], cost: number) {
  return { status_code: 20000, tasks: [{ id: 'labs-task', status_code: 20000, status_message: 'Ok.', cost, result: [{ items }] }] };
}

// A keyword_ideas / keyword_overview item carrying BOTH the metrics
// normalizeKeywordItem reads at collect time (keyword_info.search_volume/cpc,
// keyword_properties.keyword_difficulty) AND the enrichment fields
// normalize_keyword_universe re-parses from the same stored artifact
// (keyword_properties.core_keyword, search_intent_info.main_intent). Sharing a
// core_keyword makes two keywords embed to the SAME text ("<core> | <category>")
// and therefore the SAME fake vector (cosine 1) -> they cluster together.
function kwItem(keyword: string, core: string, intent: string, volume: number, difficulty = 30, cpc = 4) {
  return {
    keyword,
    keyword_info: { search_volume: volume, cpc },
    keyword_properties: { core_keyword: core, keyword_difficulty: difficulty },
    search_intent_info: { main_intent: intent },
  };
}

// Two service-linked keyword families, each family sharing a core_keyword so its
// members merge into one non-singleton cluster; the two families have distinct
// cores (distinct embedding text -> ~orthogonal vectors) so they stay separate
// clusters. No keyword contains a city token, so no cluster gets an area link,
// so no cluster demands any service-location page.
// "ac repair guide" shares the "ac repair" core (so it embeds identically to the
// transactional AC cluster: cosine 1) but carries INFORMATIONAL intent, which the
// incompatible-intent constraint forbids from merging. It therefore stays its own
// cluster and, at refine time, surfaces as an intent_exception adjudication (a
// pending/insufficient_evidence decision carrying score_context) between the two
// same-core clusters -- exercising the cluster_adjudications persistence path.
// Core "ac unit repair" is deliberately distinct from the bare "ac repair"
// service seed (which normalize retains with a null intent). A null-intent seed
// sharing a core would bridge the informational keyword into the transactional
// cluster (a null intent never triggers the incompatible-intent constraint); a
// distinct core keeps the seed from bridging, so the informational keyword stays
// its own cluster and the intent conflict survives to refine.
const KW_IDEAS = [
  kwItem('ac unit repair cost', 'ac unit repair', 'transactional', 300),
  kwItem('ac unit repair prices', 'ac unit repair', 'transactional', 120),
  kwItem('ac unit repair guide', 'ac unit repair', 'informational', 40),
  kwItem('furnace repair service', 'furnace repair', 'commercial', 90),
  kwItem('furnace repair company', 'furnace repair', 'commercial', 60),
];
// Sum of every seeded keyword volume. Each seeded keyword merges into exactly one
// cluster, and addressableDemandTotal sums each cluster's member volumes once, so
// the plan-wide total must equal this exactly (the "no double-counted demand"
// invariant). User-seed keywords carry null volume and contribute nothing.
const SUM_IDEAS_VOLUME = 300 + 120 + 40 + 90 + 60;

const COMPETITORS = ['rivalhvac.com', 'coolairaustin.com'];

// ranked_keywords for a competitor domain: gives every seeded keyword a ranked
// URL on that domain, so loadCompetitorRankingUrls has SERP-overlap evidence and
// collect_competitor_evidence records topPages. Keyed by body.target (the
// competitor domain) so overlay's own-domain labs fallback (never reached here,
// since the sitemap resolves) would not collide.
function rankedKeywordsFor(domain: string) {
  return KW_IDEAS.map((k) => ({
    keyword_data: {
      keyword: k.keyword,
      keyword_info: { search_volume: k.keyword_info.search_volume, cpc: k.keyword_info.cpc },
      keyword_properties: { keyword_difficulty: 25, core_keyword: k.keyword_properties.core_keyword },
    },
    ranked_serp_element: { serp_item: { url: `https://${domain}/${k.keyword.replace(/\s+/g, '-')}`, rank_group: 4, type: 'organic', etv: 8 } },
  }));
}

// A content_parsing page whose title names the cluster core tokens (so
// competitorPageIsDedicated matches) and whose body clears the 400-char floor.
function contentParsingItem(title: string) {
  const filler = 'This page covers the topic in depth with pricing, process, timelines, and frequently asked questions. '.repeat(6);
  return {
    status_code: 200,
    page_content: {
      header: { primary_content: [{ text: `${title}. ${filler}`, important: true }] },
      main_topic: [{ h_title: title, level: 2, primary_content: [{ text: filler }] }],
      secondary_topic: [],
    },
  };
}

// ---------- sitemap / site bodies (overlay) ----------

const SITE = 'https://coolbreezehvac.com';
function urlset(urls: string[]): string {
  return `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`;
}
function robots(sitemaps: string[]): string {
  return sitemaps.map((s) => `Sitemap: ${s}`).join('\n');
}
function titleBody(title: string): string {
  return `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>content</p></body></html>`;
}

// Existing site inventory: URLs that clearly correspond to planned pages (a
// service page, a dedicated cluster page) plus a near-duplicate that should
// consolidate and an orphan. The overlay matcher decides keep/update/consolidate;
// this test asserts the resulting invariants, not exact per-URL verdicts.
const EXISTING_URLS = [
  `${SITE}/ac-repair`,
  `${SITE}/ac-repair-cost`,
  `${SITE}/furnace-repair`,
  `${SITE}/ac-repair-services-near-me`,
  `${SITE}/blog/company-news`,
];

function installFetchStub(): () => void {
  const original = globalThis.fetch;
  let serpTaskSeq = 0;
  const serpPollCounts = new Map<string, number>();

  globalThis.fetch = (async (url: any, init?: any) => {
    const href = String(url);
    const rawBody = init?.body ? JSON.parse(init.body) : undefined;
    const body = Array.isArray(rawBody) ? rawBody[0] : rawBody ?? {};

    // ---- catalogs ----
    if (href.includes('/dataforseo_labs/locations_and_languages')) {
      return { ok: true, status: 200, json: async () => catalogTaskResponse(LABS_COUNTRIES) } as any;
    }
    if (href.includes('/serp/google/locations/')) {
      return { ok: true, status: 200, json: async () => catalogTaskResponse(SERP_LOCATIONS_US) } as any;
    }
    if (href.includes('/serp/google/languages')) {
      return { ok: true, status: 200, json: async () => catalogTaskResponse(SERP_LANGUAGES) } as any;
    }

    // ---- keyword evidence ----
    if (href.includes('/dataforseo_labs/google/keyword_ideas/live')) {
      return { ok: true, status: 200, json: async () => labsResponse(KW_IDEAS, 0.05) } as any;
    }
    if (href.includes('/dataforseo_labs/google/keyword_suggestions/live')) {
      return { ok: true, status: 200, json: async () => labsResponse([], 0.02) } as any;
    }
    // existing_site mode: collect_keyword_evidence pulls the own domain's ranked
    // keywords too. Returns the same universe so the site's pages reinforce the
    // clusters rather than introducing city-token keywords.
    if (href.includes('/dataforseo_labs/google/keywords_for_site/live')) {
      return { ok: true, status: 200, json: async () => labsResponse(KW_IDEAS, 0.05) } as any;
    }
    if (href.includes('/dataforseo_labs/google/keyword_overview/live')) {
      return { ok: true, status: 200, json: async () => labsResponse(KW_IDEAS, 0.01) } as any;
    }
    if (href.includes('/dataforseo_labs/google/bulk_keyword_difficulty/live')) {
      return { ok: true, status: 200, json: async () => labsResponse(KW_IDEAS.map((k) => ({ keyword: k.keyword, keyword_difficulty: 30 })), 0.02) } as any;
    }

    // ---- competitors ----
    // existing_site mode discovers via competitors_domain against the own
    // domain; estimatedTraffic reads full_domain_metrics.organic.etv (Task 3 ops
    // fix), so both candidates carry a non-null estimated_traffic.
    if (href.includes('/dataforseo_labs/google/competitors_domain/live')) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          labsResponse(
            [
              { domain: 'yelp.com', intersections: 30, full_domain_metrics: { organic: { etv: 9000 } } },
              { domain: 'rivalhvac.com', intersections: 24, full_domain_metrics: { organic: { etv: 4200 } } },
              { domain: 'coolairaustin.com', intersections: 18, full_domain_metrics: { organic: { etv: 3100 } } },
            ],
            0.05
          ),
      } as any;
    }
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
    if (href.includes('/dataforseo_labs/google/ranked_keywords/live')) {
      const target = String(body.target ?? '');
      const known = COMPETITORS.find((d) => target.includes(d));
      return { ok: true, status: 200, json: async () => labsResponse(known ? rankedKeywordsFor(known) : [], 0.05) } as any;
    }
    if (href.includes('/dataforseo_labs/google/relevant_pages/live')) {
      const target = String(body.target ?? '');
      const known = COMPETITORS.find((d) => target.includes(d));
      return {
        ok: true,
        status: 200,
        json: async () =>
          labsResponse(known ? [{ page_address: `https://${known}/ac-repair-cost`, metrics: { organic: { count: 3, etv: 12 } } }] : [], 0.03),
      } as any;
    }

    // ---- live SERP (validate_serps_and_questions) ----
    if (href.includes('/serp/google/organic/task_post')) {
      serpTaskSeq += 1;
      const taskId = `serp-task-${serpTaskSeq}`;
      serpPollCounts.set(taskId, 0);
      return {
        ok: true,
        status: 200,
        json: async () => ({ status_code: 20000, tasks: [{ id: taskId, status_code: 20100, status_message: 'Task Created.', cost: 0.01, result: [{ id: taskId }] }] }),
      } as any;
    }
    if (href.includes('/serp/google/organic/task_get/advanced/')) {
      const taskId = href.split('/serp/google/organic/task_get/advanced/')[1];
      const polls = (serpPollCounts.get(taskId) ?? 0) + 1;
      serpPollCounts.set(taskId, polls);
      if (polls === 1) {
        return { ok: true, status: 200, json: async () => ({ status_code: 20000, tasks: [{ id: taskId, status_code: 40601, status_message: 'Task In Queue.', cost: 0, result: null }] }) } as any;
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
                    { type: 'organic', rank_group: 1, url: 'https://rivalhvac.com/ac-repair-cost', title: 'AC Repair Cost', domain: 'rivalhvac.com' },
                    { type: 'organic', rank_group: 2, url: 'https://coolairaustin.com/ac-repair-cost', title: 'AC Repair Pricing', domain: 'coolairaustin.com' },
                    {
                      type: 'people_also_ask',
                      items: [
                        {
                          title: 'How much does AC repair cost?',
                          expanded_element: [{ description: 'Typically $150-$400.', title: 'AC Repair Cost Guide', url: 'https://example.com/ac-repair-cost' }],
                        },
                      ],
                    },
                    { type: 'related_searches', items: ['ac repair prices', 'furnace repair service'] },
                  ],
                },
              ],
            },
          ],
        }),
      } as any;
    }

    // ---- competitor page parsing (parse_competitor_pages) ----
    if (href.includes('/on_page/content_parsing/live')) {
      return { ok: true, status: 200, json: async () => labsResponse([contentParsingItem('AC Repair Cost Guide')], 0.01) } as any;
    }

    // ---- overlay site crawl (non-DFS fetches) ----
    if (href === `${SITE}/robots.txt`) {
      return new Response(robots([`${SITE}/sitemap.xml`]), { status: 200 }) as any;
    }
    if (href === `${SITE}/sitemap.xml`) {
      return new Response(urlset(EXISTING_URLS), { status: 200 }) as any;
    }
    if (EXISTING_URLS.includes(href)) {
      const slug = href.slice(SITE.length + 1);
      return new Response(titleBody(slug.replace(/[-/]/g, ' ')), { status: 200 }) as any;
    }

    throw new Error(`installFetchStub: unexpected fetch to ${href}`);
  }) as any;

  return () => {
    globalThis.fetch = original;
  };
}

interface StageRow {
  stage_name: string;
  status: string;
  ruleset_version: string | null;
  cost_usd_micro: number;
  output_present: number;
}
interface PageRow {
  logical_page_id: string;
  page_type: string;
  slug: string;
  primary_keyword_normalized: string | null;
  recommendation: string;
  consolidate_target_logical_page_id: string | null;
  scoreBreakdown: unknown;
  evidenceRefs: string[];
}

interface RunSnapshot {
  runId: string;
  status: string;
  stages: Map<string, StageRow>;
  clusters: Array<{ id: string; label: string; page_candidate: string | null; ruleset_version: string; scoreBreakdownPresent: boolean }>;
  membershipCanonical: string;
  logicalIds: Set<string>;
  version: { schema_version: string; ruleset_version: string; latest_revision_id: string };
  summary: any;
  revisionHash: string;
  pages: PageRow[];
  slugs: string[];
  primaryKeywords: Array<string | null>;
  adjudications: Array<{ case_type: string; decision: string; scoreContextPresent: boolean }>;
  overlayConsolidations: Array<{ existingUrl: string; consolidateTargetLogicalId: string | null }>;
  parsedCount: number;
  existingCount: number;
  serpSnapshotCount: number;
  competitors: Array<{ domain: string; selected: number; estimated_traffic: number | null }>;
}

// Drives one complete route->run->drain and reads back everything the
// acceptance assertions need. Called twice (fresh env each time) so the
// reproducibility assertion can diff two fully independent drives.
async function driveFullRun(env: ReturnType<typeof fakeEnv>): Promise<RunSnapshot> {
  const db = env.BLUEPRINT_DB;
  const { json: project } = await createProject(env);
  const estimate = await createEstimate(env, project.data.id);
  const run = await startRun(env, project.data.id, estimate.estimateId, newId('idem'));
  expect(run.data.status).toBe('queued');
  await driveRunToTerminal(env, db, run.data.id, env.BLUEPRINT_QUEUE.sent);
  const runId = run.data.id;

  const status = await getRunStatus(db, runId);
  const stageRows = (
    await db
      .prepare(`SELECT stage_name, status, ruleset_version, cost_usd_micro, output_json IS NOT NULL AS output_present FROM research_stage_runs WHERE run_id = ?`)
      .bind(runId)
      .all<StageRow>()
  ).results;
  const stages = new Map(stageRows.map((r) => [r.stage_name, r]));

  const clusterRows = (
    await db
      .prepare(`SELECT id, label, page_candidate, ruleset_version, score_breakdown_json FROM keyword_clusters WHERE run_id = ? ORDER BY id`)
      .bind(runId)
      .all<{ id: string; label: string; page_candidate: string | null; ruleset_version: string; score_breakdown_json: string | null }>()
  ).results;
  const clusters = clusterRows.map((c) => ({
    id: c.id,
    label: c.label,
    page_candidate: c.page_candidate,
    ruleset_version: c.ruleset_version,
    scoreBreakdownPresent: c.score_breakdown_json !== null,
  }));

  const memberRows = (
    await db
      .prepare(
        `SELECT kc.label AS label, k.normalized_keyword AS keyword
         FROM cluster_keywords ck
         JOIN keyword_clusters kc ON kc.id = ck.cluster_id
         JOIN keywords k ON k.id = ck.keyword_id
         WHERE kc.run_id = ? ORDER BY kc.label, k.normalized_keyword`
      )
      .bind(runId)
      .all<{ label: string; keyword: string }>()
  ).results;
  const membershipMap = new Map<string, string[]>();
  for (const row of memberRows) {
    const list = membershipMap.get(row.label) ?? [];
    list.push(row.keyword);
    membershipMap.set(row.label, list);
  }
  const membershipCanonical = JSON.stringify([...membershipMap.entries()].sort((a, b) => a[0].localeCompare(b[0])));

  const version = await db
    .prepare(`SELECT schema_version, ruleset_version, latest_revision_id FROM blueprint_versions WHERE run_id = ?`)
    .bind(runId)
    .first<{ schema_version: string; ruleset_version: string; latest_revision_id: string }>();
  if (!version) throw new Error('no blueprint_versions row');
  const summaryRow = await db.prepare(`SELECT summary_json FROM blueprint_versions WHERE run_id = ?`).bind(runId).first<{ summary_json: string }>();
  const summary = JSON.parse(summaryRow!.summary_json);
  const revRow = await db.prepare(`SELECT revision_hash FROM blueprint_revisions WHERE id = ?`).bind(version.latest_revision_id).first<{ revision_hash: string }>();

  const pageRows = (
    await db
      .prepare(
        `SELECT logical_page_id, page_type, slug, primary_keyword_normalized, recommendation, consolidate_target_logical_page_id, page_json
         FROM blueprint_pages WHERE blueprint_revision_id = ? ORDER BY logical_page_id`
      )
      .bind(version.latest_revision_id)
      .all<any>()
  ).results;
  const pages: PageRow[] = pageRows.map((p) => {
    const j = JSON.parse(p.page_json);
    return {
      logical_page_id: p.logical_page_id,
      page_type: p.page_type,
      slug: p.slug,
      primary_keyword_normalized: p.primary_keyword_normalized,
      recommendation: p.recommendation,
      consolidate_target_logical_page_id: p.consolidate_target_logical_page_id,
      scoreBreakdown: j.scoreBreakdown,
      evidenceRefs: j.evidenceRefs ?? [],
    };
  });

  const adjudications = (
    await db
      .prepare(`SELECT case_type, decision, score_context_json IS NOT NULL AS ctx FROM cluster_adjudications WHERE run_id = ?`)
      .bind(runId)
      .all<{ case_type: string; decision: string; ctx: number }>()
  ).results.map((a) => ({ case_type: a.case_type, decision: a.decision, scoreContextPresent: a.ctx === 1 }));

  const overlayRaw = (await env.BLUEPRINT_ARTIFACTS.get(`runs/${runId}/overlay.json`)) as { text(): Promise<string> } | null;
  const overlayJson = overlayRaw ? JSON.parse(await overlayRaw.text()) : { consolidations: [] };

  const parsedCount = (await db.prepare(`SELECT COUNT(*) AS n FROM parsed_competitor_pages WHERE run_id = ?`).bind(runId).first<{ n: number }>())!.n;
  const existingCount = (await db.prepare(`SELECT COUNT(*) AS n FROM existing_pages WHERE run_id = ?`).bind(runId).first<{ n: number }>())!.n;
  const serpSnapshotCount = (await db.prepare(`SELECT COUNT(*) AS n FROM serp_snapshots WHERE run_id = ?`).bind(runId).first<{ n: number }>())!.n;
  const competitors = (
    await db.prepare(`SELECT domain, selected, estimated_traffic FROM competitors WHERE run_id = ? ORDER BY domain`).bind(runId).all<any>()
  ).results;

  return {
    runId,
    status,
    stages,
    clusters,
    membershipCanonical,
    logicalIds: new Set(pages.map((p) => p.logical_page_id)),
    version,
    summary,
    revisionHash: revRow!.revision_hash,
    pages,
    slugs: pages.map((p) => p.slug),
    primaryKeywords: pages.map((p) => p.primary_keyword_normalized),
    adjudications,
    overlayConsolidations: overlayJson.consolidations ?? [],
    parsedCount,
    existingCount,
    serpSnapshotCount,
    competitors,
  };
}

const CLUSTER_STAGES = ['normalize_keyword_universe', 'embed_keyword_features', 'build_provisional_clusters', 'refine_clusters'];
const PAGE_PLAN_STAGES = ['parse_competitor_pages', 'build_page_plan', 'overlay_existing_site', 'validate_blueprint', 'publish_blueprint'];
const PAID_STAGES = ['collect_keyword_evidence', 'discover_competitors', 'collect_competitor_evidence', 'validate_serps_and_questions', 'parse_competitor_pages'];

describe('Phase 4 orchestration acceptance', () => {
  let restoreFetch: () => void;
  beforeEach(() => {
    restoreFetch = installFetchStub();
  });
  afterEach(() => {
    restoreFetch();
  });

  it('acceptance: full route->run->drain drives both halves real and satisfies the Phase 4 spec list', async () => {
    const env = fakeEnv();
    const s = await driveFullRun(env);

    // The whole pipeline reached a published blueprint; the only gap is the
    // Phase-5 collect_us_fanout stub (deriveRunStatus folds any terminal gap to
    // 'partial'). No Phase 4 stage failed.
    expect(s.status).toBe('partial');
    expect(s.summary.partialStages).toEqual(['collect_us_fanout']);
    for (const stage of [...CLUSTER_STAGES, ...PAGE_PLAN_STAGES, 'validate_serps_and_questions']) {
      const row = s.stages.get(stage);
      expect(row, `stage ${stage} ran`).toBeTruthy();
      expect(['succeeded', 'partial'], `stage ${stage} did not fail`).toContain(row!.status);
    }

    // ACCEPTANCE: provisional -> live-SERP -> refine order honored, each stage's
    // output present, live SERP evidence actually persisted.
    const idx = (stage: string) => BLUEPRINT_STAGES.indexOf(stage as (typeof BLUEPRINT_STAGES)[number]);
    expect(idx('build_provisional_clusters')).toBeLessThan(idx('validate_serps_and_questions'));
    expect(idx('validate_serps_and_questions')).toBeLessThan(idx('refine_clusters'));
    expect(s.stages.get('build_provisional_clusters')!.output_present).toBe(1);
    expect(s.stages.get('validate_serps_and_questions')!.output_present).toBe(1);
    expect(s.stages.get('refine_clusters')!.output_present).toBe(1);
    expect(s.serpSnapshotCount, 'live SERP snapshots persisted').toBeGreaterThan(0);
    expect(s.clusters.length, 'multiple clusters formed').toBeGreaterThan(1);

    // ACCEPTANCE: ruleset version recorded per stage family, and on the version.
    for (const stage of CLUSTER_STAGES) {
      expect(s.stages.get(stage)!.ruleset_version, `${stage} ruleset`).toBe('cluster-v1');
    }
    for (const stage of PAGE_PLAN_STAGES) {
      expect(s.stages.get(stage)!.ruleset_version, `${stage} ruleset`).toBe('pp-v1');
    }
    expect(s.version.ruleset_version).toBe('cluster-v1+pp-v1');
    expect(s.version.schema_version).toBe('p4');

    // ACCEPTANCE: score breakdown + evidence refs on every decision. Every
    // cluster carries a score_breakdown_json; every non-skeleton (dedicated)
    // page carries a scoreBreakdown AND non-empty evidenceRefs (the Task 16
    // fix); the cluster adjudication carries score_context.
    expect(s.clusters.length).toBeGreaterThan(0);
    for (const c of s.clusters) {
      expect(c.scoreBreakdownPresent, `cluster ${c.label} score_breakdown_json`).toBe(true);
    }
    const dedicatedPages = s.pages.filter((p) => !SKELETON_PAGE_TYPES.has(p.page_type));
    expect(dedicatedPages.length, 'at least one dedicated cluster page').toBeGreaterThan(0);
    for (const p of dedicatedPages) {
      expect(p.scoreBreakdown, `page ${p.logical_page_id} scoreBreakdown`).not.toBeNull();
      expect(p.evidenceRefs.length, `page ${p.logical_page_id} evidenceRefs`).toBeGreaterThan(0);
    }
    expect(s.adjudications.length, 'at least one cluster adjudication').toBeGreaterThan(0);
    for (const a of s.adjudications) {
      expect(a.scoreContextPresent, `adjudication ${a.case_type} score_context`).toBe(true);
    }

    // ACCEPTANCE: no auto service-x-location. The seeded clusters carry no area
    // link, so no cluster demanded any of the 2x2 service/area combinations; the
    // engine mints service_location pages only from clusters carrying both links,
    // so the entire cartesian product is absent.
    const serviceLocationPages = s.pages.filter((p) => p.page_type === 'service_location');
    expect(serviceLocationPages, 'no auto service_location pages').toHaveLength(0);
    expect(s.summary.byPageType.service_location).toBeUndefined();

    // ACCEPTANCE: consolidate targets valid. Every overlay consolidation points
    // at a planned logicalId, never at the existing URL itself; and any
    // blueprint_pages row recommended 'consolidate' has a valid, non-self target.
    expect(s.overlayConsolidations.length, 'at least one consolidation proposed').toBeGreaterThan(0);
    for (const con of s.overlayConsolidations) {
      expect(con.consolidateTargetLogicalId).not.toBeNull();
      expect(s.logicalIds.has(con.consolidateTargetLogicalId!), `consolidate target ${con.consolidateTargetLogicalId} is a planned page`).toBe(true);
      expect(con.consolidateTargetLogicalId).not.toBe(con.existingUrl);
    }
    for (const p of s.pages.filter((pg) => pg.recommendation === 'consolidate')) {
      expect(p.consolidate_target_logical_page_id).not.toBeNull();
      expect(s.logicalIds.has(p.consolidate_target_logical_page_id!)).toBe(true);
      expect(p.consolidate_target_logical_page_id).not.toBe(p.logical_page_id);
    }

    // ACCEPTANCE: no shared slugs / no shared primary keywords across pages.
    expect(new Set(s.slugs).size).toBe(s.slugs.length);
    const nonNullKws = s.primaryKeywords.filter((k): k is string => k !== null);
    expect(new Set(nonNullKws).size).toBe(nonNullKws.length);

    // ACCEPTANCE: no double-counted addressable demand. Each seeded keyword lands
    // in exactly one cluster and each cluster's demand is counted once, so the
    // plan-wide total equals the exact sum of the seeded keyword volumes.
    expect(s.summary.addressableDemandTotal).toBe(SUM_IDEAS_VOLUME);

    // ACCEPTANCE: blueprint_pages populated in revision 1 with the expected set.
    expect(s.pages.length).toBe(s.summary.pageCount);
    expect(s.pages.length).toBeGreaterThan(0);
    expect(s.logicalIds.has('home'), 'home page present').toBe(true);
    expect(s.pages.some((p) => p.page_type === 'service'), 'service page present').toBe(true);
    expect(dedicatedPages.some((p) => p.page_type === 'resource'), 'dedicated cluster page present').toBe(true);
    for (const p of s.pages) {
      expect(p.slug, `page ${p.logical_page_id} slug`).toBeTruthy();
    }

    // ACCEPTANCE: estimated_traffic non-null for at least one competitor (Task 3
    // ops fix), and stage cost_usd_micro non-zero for every paid stage (Task 4).
    expect(s.competitors.some((c) => c.selected === 1 && c.estimated_traffic !== null)).toBe(true);
    for (const stage of PAID_STAGES) {
      expect(s.stages.get(stage)!.cost_usd_micro, `paid stage ${stage} cost`).toBeGreaterThan(0);
    }

    // Sanity: the page-planning half genuinely ran over real inventory.
    expect(s.parsedCount, 'parsed competitor pages persisted').toBeGreaterThan(0);
    expect(s.existingCount, 'existing_pages inventory persisted').toBeGreaterThan(0);

    // ACCEPTANCE: reproducible membership. A second, fully independent drive
    // (fresh env, cold KV) produces identical cluster membership, an identical
    // published revision hash, and an identical page set -- the deterministic
    // engines depend on nothing but their inputs.
    const env2 = fakeEnv();
    const s2 = await driveFullRun(env2);
    expect(s2.membershipCanonical, 'cluster membership reproducible').toBe(s.membershipCanonical);
    expect(s2.revisionHash, 'published revision hash reproducible').toBe(s.revisionHash);
    expect(s2.slugs.slice().sort(), 'page slug set reproducible').toEqual(s.slugs.slice().sort());
    expect(s2.summary.addressableDemandTotal).toBe(s.summary.addressableDemandTotal);
  });
});
