import type { KeywordCandidate, KeywordUniverse, MergedKeyword } from '../contracts/types';
import { normalizeKeyword } from './keyword';

export function mergeKeywordCandidates(sources: KeywordCandidate[][], locale: string): KeywordUniverse {
  const byNormalized = new Map<string, MergedKeyword>();

  for (const batch of sources) {
    for (const candidate of batch) {
      const normalized = normalizeKeyword(candidate.keyword, locale);
      if (!normalized) continue;
      const existing = byNormalized.get(normalized);
      if (!existing) {
        byNormalized.set(normalized, {
          normalizedKeyword: normalized,
          variants: [candidate.keyword],
          sources: [candidate.source],
          metrics: { ...candidate.metrics },
          evidenceRefs: [...new Set(candidate.evidenceRefs)],
        });
        continue;
      }
      if (!existing.variants.includes(candidate.keyword)) existing.variants.push(candidate.keyword);
      if (!existing.sources.includes(candidate.source)) existing.sources.push(candidate.source);
      // First non-null wins; null stays null until real evidence arrives.
      existing.metrics.searchVolume ??= candidate.metrics.searchVolume;
      existing.metrics.cpcUsd ??= candidate.metrics.cpcUsd;
      existing.metrics.difficulty ??= candidate.metrics.difficulty;
      for (const ref of candidate.evidenceRefs) {
        if (!existing.evidenceRefs.includes(ref)) existing.evidenceRefs.push(ref);
      }
    }
  }

  return { keywords: [...byNormalized.values()] };
}
