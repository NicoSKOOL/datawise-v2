import type { KeywordCandidate } from '../../contracts/types';

// DataForSEO Labs keyword items come in two shapes depending on endpoint:
// flat ("live" list endpoints like keyword_ideas/keyword_suggestions place
// keyword_info/keyword_properties directly on the item) and ranked/nested
// (ranked_keywords-style items nest the same fields under keyword_data).
// This normalizer handles both without the caller needing to know which
// shape a given endpoint returns. Missing metrics are always null, never 0:
// a 0 would silently claim "confirmed zero search volume" for a keyword we
// simply have no data on, and downstream scoring/enrichment relies on null
// to mean "still needs a real value".
export function normalizeKeywordItem(item: any, source: string, evidenceRefId: string): KeywordCandidate | null {
  if (!item || typeof item !== 'object') return null;

  const kd = item.keyword_data ?? item;
  const keyword = kd?.keyword ?? item.keyword;
  if (typeof keyword !== 'string' || keyword.length === 0) return null;

  const info = kd?.keyword_info ?? {};
  const props = kd?.keyword_properties ?? {};

  return {
    keyword,
    source,
    metrics: {
      searchVolume: typeof info?.search_volume === 'number' ? info.search_volume : null,
      cpcUsd: typeof info?.cpc === 'number' ? info.cpc : null,
      difficulty: typeof props?.keyword_difficulty === 'number' ? props.keyword_difficulty : null,
    },
    evidenceRefs: [evidenceRefId],
  };
}
