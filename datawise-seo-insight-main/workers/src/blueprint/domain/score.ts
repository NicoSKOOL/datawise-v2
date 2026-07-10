import type { KeywordEvidence, NormalizedProjectBrief, ScoreBreakdown, ScoreComponent } from '../contracts/types';

export interface KeywordRelevanceRules {
  weights: { service: number; area: number; category: number };
  excludedTopicPenalty: number;
}

export interface OpportunityRules {
  volumeWeight: number;
  difficultyWeight: number;
  volumeCap: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function tokenOverlap(keywordTokens: Set<string>, text: string): number {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const hits = tokens.filter((t) => keywordTokens.has(t)).length;
  return hits / tokens.length;
}

export function scoreKeywordRelevance(
  keyword: KeywordEvidence,
  brief: NormalizedProjectBrief,
  rules: KeywordRelevanceRules
): ScoreBreakdown {
  const tokens = new Set(keyword.normalizedKeyword.split(' '));
  const serviceScore = Math.max(0, ...brief.services.map((s) => tokenOverlap(tokens, s.normalizedName)));
  const areaScore = Math.max(0, ...brief.serviceAreas.map((a) => tokenOverlap(tokens, a.city)));
  const categoryScore = tokenOverlap(tokens, brief.category);
  const excludedPenalty = brief.excludedTopics.some((t) => keyword.normalizedKeyword.includes(t))
    ? rules.excludedTopicPenalty
    : 0;

  const components: ScoreComponent[] = [
    { key: 'service_match', weight: rules.weights.service, rawValue: serviceScore, contribution: serviceScore * rules.weights.service },
    { key: 'area_match', weight: rules.weights.area, rawValue: areaScore, contribution: areaScore * rules.weights.area },
    { key: 'category_match', weight: rules.weights.category, rawValue: categoryScore, contribution: categoryScore * rules.weights.category },
    { key: 'excluded_topic_penalty', weight: 1, rawValue: excludedPenalty, contribution: -excludedPenalty },
  ];
  return { total: clamp01(components.reduce((sum, c) => sum + c.contribution, 0)), components };
}

// Returns null when required inputs are missing; never converts missing to zero.
export function scoreKeywordOpportunity(keyword: KeywordEvidence, rules: OpportunityRules): ScoreBreakdown | null {
  const { searchVolume, difficulty } = keyword.metrics;
  if (searchVolume === null || difficulty === null) return null;

  const volumeScore = clamp01(Math.log10(searchVolume + 1) / Math.log10(rules.volumeCap + 1));
  const easeScore = clamp01(1 - difficulty / 100);
  const components: ScoreComponent[] = [
    { key: 'volume', weight: rules.volumeWeight, rawValue: searchVolume, contribution: volumeScore * rules.volumeWeight },
    { key: 'ease', weight: rules.difficultyWeight, rawValue: difficulty, contribution: easeScore * rules.difficultyWeight },
  ];
  return { total: clamp01(components.reduce((sum, c) => sum + c.contribution, 0)), components };
}
