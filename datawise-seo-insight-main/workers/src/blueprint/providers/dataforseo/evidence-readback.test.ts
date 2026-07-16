import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../../test-support/d1';
import { newId, nowIso } from '../../db/util';
import { normalizeKeyword } from '../../domain/keyword';
import { dfsCacheKey } from './call';
import {
  loadKeywordEnrichmentFromArtifacts,
  loadCompetitorRankingUrls,
  normalizeSerpUrl,
} from './evidence-readback';

const LOCALE = 'en';

// ---- fixture plumbing -------------------------------------------------

function dfsEnvelope(items: any[], cost = 0) {
  return {
    status_code: 20000,
    tasks: [{ id: 'task-1', status_code: 20000, status_message: 'Ok.', cost, result: [{ items }] }],
  };
}

// In-memory R2 fake. Unlike test-support/env.ts's fake (put/get/text only),
// this one also carries a `size` on the returned object -- production R2Object
// always has one, and the size guard test needs to force an oversized read
// without actually allocating 25MB of fixture text.
function fakeR2() {
  const objects = new Map<string, { body: string; size: number }>();
  const bucket = {
    async put(key: string, value: string) {
      objects.set(key, { body: value, size: new TextEncoder().encode(value).byteLength });
    },
    async get(key: string) {
      const obj = objects.get(key);
      if (!obj) return null;
      return { size: obj.size, text: async () => obj.body };
    },
  };
  return {
    bucket: bucket as unknown as R2Bucket,
    // Lets a test plant an object whose reported size lies about its real
    // byte length, to exercise the 25MB skip without a giant fixture string.
    putWithSize(key: string, value: string, size: number) {
      objects.set(key, { body: value, size });
    },
  };
}

// In-memory KV fake, standing in for call.ts's env.KV response cache. Only
// get/put are needed here; expirationTtl is accepted (matching call.ts's
// step 7 signature) but not enforced -- absence/expiry is modeled by simply
// never seeding a key, not by simulating a clock.
function fakeKv() {
  const store = new Map<string, string>();
  const get = vi.fn(async (key: string) => store.get(key) ?? null);
  const bucket = {
    get,
    async put(key: string, value: string, _opts?: { expirationTtl?: number }) {
      store.set(key, value);
    },
  };
  return { kv: bucket as unknown as KVNamespace, get };
}

// Inserts an evidence_refs row shaped exactly like a cache-hit call.ts
// produces (blueprintDfsCall step 1-2): artifact_id NULL, operation suffixed
// ':cache', no corresponding artifacts row at all. Callers separately seed
// the response under fakeKv() at dfsCacheKey(requestHash) to model the
// still-warm KV entry the row's request_hash points at.
async function seedCacheHitEvidenceRef(
  d1: D1Database,
  args: { runId: string; kind: string; operation: string; requestHash: string }
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO evidence_refs
        (id, run_id, provider, kind, operation, request_hash, fetched_at, cost_usd_micro, artifact_id)
       VALUES (?, ?, 'dataforseo', ?, ?, ?, ?, 0, NULL)`
    )
    .bind(newId('evr'), args.runId, args.kind, args.operation, args.requestHash, nowIso())
    .run();
}

async function seedOrg(d1: D1Database): Promise<{ projectId: string; runId: string }> {
  const projectId = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects
        (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(projectId, 'org1', 'user1', 'Test Project', 'greenfield', 'US', 'en', nowIso(), nowIso())
    .run();
  const runId = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(runId, projectId, 'brief1', 'estimate1', 'running', 'user1', nowIso())
    .run();
  return { projectId, runId };
}

// Writes the artifact JSON to the fake R2 bucket and inserts the matching
// artifacts + evidence_refs rows so distinctStorageKeys' JOIN finds it.
async function seedArtifact(
  d1: D1Database,
  r2: ReturnType<typeof fakeR2>,
  args: { runId: string; kind: string; operation: string; storageKey: string; body: any }
): Promise<void> {
  const artifactId = newId('art');
  await r2.bucket.put(args.storageKey, JSON.stringify(args.body));
  await d1
    .prepare(
      `INSERT INTO artifacts
        (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
       VALUES (?, 'org1', ?, ?, ?, 'sha', 'application/json', 1, 0, ?)`
    )
    .bind(artifactId, args.runId, args.kind, args.storageKey, nowIso())
    .run();
  await d1
    .prepare(
      `INSERT INTO evidence_refs
        (id, run_id, provider, kind, operation, request_hash, fetched_at, cost_usd_micro, artifact_id)
       VALUES (?, ?, 'dataforseo', ?, ?, ?, ?, 0, ?)`
    )
    .bind(newId('evr'), args.runId, args.kind, args.operation, args.storageKey, nowIso(), artifactId)
    .run();
}

// ---- loadKeywordEnrichmentFromArtifacts --------------------------------

describe('loadKeywordEnrichmentFromArtifacts', () => {
  it('maps a flat (keyword_ideas-shaped) item with every enrichment field present', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    const item = {
      keyword: 'AC Repair Austin',
      keyword_properties: { core_keyword: 'ac repair' },
      search_intent_info: { main_intent: 'Commercial' },
      keyword_info: {
        competition: 0.42,
        monthly_searches: [{ year: 2026, month: 1, search_volume: 100 }],
        serp_info: { serp_item_types: ['organic', 'local_pack'] },
      },
      avg_backlinks_info: { referring_main_domains: 12 },
    };
    await seedArtifact(d1, r2, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_ideas',
      storageKey: `runs/${runId}/dfs/flat.json`,
      body: dfsEnvelope([item]),
    });

    const result = await loadKeywordEnrichmentFromArtifacts(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(1);
    expect(result.artifactsMissing).toBe(0);
    const key = normalizeKeyword('AC Repair Austin', LOCALE);
    expect(result.data.get(key)).toEqual({
      coreKeyword: 'ac repair',
      mainIntent: 'commercial',
      intentProbabilities: null,
      monthlySearches: [{ year: 2026, month: 1, searchVolume: 100 }],
      serpItemTypes: ['organic', 'local_pack'],
      avgReferringDomains: 12,
      paidCompetition: 0.42,
    });
  });

  it('finds the same fields on a keyword_suggestions-shaped item nested under keyword_data', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    const item = {
      keyword_data: {
        keyword: 'plumber round rock',
        keyword_properties: { core_keyword: 'plumber' },
        search_intent_info: { main_intent: 'transactional' },
        keyword_info: {
          competition: 0.1,
          monthly_searches: [{ year: 2026, month: 2, search_volume: 50 }],
          serp_info: { serp_item_types: ['organic'] },
        },
        avg_backlinks_info: { referring_main_domains: 3 },
      },
    };
    await seedArtifact(d1, r2, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_suggestions',
      storageKey: `runs/${runId}/dfs/nested.json`,
      body: dfsEnvelope([item]),
    });

    const result = await loadKeywordEnrichmentFromArtifacts(d1, r2.bucket, kv, runId, LOCALE);

    const key = normalizeKeyword('plumber round rock', LOCALE);
    expect(result.data.get(key)).toEqual({
      coreKeyword: 'plumber',
      mainIntent: 'transactional',
      intentProbabilities: null,
      monthlySearches: [{ year: 2026, month: 2, searchVolume: 50 }],
      serpItemTypes: ['organic'],
      avgReferringDomains: 3,
      paidCompetition: 0.1,
    });
  });

  it('merges conflicting artifacts first-non-null-wins in storage_key order', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    // "aaa" sorts before "bbb": the first artifact's core_keyword wins, but
    // its missing avg_backlinks_info is backfilled from the second artifact.
    await seedArtifact(d1, r2, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_ideas',
      storageKey: `runs/${runId}/dfs/aaa.json`,
      body: dfsEnvelope([
        {
          keyword: 'roof repair',
          keyword_properties: { core_keyword: 'first-wins' },
          keyword_info: { competition: 0.2 },
        },
      ]),
    });
    await seedArtifact(d1, r2, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_ideas',
      storageKey: `runs/${runId}/dfs/bbb.json`,
      body: dfsEnvelope([
        {
          keyword: 'roof repair',
          keyword_properties: { core_keyword: 'second-loses' },
          keyword_info: { competition: 0.9 },
          avg_backlinks_info: { referring_main_domains: 7 },
        },
      ]),
    });

    const result = await loadKeywordEnrichmentFromArtifacts(d1, r2.bucket, kv, runId, LOCALE);

    const key = normalizeKeyword('roof repair', LOCALE);
    const enrichment = result.data.get(key);
    expect(enrichment?.coreKeyword).toBe('first-wins');
    expect(enrichment?.paidCompetition).toBe(0.2);
    expect(enrichment?.avgReferringDomains).toBe(7);
  });

  it('counts a missing R2 object as artifactsMissing without dropping other artifacts', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    await seedArtifact(d1, r2, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_ideas',
      storageKey: `runs/${runId}/dfs/present.json`,
      body: dfsEnvelope([{ keyword: 'gutter cleaning', keyword_properties: { core_keyword: 'gutter' } }]),
    });
    // Row points at a storage_key never written to the fake bucket.
    const artifactId = newId('art');
    await d1
      .prepare(
        `INSERT INTO artifacts
          (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
         VALUES (?, 'org1', ?, 'keyword_metric', ?, 'sha', 'application/json', 1, 0, ?)`
      )
      .bind(artifactId, runId, `runs/${runId}/dfs/absent.json`, nowIso())
      .run();
    await d1
      .prepare(
        `INSERT INTO evidence_refs
          (id, run_id, provider, kind, operation, request_hash, fetched_at, cost_usd_micro, artifact_id)
         VALUES (?, ?, 'dataforseo', 'keyword_metric', 'keyword_ideas', 'reqhash', ?, 0, ?)`
      )
      .bind(newId('evr'), runId, nowIso(), artifactId)
      .run();

    const result = await loadKeywordEnrichmentFromArtifacts(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(1);
    expect(result.artifactsMissing).toBe(1);
    expect(result.data.get(normalizeKeyword('gutter cleaning', LOCALE))?.coreKeyword).toBe('gutter');
  });

  it('skips an artifact object over the 25MB size guard and counts it as missing', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    const storageKey = `runs/${runId}/dfs/huge.json`;
    r2.putWithSize(storageKey, JSON.stringify(dfsEnvelope([{ keyword: 'too big' }])), 26 * 1024 * 1024);
    const artifactId = newId('art');
    await d1
      .prepare(
        `INSERT INTO artifacts
          (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
         VALUES (?, 'org1', ?, 'keyword_metric', ?, 'sha', 'application/json', 1, 0, ?)`
      )
      .bind(artifactId, runId, storageKey, nowIso())
      .run();
    await d1
      .prepare(
        `INSERT INTO evidence_refs
          (id, run_id, provider, kind, operation, request_hash, fetched_at, cost_usd_micro, artifact_id)
         VALUES (?, ?, 'dataforseo', 'keyword_metric', 'keyword_ideas', 'reqhash', ?, 0, ?)`
      )
      .bind(newId('evr'), runId, nowIso(), artifactId)
      .run();

    const result = await loadKeywordEnrichmentFromArtifacts(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(0);
    expect(result.artifactsMissing).toBe(1);
    expect(result.data.size).toBe(0);
  });

  it('collapses casing/punctuation variants of the same keyword via normalizeKeyword', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    await seedArtifact(d1, r2, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_ideas',
      storageKey: `runs/${runId}/dfs/variant-a.json`,
      body: dfsEnvelope([{ keyword: 'AC Repair, Austin!', keyword_properties: { core_keyword: 'ac repair' } }]),
    });
    await seedArtifact(d1, r2, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_suggestions',
      storageKey: `runs/${runId}/dfs/variant-b.json`,
      body: dfsEnvelope([{ keyword: 'ac repair austin', keyword_info: { competition: 0.3 } }]),
    });

    const result = await loadKeywordEnrichmentFromArtifacts(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.data.size).toBe(1);
    const enrichment = result.data.get(normalizeKeyword('ac repair austin', LOCALE));
    expect(enrichment?.coreKeyword).toBe('ac repair');
    expect(enrichment?.paidCompetition).toBe(0.3);
  });

  it('records an all-nulls enrichment entry when an item carries only a keyword', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    await seedArtifact(d1, r2, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_ideas',
      storageKey: `runs/${runId}/dfs/bare.json`,
      body: dfsEnvelope([{ keyword: 'no data keyword' }]),
    });

    const result = await loadKeywordEnrichmentFromArtifacts(d1, r2.bucket, kv, runId, LOCALE);

    // Design choice (documented in the brief as either acceptable): a
    // keyword with zero enrichable fields still gets a map entry, all null.
    // Downstream normalize_keyword_universe can then tell "we saw this
    // keyword in evidence but it carried no enrichment" apart from "we never
    // saw this keyword in any artifact at all".
    expect(result.data.get(normalizeKeyword('no data keyword', LOCALE))).toEqual({
      coreKeyword: null,
      mainIntent: null,
      intentProbabilities: null,
      monthlySearches: null,
      serpItemTypes: null,
      avgReferringDomains: null,
      paidCompetition: null,
    });
  });

  it('nulls out main_intent for a label outside the SearchIntent union instead of casting it through', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    await seedArtifact(d1, r2, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_ideas',
      storageKey: `runs/${runId}/dfs/unexpected-intent.json`,
      body: dfsEnvelope([
        { keyword: 'weird intent keyword', search_intent_info: { main_intent: 'Promotional' } },
      ]),
    });

    const result = await loadKeywordEnrichmentFromArtifacts(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.data.get(normalizeKeyword('weird intent keyword', LOCALE))?.mainIntent).toBeNull();
  });

  // Models the real cache-hit shape (call.ts blueprintDfsCall step 1-2): the
  // evidence_refs row has artifact_id NULL and the response is only
  // recoverable from the KV response cache. Before this fix, the discovery
  // query's INNER JOIN silently dropped rows exactly like this one.
  it('recovers a cache-hit evidence_refs row (artifact_id NULL) from the KV response cache', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    const requestHash = 'reqhash-enrichment-cache-hit';
    await seedCacheHitEvidenceRef(d1, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_ideas:cache',
      requestHash,
    });
    await kv.put(
      dfsCacheKey(requestHash),
      JSON.stringify(
        dfsEnvelope([{ keyword: 'furnace repair', keyword_properties: { core_keyword: 'furnace' } }])
      )
    );

    const result = await loadKeywordEnrichmentFromArtifacts(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(1);
    expect(result.artifactsMissing).toBe(0);
    expect(result.data.get(normalizeKeyword('furnace repair', LOCALE))?.coreKeyword).toBe('furnace');
  });

  it('counts a cache-hit row as artifactsMissing when its KV entry is expired/absent, without dropping other artifacts', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    await seedArtifact(d1, r2, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_ideas',
      storageKey: `runs/${runId}/dfs/present.json`,
      body: dfsEnvelope([{ keyword: 'gutter cleaning', keyword_properties: { core_keyword: 'gutter' } }]),
    });
    // Cache-hit row whose KV entry was never seeded (expired or evicted).
    await seedCacheHitEvidenceRef(d1, {
      runId,
      kind: 'keyword_metric',
      operation: 'keyword_ideas:cache',
      requestHash: 'reqhash-enrichment-gone',
    });

    const result = await loadKeywordEnrichmentFromArtifacts(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(1);
    expect(result.artifactsMissing).toBe(1);
    expect(result.data.get(normalizeKeyword('gutter cleaning', LOCALE))?.coreKeyword).toBe('gutter');
  });

  it('ignores non-keyword-shaped ranking items (e.g. competitor_discovery domain items) without throwing', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    await seedArtifact(d1, r2, {
      runId,
      kind: 'ranking',
      operation: 'competitor_discovery',
      storageKey: `runs/${runId}/dfs/discovery.json`,
      body: dfsEnvelope([{ domain: 'rival.com', intersections: 5 }]),
    });

    const result = await loadKeywordEnrichmentFromArtifacts(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(1);
    expect(result.artifactsMissing).toBe(0);
    expect(result.data.size).toBe(0);
  });
});

// ---- loadCompetitorRankingUrls ------------------------------------------

describe('loadCompetitorRankingUrls', () => {
  function rankedItem(keyword: string, url: string) {
    return { keyword, ranked_serp_element: { serp_item: { url, rank_group: 1, type: 'organic' } } };
  }

  it('collects deduped, sorted normalized URLs per keyword from a ranked_keywords artifact', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    await seedArtifact(d1, r2, {
      runId,
      kind: 'ranking',
      operation: 'ranked_keywords',
      storageKey: `runs/${runId}/dfs/ranked.json`,
      body: dfsEnvelope([
        rankedItem('emergency plumber', 'https://Rival.com/services/plumbing/?utm=1'),
        rankedItem('emergency plumber', 'https://rival.com/services/plumbing#pricing'),
        rankedItem('emergency plumber', 'https://other.com/plumbing/'),
      ]),
    });

    const result = await loadCompetitorRankingUrls(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(1);
    expect(result.artifactsMissing).toBe(0);
    const key = normalizeKeyword('emergency plumber', LOCALE);
    expect(result.data.get(key)).toEqual(['other.com/plumbing', 'rival.com/services/plumbing']);
  });

  // Models the real cache-hit shape (call.ts blueprintDfsCall step 1-2): no
  // R2 object or artifacts row for this run at all -- artifact_id is NULL --
  // and the response is only recoverable from the KV response cache, keyed
  // by dfsCacheKey(request_hash). Before this fix, the discovery query's
  // INNER JOIN silently dropped rows exactly like this one.
  it('also reads the ranked_keywords:cache operation variant, recovered from the KV response cache', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    const requestHash = 'reqhash-cache-hit';
    await seedCacheHitEvidenceRef(d1, {
      runId,
      kind: 'ranking',
      operation: 'ranked_keywords:cache',
      requestHash,
    });
    await kv.put(
      dfsCacheKey(requestHash),
      JSON.stringify(dfsEnvelope([rankedItem('drain cleaning', 'https://cached-rival.com/drains')]))
    );

    const result = await loadCompetitorRankingUrls(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(1);
    expect(result.artifactsMissing).toBe(0);
    expect(result.data.get(normalizeKeyword('drain cleaning', LOCALE))).toEqual(['cached-rival.com/drains']);
  });

  it('counts a cache-hit row as artifactsMissing when its KV entry is expired/absent, without dropping other rows', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    // Present: a real R2 artifact.
    await seedArtifact(d1, r2, {
      runId,
      kind: 'ranking',
      operation: 'ranked_keywords',
      storageKey: `runs/${runId}/dfs/present.json`,
      body: dfsEnvelope([rankedItem('emergency plumber', 'https://rival.com/plumbing')]),
    });
    // Cache-hit row whose KV entry was never seeded (expired or evicted).
    await seedCacheHitEvidenceRef(d1, {
      runId,
      kind: 'ranking',
      operation: 'ranked_keywords:cache',
      requestHash: 'reqhash-gone',
    });

    const result = await loadCompetitorRankingUrls(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(1);
    expect(result.artifactsMissing).toBe(1);
    expect(result.data.get(normalizeKeyword('emergency plumber', LOCALE))).toEqual(['rival.com/plumbing']);
  });

  it('dedupes the KV fetch by request_hash when multiple cache-hit rows share one request', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv, get } = fakeKv();
    const requestHash = 'reqhash-shared';
    await seedCacheHitEvidenceRef(d1, { runId, kind: 'ranking', operation: 'ranked_keywords:cache', requestHash });
    await seedCacheHitEvidenceRef(d1, { runId, kind: 'ranking', operation: 'ranked_keywords:cache', requestHash });
    await kv.put(
      dfsCacheKey(requestHash),
      JSON.stringify(dfsEnvelope([rankedItem('drain cleaning', 'https://cached-rival.com/drains')]))
    );

    const result = await loadCompetitorRankingUrls(d1, r2.bucket, kv, runId, LOCALE);

    // Both evidence_refs rows are counted, but the underlying KV read only
    // happens once (the DISTINCT SQL already collapses two identical
    // (storageKey=null, requestHash) rows into one, so a single call is the
    // correct outcome here, not "would have been 2 without dedup").
    expect(result.artifactsRead).toBe(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.data.get(normalizeKeyword('drain cleaning', LOCALE))).toEqual(['cached-rival.com/drains']);
  });

  // True production shape (competitors.ts normalizeRankedKeywordItem /
  // routes/competitors.ts): keyword lives nested under keyword_data, while
  // the ranking URL is NOT nested under keyword_data -- it's a sibling
  // ranked_serp_element.serp_item.url. The rankedItem() fixture above (a
  // flat `keyword` field) is not representative of a real ranked_keywords
  // response; this exercises the actual nesting extractRankingUrlItem must
  // handle.
  it('reads a true production-shaped ranked_keywords item (keyword nested under keyword_data)', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    const productionShapedItem = {
      keyword_data: {
        keyword: 'water heater installation',
        keyword_info: { search_volume: 90 },
      },
      ranked_serp_element: {
        serp_item: { url: 'https://rival.com/water-heater-installation', rank_group: 3, type: 'organic' },
      },
    };
    await seedArtifact(d1, r2, {
      runId,
      kind: 'ranking',
      operation: 'ranked_keywords',
      storageKey: `runs/${runId}/dfs/production-shaped.json`,
      body: dfsEnvelope([productionShapedItem]),
    });

    const result = await loadCompetitorRankingUrls(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(1);
    const key = normalizeKeyword('water heater installation', LOCALE);
    expect(result.data.get(key)).toEqual(['rival.com/water-heater-installation']);
  });

  it('excludes competitor_discovery ranking artifacts (wrong operation) from the ranked_keywords readback', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    await seedArtifact(d1, r2, {
      runId,
      kind: 'ranking',
      operation: 'competitor_discovery',
      storageKey: `runs/${runId}/dfs/discovery.json`,
      body: dfsEnvelope([{ domain: 'rival.com', intersections: 5 }]),
    });

    const result = await loadCompetitorRankingUrls(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(0);
    expect(result.artifactsMissing).toBe(0);
    expect(result.data.size).toBe(0);
  });

  it('counts a missing ranked_keywords artifact as artifactsMissing', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    const artifactId = newId('art');
    await d1
      .prepare(
        `INSERT INTO artifacts
          (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
         VALUES (?, 'org1', ?, 'ranking', ?, 'sha', 'application/json', 1, 0, ?)`
      )
      .bind(artifactId, runId, `runs/${runId}/dfs/gone.json`, nowIso())
      .run();
    await d1
      .prepare(
        `INSERT INTO evidence_refs
          (id, run_id, provider, kind, operation, request_hash, fetched_at, cost_usd_micro, artifact_id)
         VALUES (?, ?, 'dataforseo', 'ranking', 'ranked_keywords', 'reqhash', ?, 0, ?)`
      )
      .bind(newId('evr'), runId, nowIso(), artifactId)
      .run();

    const result = await loadCompetitorRankingUrls(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.artifactsRead).toBe(0);
    expect(result.artifactsMissing).toBe(1);
    expect(result.data.size).toBe(0);
  });

  it('collapses casing/punctuation keyword variants across ranked_keywords items', async () => {
    const { d1 } = createTestDb();
    const { runId } = await seedOrg(d1);
    const r2 = fakeR2();
    const { kv } = fakeKv();
    await seedArtifact(d1, r2, {
      runId,
      kind: 'ranking',
      operation: 'ranked_keywords',
      storageKey: `runs/${runId}/dfs/variants.json`,
      body: dfsEnvelope([
        rankedItem('Water Heater Repair!', 'https://a.com/wh'),
        rankedItem('water heater repair', 'https://b.com/wh'),
      ]),
    });

    const result = await loadCompetitorRankingUrls(d1, r2.bucket, kv, runId, LOCALE);

    expect(result.data.size).toBe(1);
    expect(result.data.get(normalizeKeyword('water heater repair', LOCALE))).toEqual(['a.com/wh', 'b.com/wh']);
  });
});

// ---- normalizeSerpUrl ----------------------------------------------------

describe('normalizeSerpUrl', () => {
  it('lowercases the host, strips protocol/query/fragment, and drops a trailing slash', () => {
    expect(normalizeSerpUrl('https://Example.COM/Path/?a=1#frag')).toBe('example.com/Path');
  });

  it('collapses the bare root path to just the host', () => {
    expect(normalizeSerpUrl('https://example.com/')).toBe('example.com');
    expect(normalizeSerpUrl('https://example.com')).toBe('example.com');
  });

  it('returns null for garbage input instead of throwing', () => {
    expect(normalizeSerpUrl('')).toBeNull();
    expect(normalizeSerpUrl('not a url at all ://')).toBeNull();
  });
});
