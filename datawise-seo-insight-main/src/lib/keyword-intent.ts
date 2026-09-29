// DataForSEO Labs returns `search_intent_info.main_intent` on every keyword
// item (suggestions, ideas, related). Surface it as a readable column so users
// can see what kind of keyword they are looking at (feature request 6310efc2).

const LABELS: Record<string, string> = {
  informational: 'Informational',
  navigational: 'Navigational',
  commercial: 'Commercial',
  transactional: 'Transactional',
};

export function intentLabel(searchIntentInfo: unknown): string {
  const main = (searchIntentInfo as { main_intent?: unknown } | null | undefined)?.main_intent;
  if (typeof main !== 'string') return '-';
  return LABELS[main.toLowerCase()] ?? '-';
}
