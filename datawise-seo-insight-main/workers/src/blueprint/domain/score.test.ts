import { describe, it, expect } from 'vitest';
import { scoreKeywordRelevance, scoreKeywordOpportunity } from './score';
import type { KeywordEvidence, NormalizedProjectBrief } from '../contracts/types';

const kw = (normalizedKeyword: string, metrics: Partial<KeywordEvidence['metrics']> = {}): KeywordEvidence => ({
  normalizedKeyword,
  variants: [normalizedKeyword],
  sources: ['fixture'],
  metrics: { searchVolume: null, cpcUsd: null, difficulty: null, ...metrics },
  evidenceRefs: ['ev1'],
});

const brief = {
  services: [{ id: 's1', name: 'Drain Cleaning', normalizedName: 'drain cleaning', description: null, synonyms: [], priority: 'primary' }],
  serviceAreas: [{ id: 'a1', city: 'Austin', region: null, countryIso: 'US', radiusKm: null, isPrimary: true, uniqueProof: [] }],
  category: 'plumber',
  excludedTopics: ['jobs'],
} as unknown as NormalizedProjectBrief;

const relevanceRules = { weights: { service: 0.5, area: 0.3, category: 0.2 }, excludedTopicPenalty: 0.5 };

describe('scoreKeywordRelevance', () => {
  it('scores service+area matches above unrelated keywords, with a breakdown', () => {
    const strong = scoreKeywordRelevance(kw('drain cleaning austin'), brief, relevanceRules);
    const weak = scoreKeywordRelevance(kw('crypto exchange'), brief, relevanceRules);
    expect(strong.total).toBeGreaterThan(weak.total);
    expect(strong.components.map((c) => c.key)).toContain('service_match');
    expect(strong.total).toBeGreaterThan(0);
    expect(strong.total).toBeLessThanOrEqual(1);
  });
  it('penalizes excluded topics', () => {
    const excluded = scoreKeywordRelevance(kw('plumber jobs'), brief, relevanceRules);
    const clean = scoreKeywordRelevance(kw('plumber'), brief, relevanceRules);
    expect(excluded.total).toBeLessThan(clean.total);
    const compound = scoreKeywordRelevance(kw('plumber jobsite cleanup'), brief, relevanceRules);
    const exact = scoreKeywordRelevance(kw('plumber jobs'), brief, relevanceRules);
    expect(compound.components.find((c) => c.key === 'excluded_topic_penalty')!.rawValue).toBe(0);
    expect(exact.components.find((c) => c.key === 'excluded_topic_penalty')!.rawValue).toBeGreaterThan(0);
  });
});

describe('scoreKeywordOpportunity', () => {
  const rules = { volumeWeight: 0.6, difficultyWeight: 0.4, volumeCap: 100000 };
  it('returns null when volume or difficulty is missing (never treats missing as 0)', () => {
    expect(scoreKeywordOpportunity(kw('a', { searchVolume: null, difficulty: 40 }), rules)).toBeNull();
    expect(scoreKeywordOpportunity(kw('a', { searchVolume: 100, difficulty: null }), rules)).toBeNull();
  });
  it('scores higher volume and lower difficulty higher', () => {
    const good = scoreKeywordOpportunity(kw('a', { searchVolume: 5000, difficulty: 20 }), rules)!;
    const bad = scoreKeywordOpportunity(kw('a', { searchVolume: 50, difficulty: 80 }), rules)!;
    expect(good.total).toBeGreaterThan(bad.total);
    expect(good.components).toHaveLength(2);
  });
});
