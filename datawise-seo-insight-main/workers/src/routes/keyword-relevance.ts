// Ranking for merged keyword lists (related_keywords + keyword_ideas).
//
// keyword_ideas matches by product category, not by text, and depth-2
// related_keywords drifts into neighbouring topics. Sorting the merged pool by
// volume before capping it let the biggest terms in the whole category win:
// "wordpress wartung" in Germany came back as "2 bundesliga spiele",
// "qr code erstellen", "tagesschau 20 uhr" (bug ebb0cef0). So rows that share a
// word with the seed are kept first, in source order (related by depth, then
// ideas by DFS relevance), and only the kept rows are sorted by volume.

// Words of 3+ characters, split on anything that is not a letter or digit, so
// "WordPress-Wartung" and "wordpress wartung" share tokens. Substring matching
// keeps German compounds ("wartungsmodus") and plurals in.
export function seedTokens(seed: string): string[] {
  return seed
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
}

export function pickRelevantKeywords<T>(
  seed: string,
  rows: T[],
  limit: number,
  keywordOf: (row: T) => string,
  volumeOf: (row: T) => number,
): T[] {
  const tokens = seedTokens(seed);
  const shares = (kw: string) => {
    const k = kw.toLowerCase();
    return tokens.some((t) => k.includes(t));
  };
  return rows
    .map((row, index) => ({ row, index, hit: tokens.length === 0 || shares(keywordOf(row)) }))
    .sort((a, b) => Number(b.hit) - Number(a.hit) || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.row)
    .sort((a, b) => volumeOf(b) - volumeOf(a));
}
