import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from '../db/util';
import type { StageContext } from './handlers';
import { STAGE_HANDLERS } from './handlers';
import { overlayExistingSiteHandler, type OverlayExistingSiteOutput } from './page-plan-handlers';
import type { NormalizedProjectBrief } from '../contracts/types';
import { stageMeta } from './stages';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------- fetch router: DFS api calls + untrusted site fetches ----------

interface SiteRoute {
  status?: number;
  body?: string;
  throw?: 'abort' | 'network';
}

interface RouterOpts {
  dfs?: any; // ranked_keywords envelope returned for any api.dataforseo.com call
  sites?: Record<string, SiteRoute>;
}

function installRouter(opts: RouterOpts): string[] {
  const siteCalls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.startsWith('https://api.dataforseo.com')) {
      return { ok: true, status: 200, json: async () => opts.dfs } as any;
    }
    siteCalls.push(u);
    const route = opts.sites?.[u];
    if (!route) return new Response('not found', { status: 404 }); // unmapped -> 404
    if (route.throw === 'abort') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (route.throw === 'network') throw new Error('boom');
    return new Response(route.body ?? '', { status: route.status ?? 200 });
  }) as any;
  return siteCalls;
}

// ---------- DFS ranked_keywords envelopes ----------

function rankedEnvelope(urls: Array<{ url: string; rank?: number }>): any {
  return {
    status_code: 20000,
    tasks: [
      {
        id: 't1',
        status_code: 20000,
        status_message: 'Ok.',
        cost: 0.05,
        result: [
          { items: urls.map((u) => ({ ranked_serp_element: { serp_item: { url: u.url, rank_group: u.rank ?? 1 } } })) },
        ],
      },
    ],
  };
}
function taskFailedEnvelope(): any {
  return { status_code: 40000, tasks: [{ id: 't1', status_code: 40501, status_message: 'Invalid Field.', cost: 0, result: null }] };
}
// A failed task whose message maps (via mapDfsFailure) to an account-wide code
// (provider_rate_limited). Distinct from taskFailedEnvelope, which is a per-call
// provider_invalid_response.
function rateLimitedEnvelope(): any {
  return { status_code: 40000, tasks: [{ id: 't1', status_code: 40202, status_message: 'Rate limit exceeded (40202).', cost: 0, result: null }] };
}

// ---------- sitemap / robots bodies ----------

function urlset(urls: string[]): string {
  return `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`;
}
function sitemapindex(children: string[]): string {
  return `<?xml version="1.0"?><sitemapindex>${children.map((c) => `<sitemap><loc>${c}</loc></sitemap>`).join('')}</sitemapindex>`;
}
function robots(sitemaps: string[]): string {
  return sitemaps.map((s) => `Sitemap: ${s}`).join('\n');
}
function titleBody(title: string): string {
  return `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>content here</p></body></html>`;
}

// ---------- seeds ----------

async function seedProject(d1: D1Database): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, 'org1', 'u1', 'Test', 'existing_site', 'US', 'en', ?, ?)`
    )
    .bind(id, nowIso(), nowIso())
    .run();
  return id;
}

async function seedRun(d1: D1Database, projectId: string): Promise<string> {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, 'brief1', 'est1', 'running', 100000000, 0, 'u1', ?)`
    )
    .bind(id, projectId, nowIso())
    .run();
  return id;
}

async function seedResolvedMarket(d1: D1Database, runId: string): Promise<void> {
  const market = { labsLocationCode: 2840, languageCode: 'en', serpLocations: [], fallbackSerpLocationCode: 2840, unresolvedAreaIds: [] };
  await d1
    .prepare(
      `INSERT INTO research_stage_runs (id, run_id, stage_name, stage_input_hash, status, output_json, finished_at)
       VALUES (?, ?, 'resolve_market', ?, 'succeeded', ?, ?)`
    )
    .bind(newId('rsr'), runId, `h-${newId('h')}`, JSON.stringify(market), nowIso())
    .run();
}

// A minimal planned page (only the fields the overlay match/enrichment read).
function plannedPage(logicalId: string, slug: string, title: string, primaryKeyword: string): any {
  return { logicalId, pageType: 'service', slug, title, h1: title, parentLogicalId: null, primaryKeyword, primaryKeywordId: null };
}

async function seedPagePlanArtifact(artifacts: Map<string, string>, runId: string, pages: any[]): Promise<void> {
  artifacts.set(`runs/${runId}/page-plan.json`, JSON.stringify({ rulesetVersion: 'pp-v1', pages }));
}

function brief(overrides: Partial<NormalizedProjectBrief> = {}): NormalizedProjectBrief {
  return {
    mode: 'existing_site',
    businessName: 'Acme Plumbing',
    normalizedBusinessName: 'acme plumbing',
    category: 'plumber',
    websiteDomain: 'acme.com',
    websiteUrl: 'https://acme.com',
    countryIso: 'US',
    languageCode: 'en',
    services: [],
    serviceAreas: [],
    targetCustomers: [],
    differentiators: [],
    excludedDomains: [],
    excludedTopics: [],
    knownCompetitorDomains: [],
    goals: [],
    maxRecommendedPages: 30,
    enableUsFanout: false,
    inputHash: 'hash1',
    ...overrides,
  } as NormalizedProjectBrief;
}

function buildCtx(
  d1: D1Database,
  projectId: string,
  runId: string,
  normalizedBrief: NormalizedProjectBrief
): { ctx: StageContext; artifacts: Map<string, string> } {
  const kv = new Map<string, string>();
  const artifacts = new Map<string, string>();
  const env = {
    BLUEPRINT_DB: d1,
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    BLUEPRINT_ARTIFACTS: {
      put: async (k: string, v: string) => void artifacts.set(k, v),
      get: async (k: string) => (artifacts.has(k) ? { text: async () => artifacts.get(k)! } : null),
    } as unknown as R2Bucket,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
  };
  const ctx = {
    env: env as any,
    d1,
    runId,
    projectId,
    briefVersionId: 'brief1',
    normalizedBrief,
    stage: 'overlay_existing_site',
    attempt: 1,
  } as StageContext;
  return { ctx, artifacts };
}

async function existingRows(d1: D1Database, runId: string) {
  const r = await d1
    .prepare(
      `SELECT url, title, discovered_via, http_status, matched_logical_page_id, match_score
       FROM existing_pages WHERE run_id = ? ORDER BY url`
    )
    .bind(runId)
    .all<{ url: string; title: string | null; discovered_via: string; http_status: number | null; matched_logical_page_id: string | null; match_score: number | null }>();
  return r.results;
}

// ---------- registration ----------

describe('overlay_existing_site registration', () => {
  it('is wired into STAGE_HANDLERS (stub replaced) and is NOT a required stage', () => {
    expect(STAGE_HANDLERS.overlay_existing_site).toBe(overlayExistingSiteHandler);
    expect(stageMeta('overlay_existing_site').required).toBe(false);
  });
});

// ---------- handler ----------

describe('overlayExistingSiteHandler', () => {
  it('skips a greenfield brief (no website URL) as succeeded', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    installRouter({});
    const { ctx } = buildCtx(d1, projectId, runId, brief({ mode: 'greenfield', websiteUrl: null, websiteDomain: null }));

    const { output, status } = (await overlayExistingSiteHandler(ctx)) as { output: OverlayExistingSiteOutput; status: string };
    expect(status).toBe('succeeded');
    expect(output.skipped).toBe(true);
    expect(output.reason).toBe('greenfield');
    expect(await existingRows(d1, runId)).toHaveLength(0);
  });

  it('robots -> sitemap -> urls happy path: keep/update/create/consolidate + persistence + overlay artifact', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    await seedPagePlanArtifact(artifacts, runId, [
      plannedPage('lp_drain', 'drain-cleaning', 'Drain Cleaning', 'drain cleaning'),
      plannedPage('lp_emergency', 'emergency-plumbing', 'Emergency Plumbing', 'emergency plumbing'),
      plannedPage('lp_heater', 'water-heater-repair', 'Water Heater Repair', 'water heater repair'),
    ]);

    const keepUrl = 'https://acme.com/drain-cleaning';
    const updateUrl = 'https://acme.com/emergency-plumbing-austin';
    const consolidateUrl = 'https://acme.com/drain-cleaning-services-near-me';
    const orphanUrl = 'https://acme.com/about-us';

    installRouter({
      sites: {
        'https://acme.com/robots.txt': { body: robots(['https://acme.com/sitemap.xml']) },
        'https://acme.com/sitemap.xml': { body: urlset([keepUrl, updateUrl, consolidateUrl, orphanUrl]) },
        [keepUrl]: { body: titleBody('Drain Cleaning Services') },
        [orphanUrl]: { body: titleBody('About Us') },
        // update + consolidate URLs answer with an anti-bot stub (blocked): title stays null.
        [updateUrl]: { status: 218, body: '' },
        [consolidateUrl]: { status: 218, body: '' },
      },
    });

    const { output, status } = (await overlayExistingSiteHandler(ctx)) as { output: OverlayExistingSiteOutput; status: string };
    expect(status).toBe('succeeded');
    expect(output.urlsDiscovered).toEqual({ sitemap: 0, robots: 4, labs: 0 });
    expect(output.titleFetches).toEqual({ attempted: 4, blocked: 2, failed: 0 });
    expect(output.matches).toEqual({ keep: 1, update: 1, create: 1, consolidate: 1, unmatchedExisting: 1 });
    expect(output.warnings).toEqual([]);

    const rows = await existingRows(d1, runId);
    expect(rows.map((r) => r.url)).toEqual([keepUrl, consolidateUrl, updateUrl, orphanUrl].sort());
    const keepRow = rows.find((r) => r.url === keepUrl)!;
    expect(keepRow.matched_logical_page_id).toBe('lp_drain');
    expect(keepRow.title).toBe('Drain Cleaning Services');
    expect(keepRow.http_status).toBe(200);
    const updateRow = rows.find((r) => r.url === updateUrl)!;
    expect(updateRow.matched_logical_page_id).toBe('lp_emergency');
    expect(updateRow.title).toBeNull();
    expect(updateRow.http_status).toBe(218);
    const consolidateRow = rows.find((r) => r.url === consolidateUrl)!;
    expect(consolidateRow.matched_logical_page_id).toBeNull(); // consolidate carries no one-to-one match
    expect(consolidateRow.match_score).toBeNull();
    const orphanRow = rows.find((r) => r.url === orphanUrl)!;
    expect(orphanRow.matched_logical_page_id).toBeNull();

    // Overlay artifact: additive, never mutates page-plan.json.
    const overlayRaw = artifacts.get(`runs/${runId}/overlay.json`)!;
    expect(overlayRaw).toBeTruthy();
    const overlay = JSON.parse(overlayRaw);
    expect(overlay.rulesetVersion).toBe('pp-v1');
    const heater = overlay.plannedPages.find((p: any) => p.logicalId === 'lp_heater');
    expect(heater.recommendation).toBe('create');
    expect(heater.matchedUrl).toBeNull();
    const drainPlan = overlay.plannedPages.find((p: any) => p.logicalId === 'lp_drain');
    expect(drainPlan.recommendation).toBe('keep');
    expect(drainPlan.matchedUrl).toBe(keepUrl);
    // Consolidation target is a real plan page and never the URL's own match.
    expect(overlay.consolidations).toHaveLength(1);
    expect(overlay.consolidations[0]).toMatchObject({ existingUrl: consolidateUrl, consolidateTargetLogicalId: 'lp_drain' });

    // The page-plan artifact is untouched.
    const planRaw = artifacts.get(`runs/${runId}/page-plan.json`)!;
    expect(JSON.parse(planRaw).pages).toHaveLength(3);

    // artifacts row parity for the overlay artifact.
    const artRow = await d1
      .prepare(`SELECT kind, content_type FROM artifacts WHERE run_id = ? AND storage_key = ?`)
      .bind(runId, `runs/${runId}/overlay.json`)
      .first<{ kind: string; content_type: string }>();
    expect(artRow?.kind).toBe('overlay');
    expect(artRow?.content_type).toBe('application/json');
  });

  it('bounds sitemapindex recursion at the fetch budget (robots + index + 8 children = 10)', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    await seedPagePlanArtifact(artifacts, runId, [plannedPage('lp1', 'x', 'X', 'x')]);

    const children = Array.from({ length: 20 }, (_, i) => `https://acme.com/sm-${i}.xml`);
    const sites: Record<string, SiteRoute> = {
      'https://acme.com/robots.txt': { body: robots(['https://acme.com/sitemap.xml']) },
      'https://acme.com/sitemap.xml': { body: sitemapindex(children) },
    };
    children.forEach((c, i) => (sites[c] = { body: urlset([`https://acme.com/page-${i}`]) }));

    const siteCalls = installRouter({ sites });
    const { output } = (await overlayExistingSiteHandler(ctx)) as { output: OverlayExistingSiteOutput };

    // 10 sitemap-family fetches total (robots + index + 8 children); the other 12
    // children are never fetched.
    expect(siteCalls.filter((u) => u.endsWith('.xml') || u.endsWith('robots.txt'))).toHaveLength(10);
    const discovered = output.urlsDiscovered.sitemap + output.urlsDiscovered.robots + output.urlsDiscovered.labs;
    expect(discovered).toBe(8);
    expect(output.urlsDiscovered.robots).toBe(8);
  });

  it('drops off-domain sitemap URLs', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    await seedPagePlanArtifact(artifacts, runId, [plannedPage('lp1', 'x', 'X', 'x')]);

    installRouter({
      sites: {
        'https://acme.com/robots.txt': { body: robots(['https://acme.com/sitemap.xml']) },
        'https://acme.com/sitemap.xml': { body: urlset(['https://acme.com/on-page', 'https://evil.com/off-page']) },
        'https://acme.com/on-page': { body: titleBody('On Page') },
      },
    });
    const { output } = (await overlayExistingSiteHandler(ctx)) as { output: OverlayExistingSiteOutput };
    const rows = await existingRows(d1, runId);
    expect(rows.map((r) => r.url)).toEqual(['https://acme.com/on-page']);
    expect(output.urlsDiscovered.robots).toBe(1);
  });

  it('falls back to /sitemap.xml when robots.txt yields no sitemap (discovered_via sitemap)', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    await seedPagePlanArtifact(artifacts, runId, [plannedPage('lp1', 'x', 'X', 'x')]);

    installRouter({
      sites: {
        // robots.txt is unmapped -> 404 -> no directives -> fallback to /sitemap.xml.
        'https://acme.com/sitemap.xml': { body: urlset(['https://acme.com/fallback-page']) },
        'https://acme.com/fallback-page': { body: titleBody('Fallback') },
      },
    });
    const { output, status } = (await overlayExistingSiteHandler(ctx)) as { output: OverlayExistingSiteOutput; status: string };
    expect(status).toBe('succeeded');
    expect(output.urlsDiscovered).toEqual({ sitemap: 1, robots: 0, labs: 0 });
    const rows = await existingRows(d1, runId);
    expect(rows[0].discovered_via).toBe('sitemap');
  });

  it('full sitemap blockage -> paid labs fallback rows (discovered_via labs) + inventory_limited warning', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedResolvedMarket(d1, runId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    await seedPagePlanArtifact(artifacts, runId, [plannedPage('lp_drain', 'drain-cleaning', 'Drain Cleaning', 'drain cleaning')]);

    // robots.txt and sitemap.xml both unmapped -> 404 -> zero free inventory.
    installRouter({
      dfs: rankedEnvelope([{ url: 'https://acme.com/drain-cleaning', rank: 2 }, { url: 'https://acme.com/other', rank: 5 }]),
      sites: {},
    });
    const { output, status } = (await overlayExistingSiteHandler(ctx)) as { output: OverlayExistingSiteOutput; status: string };
    expect(status).toBe('succeeded');
    expect(output.warnings).toContain('inventory_limited');
    expect(output.urlsDiscovered).toEqual({ sitemap: 0, robots: 0, labs: 2 });
    const rows = await existingRows(d1, runId);
    expect(rows.every((r) => r.discovered_via === 'labs')).toBe(true);
    // The matching still runs on the labs inventory.
    const drainRow = rows.find((r) => r.url === 'https://acme.com/drain-cleaning')!;
    expect(drainRow.matched_logical_page_id).toBe('lp_drain');
  });

  it('labs fallback ALSO empty -> partial, zero rows, every planned page stays create, no "no pages" finding', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedResolvedMarket(d1, runId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    await seedPagePlanArtifact(artifacts, runId, [
      plannedPage('lp1', 'drain-cleaning', 'Drain Cleaning', 'drain cleaning'),
      plannedPage('lp2', 'emergency-plumbing', 'Emergency Plumbing', 'emergency plumbing'),
    ]);

    installRouter({ dfs: rankedEnvelope([]), sites: {} });
    const { output, status } = (await overlayExistingSiteHandler(ctx)) as { output: OverlayExistingSiteOutput; status: string };
    expect(status).toBe('partial');
    expect(output.warnings).toContain('inventory_limited');
    expect(output.matches).toEqual({ keep: 0, update: 0, create: 2, consolidate: 0, unmatchedExisting: 0 });
    expect(await existingRows(d1, runId)).toHaveLength(0);
    // overlay artifact still written, all-create.
    const overlay = JSON.parse(artifacts.get(`runs/${runId}/overlay.json`)!);
    expect(overlay.plannedPages.every((p: any) => p.recommendation === 'create')).toBe(true);
  });

  it('catches a DFS provider throw into inventory_limited (partial), never propagating it', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedResolvedMarket(d1, runId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    await seedPagePlanArtifact(artifacts, runId, [plannedPage('lp1', 'drain-cleaning', 'Drain Cleaning', 'drain cleaning')]);

    installRouter({ dfs: taskFailedEnvelope(), sites: {} });
    const { output, status } = (await overlayExistingSiteHandler(ctx)) as { output: OverlayExistingSiteOutput; status: string };
    expect(status).toBe('partial');
    expect(output.warnings).toContain('inventory_limited');
    expect(await existingRows(d1, runId)).toHaveLength(0);
  });

  it('rethrows an account-wide labs error (rate limited) instead of swallowing it into partial', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedResolvedMarket(d1, runId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    await seedPagePlanArtifact(artifacts, runId, [plannedPage('lp1', 'drain-cleaning', 'Drain Cleaning', 'drain cleaning')]);

    // robots/sitemap both unmapped -> zero free inventory -> labs fallback fires,
    // and the labs call hits a rate-limit wall: it must PROPAGATE (retry_wait/
    // fail with the true code), not be swallowed into a misleading partial.
    installRouter({ dfs: rateLimitedEnvelope(), sites: {} });
    await expect(overlayExistingSiteHandler(ctx)).rejects.toMatchObject({ code: 'provider_rate_limited' });
    // No existing_pages persisted, since the handler threw before persistence.
    expect(await existingRows(d1, runId)).toHaveLength(0);
  });

  it('maps SiteFetchError ssrf and timeout to warnings, not failures', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    await seedPagePlanArtifact(artifacts, runId, [plannedPage('lp1', 'only-page', 'Only Page', 'only page')]);

    installRouter({
      sites: {
        // One sitemap is fine; the other points at a link-local host (SSRF) the
        // fetcher rejects before any network. The good sitemap's one page has a
        // title fetch that aborts (timeout).
        'https://acme.com/robots.txt': { body: robots(['https://acme.com/good.xml', 'http://169.254.169.254/evil.xml']) },
        'https://acme.com/good.xml': { body: urlset(['https://acme.com/only-page']) },
        'https://acme.com/only-page': { throw: 'abort' },
      },
    });
    const { output, status } = (await overlayExistingSiteHandler(ctx)) as { output: OverlayExistingSiteOutput; status: string };
    expect(status).toBe('succeeded'); // inventory has the good page; warnings do not fail the stage
    expect(output.warnings).toContain('sitemap_fetch_ssrf');
    expect(output.warnings).toContain('title_fetch_timeout');
    expect(output.titleFetches.failed).toBe(1);
    expect((await existingRows(d1, runId)).map((r) => r.url)).toEqual(['https://acme.com/only-page']);
  });

  it('is rerun-safe: a second run replaces rows and reuses the overlay artifact row', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    await seedPagePlanArtifact(artifacts, runId, [plannedPage('lp1', 'drain-cleaning', 'Drain Cleaning', 'drain cleaning')]);

    installRouter({
      sites: {
        'https://acme.com/robots.txt': { body: robots(['https://acme.com/sitemap.xml']) },
        'https://acme.com/sitemap.xml': { body: urlset(['https://acme.com/drain-cleaning']) },
        'https://acme.com/drain-cleaning': { body: titleBody('Drain Cleaning') },
      },
    });
    await overlayExistingSiteHandler(ctx);
    expect(await existingRows(d1, runId)).toHaveLength(1);
    await overlayExistingSiteHandler(ctx);
    expect(await existingRows(d1, runId)).toHaveLength(1);
    const artCount = await d1
      .prepare(`SELECT COUNT(*) AS n FROM artifacts WHERE run_id = ? AND storage_key = ?`)
      .bind(runId, `runs/${runId}/overlay.json`)
      .first<{ n: number }>();
    expect(artCount?.n).toBe(1);
  });

  it('chunks existing_pages persistence past the per-statement row budget', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    await seedPagePlanArtifact(artifacts, runId, [plannedPage('lp1', 'x', 'X', 'x')]);

    const pages = Array.from({ length: 25 }, (_, i) => `https://acme.com/p-${i}`);
    installRouter({
      sites: {
        'https://acme.com/robots.txt': { body: robots(['https://acme.com/sitemap.xml']) },
        'https://acme.com/sitemap.xml': { body: urlset(pages) },
        // page title fetches are unmapped -> 404 (null title, http 404); fine.
      },
    });
    await overlayExistingSiteHandler(ctx);
    expect(await existingRows(d1, runId)).toHaveLength(25); // 25 rows across 3 chunks persist intact
  });
});
