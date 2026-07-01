export interface KeywordFilterState {
  includeTerms: string;
  excludeTerms: string;
  minVolume: number | null;
  maxVolume: number | null;
  minWordCount: number | null;
  maxWordCount: number | null;
  intents: string[];
  excludeBrand: boolean;
}

export const emptyKeywordFilterState: KeywordFilterState = {
  includeTerms: '',
  excludeTerms: '',
  minVolume: null,
  maxVolume: null,
  minWordCount: null,
  maxWordCount: null,
  intents: [],
  excludeBrand: false,
};

export function parseFilterTerms(input: string): string[] {
  return input
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

const GENERIC_DOMAIN_TOKENS = new Set(['www', 'com', 'net', 'org', 'the', 'and']);

export function deriveBrandTokens(
  domains: Array<string | null | undefined>,
): string[] {
  const tokens = new Set<string>();
  for (const domain of domains) {
    if (!domain) continue;
    const host = domain
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0];
    const parts = host.split('.');
    // Drop TLD segments: keep only labels before the first dot group that
    // looks like a public suffix (everything after the first label of a
    // 2-label host, or the last 2 labels of longer hosts).
    const nameLabels = parts.length <= 2 ? parts.slice(0, 1) : parts.slice(0, -2 + (parts[parts.length - 2].length > 3 ? 1 : 0));
    for (const label of nameLabels) {
      for (const token of label.split(/[^a-z0-9]+/)) {
        if (token.length >= 3 && !GENERIC_DOMAIN_TOKENS.has(token)) {
          tokens.add(token);
        }
      }
    }
  }
  return [...tokens];
}

export function countFilterableWords(keyword: string): number {
  return keyword.trim().split(/\s+/).filter(Boolean).length;
}

export function isKeywordFilterActive(state: KeywordFilterState): boolean {
  return (
    parseFilterTerms(state.includeTerms).length > 0 ||
    parseFilterTerms(state.excludeTerms).length > 0 ||
    state.minVolume !== null ||
    state.maxVolume !== null ||
    state.minWordCount !== null ||
    state.maxWordCount !== null ||
    state.intents.length > 0 ||
    state.excludeBrand
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordOf(row: Record<string, unknown>): string {
  return typeof row.keyword === 'string' ? row.keyword.toLowerCase() : '';
}

function volumeOf(row: Record<string, unknown>): number {
  const n = Number(row.search_volume);
  return Number.isFinite(n) ? n : 0;
}

export function filterKeywordRows<T extends Record<string, unknown>>(
  rows: T[],
  state: KeywordFilterState,
  opts?: { brandTokens?: string[] },
): T[] {
  if (!isKeywordFilterActive(state)) return rows;

  const include = parseFilterTerms(state.includeTerms);
  const exclude = parseFilterTerms(state.excludeTerms);
  const intents = state.intents.map((i) => i.toLowerCase());
  const brandTokens =
    state.excludeBrand && opts?.brandTokens ? opts.brandTokens : [];
  const brandPatterns = brandTokens.map(
    (token) => new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i'),
  );

  return rows.filter((row) => {
    const keyword = keywordOf(row);
    if (!keyword) return false;

    if (include.length > 0 && !include.some((term) => keyword.includes(term))) {
      return false;
    }
    if (exclude.some((term) => keyword.includes(term))) return false;

    const volume = volumeOf(row);
    if (state.minVolume !== null && volume < state.minVolume) return false;
    if (state.maxVolume !== null && volume > state.maxVolume) return false;

    const words = countFilterableWords(keyword);
    if (state.minWordCount !== null && words < state.minWordCount) return false;
    if (state.maxWordCount !== null && words > state.maxWordCount) return false;

    if (intents.length > 0 && typeof row.intent === 'string') {
      if (!intents.includes(row.intent.toLowerCase())) return false;
    }

    if (brandPatterns.some((pattern) => pattern.test(keyword))) return false;

    return true;
  });
}
