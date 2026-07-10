// Unicode-normalizes, case-folds, and removes meaningless punctuation while
// preserving tokens that change meaning (hyphens, apostrophes, accents).
export function normalizeKeyword(input: string, locale: string): string {
  return input
    .normalize('NFKC')
    .toLocaleLowerCase(locale)
    .replace(/['']/g, "'")
    .replace(/["""]/g, ' ')
    .replace(/[!?.,;:()\[\]{}<>|@#$%^*+=~`\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
