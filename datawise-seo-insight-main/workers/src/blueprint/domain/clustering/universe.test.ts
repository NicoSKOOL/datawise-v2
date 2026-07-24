import { describe, it, expect } from 'vitest';
import { planUniverseNormalization } from './universe';
import type { KeywordRowLite } from './universe';
import type { NormalizedProjectBrief } from '../../contracts/types';
import type { KeywordEnrichment } from '../../providers/dataforseo/evidence-readback';
import { CLUSTER_RULESET_V2 } from './ruleset';
import type { ClusterRuleset } from './ruleset';

const BRIEF: NormalizedProjectBrief = {
  mode: 'existing_site',
  businessName: 'Aqua Plumbing',
  normalizedBusinessName: 'aqua plumbing',
  category: 'plumber',
  websiteDomain: 'aquaplumbing.com',
  websiteUrl: 'https://aquaplumbing.com',
  countryIso: 'us',
  languageCode: 'en',
  services: [
    { id: 's1', name: 'Drain Cleaning', normalizedName: 'drain cleaning', description: null, synonyms: [], priority: 'primary' },
  ],
  serviceAreas: [
    { id: 'a1', city: 'Austin', region: null, countryIso: 'us', radiusKm: null, isPrimary: true, uniqueProof: [] },
  ],
  targetCustomers: [],
  differentiators: [],
  knownCompetitorDomains: [],
  excludedDomains: [],
  excludedTopics: ['jobs'],
  goals: [],
  maxRecommendedPages: 30,
  enableUsFanout: false,
  inputHash: 'hash1',
};

function row(overrides: Partial<KeywordRowLite> & { id: string; normalizedKeyword: string }): KeywordRowLite {
  return {
    searchVolume: null,
    keywordDifficulty: null,
    coreKeyword: null,
    mainIntent: null,
    intentProbabilities: null,
    monthlySearches: null,
    serpItemTypes: null,
    avgReferringDomains: null,
    paidCompetition: null,
    ...overrides,
  };
}

const EMPTY_ENRICHMENT: KeywordEnrichment = {
  coreKeyword: null,
  mainIntent: null,
  intentProbabilities: null,
  monthlySearches: null,
  serpItemTypes: null,
  avgReferringDomains: null,
  paidCompetition: null,
};

function fieldsFor(plan: ReturnType<typeof planUniverseNormalization>, keywordId: string) {
  const update = plan.updates.find((u) => u.keywordId === keywordId);
  if (!update) throw new Error(`no update for ${keywordId}`);
  return update.fields;
}

describe('planUniverseNormalization', () => {
  it('fills only currently-NULL enrichment fields, never overwriting an existing value', () => {
    const keywords: KeywordRowLite[] = [
      row({ id: 'k1', normalizedKeyword: 'drain cleaning austin' }),
      row({
        id: 'k2',
        normalizedKeyword: 'plumber austin',
        coreKeyword: 'existing core',
        mainIntent: 'commercial',
        intentProbabilities: { commercial: 1 },
        monthlySearches: [{ year: 2026, month: 1, searchVolume: 10 }],
        serpItemTypes: ['organic'],
        avgReferringDomains: 5,
        paidCompetition: 0.1,
      }),
    ];
    const enrichment = new Map<string, KeywordEnrichment>([
      ['drain cleaning austin', { ...EMPTY_ENRICHMENT, coreKeyword: 'drain cleaning', mainIntent: 'transactional' }],
      ['plumber austin', { ...EMPTY_ENRICHMENT, coreKeyword: 'different core', mainIntent: 'informational' }],
    ]);

    const plan = planUniverseNormalization({ keywords, enrichment, brief: BRIEF, ruleset: CLUSTER_RULESET_V2 });

    const f1 = fieldsFor(plan, 'k1');
    expect(f1.coreKeyword).toBe('drain cleaning');
    expect(f1.mainIntent).toBe('transactional');

    const f2 = fieldsFor(plan, 'k2');
    expect(f2.coreKeyword).toBeUndefined();
    expect(f2.mainIntent).toBeUndefined();

    expect(plan.counters.enriched).toBe(1);
  });

  it('computes relevance always, and opportunity only when both volume and difficulty are present', () => {
    const keywords: KeywordRowLite[] = [
      row({ id: 'k1', normalizedKeyword: 'drain cleaning austin', searchVolume: 500, keywordDifficulty: 20 }),
      row({ id: 'k2', normalizedKeyword: 'random unrelated text', searchVolume: null, keywordDifficulty: 20 }),
    ];
    const plan = planUniverseNormalization({
      keywords,
      enrichment: new Map(),
      brief: BRIEF,
      ruleset: CLUSTER_RULESET_V2,
    });

    const f1 = fieldsFor(plan, 'k1');
    expect(f1.relevanceScore).toBeGreaterThan(0);
    expect(f1.opportunityScore).not.toBeNull();

    const f2 = fieldsFor(plan, 'k2');
    expect(f2.opportunityScore).toBeNull();
  });

  it('applies exclusion precedence: excluded_topic beats language_mismatch beats relevance_cap', () => {
    const keywords: KeywordRowLite[] = [
      row({ id: 'k1', normalizedKeyword: 'plumber jobs' }), // matches excludedTopics: ['jobs']
      row({ id: 'k2', normalizedKeyword: 'сантехник austin' }), // cyrillic vs expected 'en'
      row({ id: 'k3', normalizedKeyword: 'drain cleaning services austin' }), // clean, retained
    ];
    const plan = planUniverseNormalization({
      keywords,
      enrichment: new Map(),
      brief: BRIEF,
      ruleset: CLUSTER_RULESET_V2,
    });

    expect(fieldsFor(plan, 'k1').excludedReason).toBe('excluded_topic');
    expect(fieldsFor(plan, 'k2').excludedReason).toBe('language_mismatch');
    expect(fieldsFor(plan, 'k2').languageCode).toBeNull();
    expect(fieldsFor(plan, 'k2').isLanguageMismatch).toBe(true);
    expect(fieldsFor(plan, 'k3').excludedReason).toBeNull();
    expect(fieldsFor(plan, 'k3').languageCode).toBe('en');
  });

  it('caps retention at ruleset.universe.maxRetained by relevance rank, exempting user-seed keywords', () => {
    const ruleset = {
      ...CLUSTER_RULESET_V2,
      universe: { ...CLUSTER_RULESET_V2.universe, maxRetained: 1 },
    } as unknown as ClusterRuleset;
    const keywords: KeywordRowLite[] = [
      // Exact user-seed string (buildSeedQueries emits "<service> <primary area city>"
      // for a greenfield/existing_site brief): exempt from the cap entirely.
      row({ id: 'seed', normalizedKeyword: 'drain cleaning austin' }),
      // Not an exact seed string, but strong service+area token overlap: highest
      // relevance among the capped population.
      row({ id: 'strong', normalizedKeyword: 'drain cleaning services austin' }),
      // No overlap with service/area/category at all: lowest relevance.
      row({ id: 'weak', normalizedKeyword: 'random totally unrelated text' }),
    ];
    const plan = planUniverseNormalization({ keywords, enrichment: new Map(), brief: BRIEF, ruleset });

    expect(fieldsFor(plan, 'seed').excludedReason).toBeNull();
    expect(fieldsFor(plan, 'strong').excludedReason).toBeNull();
    expect(fieldsFor(plan, 'weak').excludedReason).toBe('relevance_cap');
    // retained = seed + strong (2), even though maxRetained is 1 -- the seed
    // keyword does not consume a slot.
    expect(plan.counters.retained).toBe(2);
    expect(plan.counters.excluded).toBe(1);
  });

  it('links keywords to services and service areas by all-tokens-present matching', () => {
    const keywords: KeywordRowLite[] = [row({ id: 'k1', normalizedKeyword: 'drain cleaning austin' })];
    const plan = planUniverseNormalization({
      keywords,
      enrichment: new Map(),
      brief: BRIEF,
      ruleset: CLUSTER_RULESET_V2,
    });
    expect(plan.serviceLinks).toContainEqual(['k1', 's1']);
    expect(plan.serviceAreaLinks).toContainEqual(['k1', 'a1']);
  });

  it('produces deterministic output for the same input', () => {
    const keywords: KeywordRowLite[] = [
      row({ id: 'k1', normalizedKeyword: 'drain cleaning austin', searchVolume: 500, keywordDifficulty: 20 }),
      row({ id: 'k2', normalizedKeyword: 'plumber jobs' }),
      row({ id: 'k3', normalizedKeyword: 'сантехник austin' }),
    ];
    const enrichment = new Map<string, KeywordEnrichment>([
      ['drain cleaning austin', { ...EMPTY_ENRICHMENT, coreKeyword: 'drain cleaning' }],
    ]);
    const input = { keywords, enrichment, brief: BRIEF, ruleset: CLUSTER_RULESET_V2 };

    const plan1 = planUniverseNormalization(input);
    const plan2 = planUniverseNormalization(input);
    expect(plan1).toEqual(plan2);
  });

  it('reports correct counters across a mixed batch', () => {
    const keywords: KeywordRowLite[] = [
      row({ id: 'k1', normalizedKeyword: 'drain cleaning austin' }), // retained, enriched
      row({ id: 'k2', normalizedKeyword: 'plumber jobs' }), // excluded_topic
      row({ id: 'k3', normalizedKeyword: 'сантехник austin' }), // language_mismatch
      row({ id: 'k4', normalizedKeyword: 'drain cleaning services austin' }), // retained
    ];
    const enrichment = new Map<string, KeywordEnrichment>([
      ['drain cleaning austin', { ...EMPTY_ENRICHMENT, coreKeyword: 'drain cleaning' }],
    ]);
    const plan = planUniverseNormalization({ keywords, enrichment, brief: BRIEF, ruleset: CLUSTER_RULESET_V2 });

    expect(plan.counters).toEqual({
      total: 4,
      retained: 2,
      excluded: 2,
      languageMismatches: 1,
      enriched: 1,
    });
  });
});

describe('planUniverseNormalization geo_candidate flagging (cluster-v3)', () => {
  // Austin-only brief with a Dallas variant for the in-area case.
  const AUSTIN_BRIEF = BRIEF;
  const DALLAS_BRIEF: NormalizedProjectBrief = {
    ...BRIEF,
    serviceAreas: [
      { id: 'a1', city: 'Austin', region: null, countryIso: 'us', radiusKm: null, isPrimary: true, uniqueProof: [] },
      { id: 'a2', city: 'Dallas', region: null, countryIso: 'us', radiusKm: null, isPrimary: false, uniqueProof: [] },
    ],
  };

  const isFlagged = (plan: ReturnType<typeof planUniverseNormalization>, id: string): boolean =>
    plan.geoCandidates.some((g) => g.keywordId === id);

  function planFor(keywords: KeywordRowLite[], brief: NormalizedProjectBrief) {
    return planUniverseNormalization({ keywords, enrichment: new Map(), brief, ruleset: CLUSTER_RULESET_V2 });
  }

  it('flags a keyword naming an out-of-area city (Dallas for an Austin-only brief)', () => {
    const plan = planFor([row({ id: 'k1', normalizedKeyword: 'dallas emergency plumbing' })], AUSTIN_BRIEF);
    expect(isFlagged(plan, 'k1')).toBe(true);
    expect(plan.geoCandidates.find((g) => g.keywordId === 'k1')?.matchedGeoTerms).toContain('dallas');
  });

  it('does NOT flag a keyword naming the brief service area (Austin)', () => {
    const plan = planFor([row({ id: 'k1', normalizedKeyword: 'austin drain cleaning' })], AUSTIN_BRIEF);
    expect(isFlagged(plan, 'k1')).toBe(false);
  });

  it('flags via a multi-word out-of-area city (San Antonio)', () => {
    const plan = planFor([row({ id: 'k1', normalizedKeyword: 'san antonio plumber' })], AUSTIN_BRIEF);
    expect(isFlagged(plan, 'k1')).toBe(true);
    expect(plan.geoCandidates.find((g) => g.keywordId === 'k1')?.matchedGeoTerms).toContain('san antonio');
  });

  it('does NOT flag a city that IS a brief service area (Dallas when Dallas is served)', () => {
    const plan = planFor([row({ id: 'k1', normalizedKeyword: 'dallas emergency plumbing' })], DALLAS_BRIEF);
    expect(isFlagged(plan, 'k1')).toBe(false);
  });

  it('flags a brand-word city like Plano when it is not a service area (adjudicator decides later)', () => {
    const plan = planFor([row({ id: 'k1', normalizedKeyword: 'plano plumber' })], AUSTIN_BRIEF);
    expect(isFlagged(plan, 'k1')).toBe(true);
    expect(plan.geoCandidates.find((g) => g.keywordId === 'k1')?.matchedGeoTerms).toContain('plano');
  });

  it('does NOT exclude flagged keywords in stage 8 (flagging only, no excluded_reason)', () => {
    const plan = planFor([row({ id: 'k1', normalizedKeyword: 'dallas emergency plumbing' })], AUSTIN_BRIEF);
    expect(isFlagged(plan, 'k1')).toBe(true);
    expect(fieldsFor(plan, 'k1').excludedReason).toBeNull();
  });
});
