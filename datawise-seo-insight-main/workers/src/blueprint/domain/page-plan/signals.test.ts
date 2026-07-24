import { describe, it, expect } from 'vitest';
import { PAGE_PLAN_RULESET_V1 } from './ruleset';
import { evaluateStrongSignals, presentStrongSignals, shouldFold } from './signals';
import type {
  CompetitorPageFact, PagePlanCluster, PagePlanFacts, ParentCandidate, SignalEvaluation,
} from './types';

const RS = PAGE_PLAN_RULESET_V1;

function cluster(overrides: Partial<PagePlanCluster> = {}): PagePlanCluster {
  return {
    clusterId: 'c1',
    label: 'emergency plumbing',
    primaryKeywordId: 'k1',
    primaryKeyword: 'emergency plumbing',
    coreTokens: ['emergency', 'plumbing'],
    intent: 'transactional',
    addressableVolume: 100,
    confidence: 'high',
    serviceId: 'svc-plumbing',
    serviceAreaId: null,
    hasLocalizedEvidence: false,
    serp: { urls: null },
    competitorPages: [],
    evidenceRefIds: [],
    memberKeywords: [],
    ...overrides,
  };
}

function parent(overrides: Partial<ParentCandidate> = {}): ParentCandidate {
  return {
    logicalId: 'svc:plumbing',
    pageType: 'service',
    intent: 'commercial',
    serpUrls: null,
    serviceId: 'svc-generic',
    serviceAreaId: null,
    ...overrides,
  };
}

function facts(overrides: Partial<PagePlanFacts> = {}): PagePlanFacts {
  return {
    brief: {
      businessName: 'Acme Plumbing',
      normalizedBusinessName: 'acme plumbing',
      category: 'plumber',
      languageCode: 'en',
      countryIso: 'US',
      services: [],
      serviceAreas: [],
    },
    clusters: [],
    overlay: null,
    ...overrides,
  };
}

function competitorPage(overrides: Partial<CompetitorPageFact> = {}): CompetitorPageFact {
  return {
    competitorDomain: 'rival.com',
    hasParsedData: true,
    titleTokens: ['emergency', 'plumbing', 'services'],
    headingTokens: [],
    ...overrides,
  };
}

function pick(evals: SignalEvaluation[], kind: SignalEvaluation['kind']): SignalEvaluation {
  const found = evals.find((e) => e.kind === kind);
  if (!found) throw new Error(`missing evaluation ${kind}`);
  return found;
}

describe('evaluateStrongSignals shape', () => {
  it('returns all six signals in a stable order', () => {
    const evals = evaluateStrongSignals(cluster(), parent(), facts(), RS);
    expect(evals.map((e) => e.kind)).toEqual([
      'distinct_intent',
      'low_serp_overlap',
      'competitor_dedicated_pages',
      'unique_conversion',
      'sufficient_demand',
      'unique_local_proof',
    ]);
    for (const e of evals) expect(typeof e.reason).toBe('string');
  });
});

describe('distinct_intent', () => {
  it('present when cluster and parent intents differ', () => {
    const evals = evaluateStrongSignals(cluster({ intent: 'transactional' }), parent({ intent: 'informational' }), facts(), RS);
    expect(pick(evals, 'distinct_intent').present).toBe(true);
  });
  it('absent when intents match', () => {
    const evals = evaluateStrongSignals(cluster({ intent: 'commercial' }), parent({ intent: 'commercial' }), facts(), RS);
    expect(pick(evals, 'distinct_intent').present).toBe(false);
  });
  it('absent (null-safe) when either intent is null', () => {
    const nullCluster = evaluateStrongSignals(cluster({ intent: null }), parent({ intent: 'commercial' }), facts(), RS);
    expect(pick(nullCluster, 'distinct_intent').present).toBe(false);
    const nullParent = evaluateStrongSignals(cluster({ intent: 'commercial' }), parent({ intent: null }), facts(), RS);
    expect(pick(nullParent, 'distinct_intent').present).toBe(false);
  });
});

describe('low_serp_overlap', () => {
  it('present when Jaccard overlap is below the threshold', () => {
    const c = cluster({ serp: { urls: ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'] } });
    const p = parent({ serpUrls: ['https://a.com/1', 'https://b.com/9', 'https://b.com/8', 'https://b.com/7'] });
    // intersection 1, union 6 -> 0.167 < 0.3
    expect(pick(evaluateStrongSignals(c, p, facts(), RS), 'low_serp_overlap').present).toBe(true);
  });
  it('absent when overlap is at or above the threshold', () => {
    const urls = ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'];
    const c = cluster({ serp: { urls } });
    const p = parent({ serpUrls: [...urls] });
    // full overlap 1.0 >= 0.3
    expect(pick(evaluateStrongSignals(c, p, facts(), RS), 'low_serp_overlap').present).toBe(false);
  });
  it('absent (null-safe) when SERP data is missing or empty', () => {
    const nullSerp = evaluateStrongSignals(cluster({ serp: { urls: null } }), parent({ serpUrls: ['https://a.com/1'] }), facts(), RS);
    expect(pick(nullSerp, 'low_serp_overlap').present).toBe(false);
    const emptySerp = evaluateStrongSignals(cluster({ serp: { urls: [] } }), parent({ serpUrls: ['https://a.com/1'] }), facts(), RS);
    expect(pick(emptySerp, 'low_serp_overlap').present).toBe(false);
  });
  it('normalizes protocol and trailing slash before comparing', () => {
    const c = cluster({ serp: { urls: ['https://a.com/1/', 'http://a.com/2'] } });
    const p = parent({ serpUrls: ['http://a.com/1', 'https://a.com/2/'] });
    // both URLs match after normalization -> overlap 1.0 -> absent
    expect(pick(evaluateStrongSignals(c, p, facts(), RS), 'low_serp_overlap').present).toBe(false);
  });
});

describe('competitor_dedicated_pages', () => {
  it('present at exactly the 0.4 ratio boundary', () => {
    const pages = [
      competitorPage({ competitorDomain: 'a.com' }),
      competitorPage({ competitorDomain: 'b.com' }),
      competitorPage({ competitorDomain: 'c.com', titleTokens: ['other'] }),
      competitorPage({ competitorDomain: 'd.com', titleTokens: ['other'] }),
      competitorPage({ competitorDomain: 'e.com', titleTokens: ['other'] }),
    ];
    // 2 of 5 match = 0.4 exactly
    expect(pick(evaluateStrongSignals(cluster({ competitorPages: pages }), parent(), facts(), RS), 'competitor_dedicated_pages').present).toBe(true);
  });
  it('absent just below the boundary', () => {
    const pages = [
      competitorPage({ competitorDomain: 'a.com' }),
      competitorPage({ competitorDomain: 'b.com', titleTokens: ['other'] }),
      competitorPage({ competitorDomain: 'c.com', titleTokens: ['other'] }),
      competitorPage({ competitorDomain: 'd.com', titleTokens: ['other'] }),
      competitorPage({ competitorDomain: 'e.com', titleTokens: ['other'] }),
    ];
    // 1 of 5 = 0.2 < 0.4
    expect(pick(evaluateStrongSignals(cluster({ competitorPages: pages }), parent(), facts(), RS), 'competitor_dedicated_pages').present).toBe(false);
  });
  it('absent when no competitor has parsed data', () => {
    const pages = [
      competitorPage({ competitorDomain: 'a.com', hasParsedData: false }),
      competitorPage({ competitorDomain: 'b.com', hasParsedData: false }),
    ];
    const evals = evaluateStrongSignals(cluster({ competitorPages: pages }), parent(), facts(), RS);
    expect(pick(evals, 'competitor_dedicated_pages').present).toBe(false);
  });
  it('ignores unparsed competitors when computing the ratio', () => {
    const pages = [
      competitorPage({ competitorDomain: 'a.com' }),
      competitorPage({ competitorDomain: 'b.com', hasParsedData: false, titleTokens: ['other'] }),
    ];
    // parsed = 1, match = 1 -> ratio 1.0
    expect(pick(evaluateStrongSignals(cluster({ competitorPages: pages }), parent(), facts(), RS), 'competitor_dedicated_pages').present).toBe(true);
  });
  it('falls back to heading tokens only when the parsed page has no title tokens', () => {
    const page = competitorPage({ titleTokens: [], headingTokens: ['emergency', 'plumbing'] });
    expect(pick(evaluateStrongSignals(cluster({ competitorPages: [page] }), parent(), facts(), RS), 'competitor_dedicated_pages').present).toBe(true);
  });
  it('does not match on headings when title tokens are present but partial', () => {
    const page = competitorPage({ titleTokens: ['emergency'], headingTokens: ['emergency', 'plumbing'] });
    expect(pick(evaluateStrongSignals(cluster({ competitorPages: [page] }), parent(), facts(), RS), 'competitor_dedicated_pages').present).toBe(false);
  });
  it('absent when the cluster has no core tokens', () => {
    const page = competitorPage();
    expect(pick(evaluateStrongSignals(cluster({ coreTokens: [], competitorPages: [page] }), parent(), facts(), RS), 'competitor_dedicated_pages').present).toBe(false);
  });
});

describe('unique_conversion', () => {
  it('present when a conversion intent cluster has a distinct service link', () => {
    const c = cluster({ intent: 'transactional', serviceId: 'svc-drain' });
    const p = parent({ serviceId: 'svc-generic' });
    expect(pick(evaluateStrongSignals(c, p, facts(), RS), 'unique_conversion').present).toBe(true);
  });
  it('absent when the service link matches the parent', () => {
    const c = cluster({ intent: 'transactional', serviceId: 'svc-same' });
    const p = parent({ serviceId: 'svc-same' });
    expect(pick(evaluateStrongSignals(c, p, facts(), RS), 'unique_conversion').present).toBe(false);
  });
  it('absent when the cluster intent is not a conversion intent', () => {
    const c = cluster({ intent: 'informational', serviceId: 'svc-drain' });
    expect(pick(evaluateStrongSignals(c, parent(), facts(), RS), 'unique_conversion').present).toBe(false);
  });
  it('absent (null-safe) when the cluster has no service link', () => {
    const c = cluster({ intent: 'transactional', serviceId: null });
    expect(pick(evaluateStrongSignals(c, parent(), facts(), RS), 'unique_conversion').present).toBe(false);
  });
});

describe('sufficient_demand', () => {
  it('present at exactly the demand floor', () => {
    const c = cluster({ addressableVolume: RS.separate.minDemandVolume });
    expect(pick(evaluateStrongSignals(c, parent(), facts(), RS), 'sufficient_demand').present).toBe(true);
  });
  it('absent below the demand floor', () => {
    const c = cluster({ addressableVolume: RS.separate.minDemandVolume - 1 });
    expect(pick(evaluateStrongSignals(c, parent(), facts(), RS), 'sufficient_demand').present).toBe(false);
  });
  it('absent (null-safe) when volume is missing, never treated as zero', () => {
    const c = cluster({ addressableVolume: null });
    expect(pick(evaluateStrongSignals(c, parent(), facts(), RS), 'sufficient_demand').present).toBe(false);
  });
});

describe('unique_local_proof', () => {
  it('present when a localized cluster ties to an area with unique proof', () => {
    const f = facts({
      brief: {
        ...facts().brief,
        serviceAreas: [{ id: 'area-austin', city: 'Austin', region: 'TX', isPrimary: true, uniqueProof: ['20 years in Austin'] }],
      },
    });
    const c = cluster({ serviceAreaId: 'area-austin', hasLocalizedEvidence: true });
    expect(pick(evaluateStrongSignals(c, parent(), f, RS), 'unique_local_proof').present).toBe(true);
  });
  it('absent when the area has no unique proof', () => {
    const f = facts({
      brief: {
        ...facts().brief,
        serviceAreas: [{ id: 'area-austin', city: 'Austin', region: 'TX', isPrimary: true, uniqueProof: [] }],
      },
    });
    const c = cluster({ serviceAreaId: 'area-austin', hasLocalizedEvidence: true });
    expect(pick(evaluateStrongSignals(c, parent(), f, RS), 'unique_local_proof').present).toBe(false);
  });
  it('absent when the cluster carries no localized evidence', () => {
    const f = facts({
      brief: {
        ...facts().brief,
        serviceAreas: [{ id: 'area-austin', city: 'Austin', region: 'TX', isPrimary: true, uniqueProof: ['proof'] }],
      },
    });
    const c = cluster({ serviceAreaId: 'area-austin', hasLocalizedEvidence: false });
    expect(pick(evaluateStrongSignals(c, parent(), f, RS), 'unique_local_proof').present).toBe(false);
  });
  it('absent (null-safe) when the cluster is not tied to an area', () => {
    const c = cluster({ serviceAreaId: null, hasLocalizedEvidence: true });
    expect(pick(evaluateStrongSignals(c, parent(), facts(), RS), 'unique_local_proof').present).toBe(false);
  });
});

describe('presentStrongSignals', () => {
  it('returns only the fired signal names in evaluation order', () => {
    const f = facts({
      brief: {
        ...facts().brief,
        serviceAreas: [{ id: 'area-austin', city: 'Austin', region: 'TX', isPrimary: true, uniqueProof: ['proof'] }],
      },
    });
    const c = cluster({
      intent: 'transactional',
      serviceId: 'svc-drain',
      serviceAreaId: 'area-austin',
      hasLocalizedEvidence: true,
      addressableVolume: 500,
    });
    const p = parent({ intent: 'informational', serviceId: 'svc-generic' });
    const present = presentStrongSignals(evaluateStrongSignals(c, p, f, RS));
    expect(present).toEqual(['distinct_intent', 'unique_conversion', 'sufficient_demand', 'unique_local_proof']);
  });
});

describe('shouldFold', () => {
  it('folds a question-word-led cluster as an FAQ', () => {
    for (const word of RS.fold.questionWords) {
      const c = cluster({ primaryKeyword: `${word} to fix a leak` });
      const decision = shouldFold(c, parent(), facts(), RS);
      expect(decision.fold).toBe(true);
      expect(decision.as).toBe('faq');
    }
  });
  it('prefers FAQ over section when a question cluster also overlaps the SERP', () => {
    const urls = ['https://a.com/1', 'https://a.com/2'];
    const c = cluster({ primaryKeyword: 'how to unclog a drain', serp: { urls } });
    const p = parent({ serpUrls: [...urls] });
    const decision = shouldFold(c, p, facts(), RS);
    expect(decision.as).toBe('faq');
  });
  it('folds a high-SERP-overlap non-question cluster as a section', () => {
    const urls = ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'];
    const c = cluster({ primaryKeyword: 'drain cleaning', serp: { urls } });
    const p = parent({ serpUrls: [...urls] });
    const decision = shouldFold(c, p, facts(), RS);
    expect(decision).toMatchObject({ fold: true, as: 'section' });
  });
  it('does not fold when overlap is below the threshold and the keyword is not a question', () => {
    const c = cluster({ primaryKeyword: 'drain cleaning', serp: { urls: ['https://a.com/1'] } });
    const p = parent({ serpUrls: ['https://b.com/9'] });
    expect(shouldFold(c, p, facts(), RS).fold).toBe(false);
  });
  it('does not section-fold on missing SERP data', () => {
    const c = cluster({ primaryKeyword: 'drain cleaning', serp: { urls: null } });
    const p = parent({ serpUrls: null });
    expect(shouldFold(c, p, facts(), RS).fold).toBe(false);
  });
  it('uses the ruleset question words, not a hardcoded list', () => {
    // "repair" is not in fold.questionWords, so a leading "repair" is not an FAQ.
    const questionWords: readonly string[] = RS.fold.questionWords;
    expect(questionWords.includes('repair')).toBe(false);
    const c = cluster({ primaryKeyword: 'repair my faucet', serp: { urls: null } });
    expect(shouldFold(c, parent(), facts(), RS).as).not.toBe('faq');
  });
});
