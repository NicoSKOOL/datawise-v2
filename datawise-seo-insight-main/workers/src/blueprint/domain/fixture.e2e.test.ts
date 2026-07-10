import { describe, it, expect } from 'vitest';
import { parseProjectBrief, normalizeProjectBrief } from './brief';
import { buildSeedQueries } from './seeds';
import { mergeKeywordCandidates } from './merge';
import { scoreKeywordRelevance, scoreKeywordOpportunity } from './score';
import { validateBlueprintGraph } from './graph';
import { normalizeSlug } from './slug';
import { V1_LIMITS } from '../contracts/limits';
import type { BlueprintPageNode, KeywordCandidate } from '../contracts/types';

const rawBrief = {
  businessName: 'Aqua Plumbing',
  category: 'Plumber',
  countryIso: 'us',
  languageCode: 'en',
  services: [
    { clientId: 's1', name: 'Emergency Plumbing' },
    { clientId: 's2', name: 'Drain Cleaning' },
  ],
  serviceAreas: [{ clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true, uniqueProof: ['South Lamar office'] }],
};

// Fixture stands in for DataForSEO output. Note deliberate null metrics.
const fixtureCandidates: KeywordCandidate[][] = [
  [
    { keyword: 'emergency plumber austin', source: 'fixture_ideas', metrics: { searchVolume: 1900, cpcUsd: 12.5, difficulty: 35 }, evidenceRefs: ['ev_kw_1'] },
    { keyword: 'Emergency Plumber Austin!', source: 'fixture_suggestions', metrics: { searchVolume: null, cpcUsd: null, difficulty: null }, evidenceRefs: ['ev_kw_2'] },
    { keyword: 'drain cleaning austin', source: 'fixture_ideas', metrics: { searchVolume: 720, cpcUsd: null, difficulty: 28 }, evidenceRefs: ['ev_kw_3'] },
    { keyword: 'plumber near me', source: 'fixture_ideas', metrics: { searchVolume: 9900, cpcUsd: 8.1, difficulty: null }, evidenceRefs: ['ev_kw_4'] },
  ],
];

describe('Phase 1 acceptance: deterministic fixture blueprint', () => {
  it('brief -> seeds -> merge -> score -> pages -> valid graph, with nulls preserved end to end', async () => {
    const brief = await normalizeProjectBrief(parseProjectBrief(rawBrief), V1_LIMITS);

    const seedPlan = buildSeedQueries(brief, { maxTotalSeeds: V1_LIMITS.maxSeedQueries, includePrimaryAreaSeeds: true });
    expect(seedPlan.seeds.length).toBe(5); // category + 2 services + 2 service+austin
    expect(seedPlan.truncated).toBe(false);

    const universe = mergeKeywordCandidates(fixtureCandidates, 'en-US');
    expect(universe.keywords).toHaveLength(3); // the two emergency variants merged
    const merged = universe.keywords.find((k) => k.normalizedKeyword === 'emergency plumber austin')!;
    expect(merged.evidenceRefs).toEqual(['ev_kw_1', 'ev_kw_2']);

    const relevanceRules = { weights: { service: 0.5, area: 0.3, category: 0.2 }, excludedTopicPenalty: 0.5 };
    const opportunityRules = { volumeWeight: 0.6, difficultyWeight: 0.4, volumeCap: 100000 };
    for (const kw of universe.keywords) {
      expect(scoreKeywordRelevance(kw, brief, relevanceRules).total).toBeGreaterThanOrEqual(0);
    }
    // 'plumber near me' has null difficulty: opportunity must be null, never 0.
    const nearMe = universe.keywords.find((k) => k.normalizedKeyword === 'plumber near me')!;
    expect(scoreKeywordOpportunity(nearMe, opportunityRules)).toBeNull();

    const pages: BlueprintPageNode[] = [
      { id: 'home', parentId: null, type: 'home', title: 'Aqua Plumbing', slug: '/', primaryKeywordNormalized: 'plumber austin', recommendation: 'create', approval: 'proposed' },
      { id: 'p1', parentId: 'home', type: 'service', title: 'Emergency Plumbing in Austin', slug: normalizeSlug('emergency plumbing austin'), primaryKeywordNormalized: 'emergency plumber austin', recommendation: 'create', approval: 'proposed' },
      { id: 'p2', parentId: 'home', type: 'service', title: 'Drain Cleaning in Austin', slug: normalizeSlug('drain cleaning austin'), primaryKeywordNormalized: 'drain cleaning austin', recommendation: 'create', approval: 'proposed' },
    ];
    expect(validateBlueprintGraph(pages)).toEqual({ valid: true, errors: [] });

    // Determinism: rerunning the whole pipeline gives identical output.
    const brief2 = await normalizeProjectBrief(parseProjectBrief(rawBrief), V1_LIMITS);
    expect(brief2.inputHash).toBe(brief.inputHash);
    expect(mergeKeywordCandidates(fixtureCandidates, 'en-US')).toEqual(universe);
  });
});
