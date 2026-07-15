import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from '../db/util';
import type { NormalizedProjectBrief } from '../contracts/types';
import { loadPagePlanFacts, briefFactsFrom } from './page-plan-facts';

// ---------- Brief ----------

function brief(overrides: Partial<NormalizedProjectBrief> = {}): NormalizedProjectBrief {
  return {
    mode: 'greenfield',
    businessName: 'Acme Plumbing',
    normalizedBusinessName: 'acme plumbing',
    category: 'plumber',
    websiteDomain: null,
    websiteUrl: null,
    countryIso: 'US',
    languageCode: 'en',
    services: [
      { id: 's1', name: 'Drain Cleaning', normalizedName: 'drain cleaning', description: null, synonyms: [], priority: 'primary' },
    ],
    serviceAreas: [
      { id: 'a1', city: 'Austin', region: 'TX', countryIso: 'US', radiusKm: null, isPrimary: true, uniqueProof: ['travis county'] },
    ],
    targetCustomers: [],
    differentiators: [],
    knownCompetitorDomains: [],
    excludedDomains: [],
    excludedTopics: [],
    goals: [],
    maxRecommendedPages: 30,
    enableUsFanout: false,
    inputHash: 'hash1',
    ...overrides,
  };
}

// ---------- Seeds ----------

async function seedKeyword(
  d1: D1Database,
  runId: string,
  spec: { id: string; nk: string; volume?: number | null; core?: string | null },
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO keywords (id, run_id, display_keyword, normalized_keyword, core_keyword, search_volume, metrics_missing)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .bind(spec.id, runId, spec.nk, spec.nk, spec.core ?? null, spec.volume ?? null)
    .run();
}

async function seedCluster(
  d1: D1Database,
  runId: string,
  spec: {
    id: string; label?: string; intent?: string | null; confidence?: string | null;
    serviceId?: string | null; serviceAreaId?: string | null; primaryKeywordId: string; memberIds?: string[];
  },
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO keyword_clusters (id, run_id, label, intent, confidence_label, service_id, service_area_id, primary_keyword_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      spec.id, runId, spec.label ?? spec.id, spec.intent ?? null, spec.confidence ?? null,
      spec.serviceId ?? null, spec.serviceAreaId ?? null, spec.primaryKeywordId,
    )
    .run();
  for (const mid of spec.memberIds ?? [spec.primaryKeywordId]) {
    await d1
      .prepare(`INSERT INTO cluster_keywords (cluster_id, keyword_id, membership_score, is_primary) VALUES (?, ?, 1, ?)`)
      .bind(spec.id, mid, mid === spec.primaryKeywordId ? 1 : 0)
      .run();
  }
}

async function seedSnapshot(
  d1: D1Database,
  runId: string,
  keywordId: string,
  organic: Array<{ rank: number | null; url: string }>,
  localPack = 0,
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO serp_snapshots (id, run_id, keyword_id, location_code, language_code, checked_at, organic_json, local_pack_present)
       VALUES (?, ?, ?, 2840, 'en', ?, ?, ?)`,
    )
    .bind(newId('snap'), runId, keywordId, nowIso(), JSON.stringify(organic), localPack)
    .run();
}

async function seedCompetitor(d1: D1Database, runId: string, id: string, domain: string): Promise<void> {
  await d1
    .prepare(`INSERT INTO competitors (id, run_id, domain, source, selected) VALUES (?, ?, ?, 'discovered', 1)`)
    .bind(id, runId, domain)
    .run();
}

async function seedParsedPage(
  d1: D1Database,
  runId: string,
  spec: { clusterId: string; competitorId: string | null; url: string; fetchState: string; headings: Array<{ level: number; text: string }>; topics?: string[] },
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO parsed_competitor_pages
        (id, run_id, cluster_id, competitor_id, url, fetch_state, headings_json, topics_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('pcp'), runId, spec.clusterId, spec.competitorId, spec.url, spec.fetchState,
      JSON.stringify(spec.headings), JSON.stringify(spec.topics ?? []), nowIso(),
    )
    .run();
}

// ---------------------------------------------------------------------------

describe('briefFactsFrom', () => {
  it('projects the minimal brief facts, sorted by id', () => {
    const facts = briefFactsFrom(brief({
      services: [
        { id: 's2', name: 'B', normalizedName: 'b', description: null, synonyms: [], priority: 'secondary' },
        { id: 's1', name: 'A', normalizedName: 'a', description: 'x', synonyms: ['syn'], priority: 'primary' },
      ],
    }));
    expect(facts.services.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(facts.businessName).toBe('Acme Plumbing');
    expect(facts.serviceAreas[0].uniqueProof).toEqual(['travis county']);
  });
});

describe('loadPagePlanFacts', () => {
  it('assembles cluster facts from D1 with volumes, links, SERP urls, and competitor pages', async () => {
    const { d1 } = createTestDb();
    const runId = newId('run');
    await seedKeyword(d1, runId, { id: 'k1', nk: 'drain cleaning austin', volume: 200, core: 'drain cleaning' });
    await seedKeyword(d1, runId, { id: 'k2', nk: 'drain cleaning cost', volume: 50 });
    await seedCluster(d1, runId, {
      id: 'c1', label: 'drain cleaning austin', intent: 'transactional', confidence: 'high',
      serviceId: 's1', serviceAreaId: 'a1', primaryKeywordId: 'k1', memberIds: ['k1', 'k2'],
    });
    await seedSnapshot(d1, runId, 'k1', [{ rank: 1, url: 'https://rival.com/austin' }, { rank: 2, url: 'https://other.com/x' }], 1);
    await seedCompetitor(d1, runId, 'comp1', 'rival.com');
    await seedParsedPage(d1, runId, {
      clusterId: 'c1', competitorId: 'comp1', url: 'https://rival.com/austin', fetchState: 'parsed',
      headings: [{ level: 1, text: 'Drain Cleaning Austin' }, { level: 2, text: 'Pricing' }], topics: ['emergency service'],
    });

    const facts = await loadPagePlanFacts(d1, runId, brief());
    expect(facts.clusters.length).toBe(1);
    const c = facts.clusters[0];
    expect(c.clusterId).toBe('c1');
    expect(c.primaryKeyword).toBe('drain cleaning austin');
    expect(c.coreTokens).toEqual(['drain', 'cleaning']);
    expect(c.intent).toBe('transactional');
    expect(c.confidence).toBe('high');
    expect(c.serviceId).toBe('s1');
    expect(c.serviceAreaId).toBe('a1');
    expect(c.addressableVolume).toBe(250); // 200 + 50
    expect(c.hasLocalizedEvidence).toBe(true); // area link + local pack
    expect(c.serp.urls).toEqual(['https://rival.com/austin', 'https://other.com/x']); // rank order
    expect(c.competitorPages.length).toBe(1);
    expect(c.competitorPages[0].competitorDomain).toBe('rival.com');
    expect(c.competitorPages[0].hasParsedData).toBe(true);
    expect(c.competitorPages[0].titleTokens).toEqual(['drain', 'cleaning', 'austin']);
    expect(c.competitorPages[0].headingTokens).toContain('pricing');
    expect(c.competitorPages[0].headingTokens).toContain('emergency');
  });

  it('is null-safe: missing volume -> null, no snapshot -> serp.urls null, no parsed pages -> empty', async () => {
    const { d1 } = createTestDb();
    const runId = newId('run');
    await seedKeyword(d1, runId, { id: 'k1', nk: 'water heater repair', volume: null });
    await seedCluster(d1, runId, { id: 'c1', intent: null, confidence: null, primaryKeywordId: 'k1' });

    const facts = await loadPagePlanFacts(d1, runId, brief());
    const c = facts.clusters[0];
    expect(c.addressableVolume).toBeNull(); // no member carried a volume -> null, not 0
    expect(c.serp.urls).toBeNull(); // SERP never collected -> null, not []
    expect(c.competitorPages).toEqual([]);
    expect(c.intent).toBeNull();
    expect(c.confidence).toBeNull();
    expect(c.hasLocalizedEvidence).toBe(false); // no area link
  });

  it('hasLocalizedEvidence stays false without a local pack even with an area link', async () => {
    const { d1 } = createTestDb();
    const runId = newId('run');
    await seedKeyword(d1, runId, { id: 'k1', nk: 'plumbing austin', volume: 100 });
    await seedCluster(d1, runId, { id: 'c1', serviceAreaId: 'a1', primaryKeywordId: 'k1' });
    await seedSnapshot(d1, runId, 'k1', [{ rank: 1, url: 'https://x.com/1' }], 0);

    const facts = await loadPagePlanFacts(d1, runId, brief());
    expect(facts.clusters[0].hasLocalizedEvidence).toBe(false);
    expect(facts.clusters[0].serp.urls).toEqual(['https://x.com/1']);
  });

  it('returns clusters in total id order', async () => {
    const { d1 } = createTestDb();
    const runId = newId('run');
    for (const id of ['k3', 'k1', 'k2']) await seedKeyword(d1, runId, { id, nk: `kw ${id}`, volume: 10 });
    await seedCluster(d1, runId, { id: 'c3', primaryKeywordId: 'k3' });
    await seedCluster(d1, runId, { id: 'c1', primaryKeywordId: 'k1' });
    await seedCluster(d1, runId, { id: 'c2', primaryKeywordId: 'k2' });

    const facts = await loadPagePlanFacts(d1, runId, brief());
    expect(facts.clusters.map((c) => c.clusterId)).toEqual(['c1', 'c2', 'c3']);
  });

  it('a competitor page that failed to parse carries hasParsedData=false', async () => {
    const { d1 } = createTestDb();
    const runId = newId('run');
    await seedKeyword(d1, runId, { id: 'k1', nk: 'leak repair', volume: 40 });
    await seedCluster(d1, runId, { id: 'c1', primaryKeywordId: 'k1' });
    await seedParsedPage(d1, runId, {
      clusterId: 'c1', competitorId: null, url: 'https://blocked.com/x', fetchState: 'blocked', headings: [],
    });

    const facts = await loadPagePlanFacts(d1, runId, brief());
    expect(facts.clusters[0].competitorPages[0].hasParsedData).toBe(false);
    expect(facts.clusters[0].competitorPages[0].competitorDomain).toBe('unknown');
  });
});
