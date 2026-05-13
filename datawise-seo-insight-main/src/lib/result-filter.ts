export function splitFilterTerms(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function matchesAllTerms(value: unknown, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = String(value ?? '').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
