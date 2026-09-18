// Non-Latin seed keywords only return data from DataForSEO Labs when the
// request's language (and, in practice, location) matches the script they are
// written in. A Thai seed sent with the US / English defaults returns zero
// keyword ideas and, until 2026-09-18, still burned a free credit (bug
// 626f52f4). For scripts that map to exactly one language, pick that language
// and its home market so the search can succeed; ambiguous scripts (Cyrillic,
// Arabic, Devanagari, Han) are left to the user's own selection.

export interface KeywordLocaleHint {
  location_code: number;
  language_code: string;
  locationLabel: string;
  languageLabel: string;
}

const SCRIPTS: Array<{ test: RegExp } & KeywordLocaleHint> = [
  { test: /[฀-๿]/, location_code: 2764, language_code: 'th', locationLabel: 'Thailand', languageLabel: 'Thai' },
  { test: /[぀-ヿ]/, location_code: 2392, language_code: 'ja', locationLabel: 'Japan', languageLabel: 'Japanese' },
  { test: /[가-힯ᄀ-ᇿ]/, location_code: 2410, language_code: 'ko', locationLabel: 'South Korea', languageLabel: 'Korean' },
  { test: /[Ͱ-Ͽ]/, location_code: 2300, language_code: 'el', locationLabel: 'Greece', languageLabel: 'Greek' },
  { test: /[֐-׿]/, location_code: 2376, language_code: 'he', locationLabel: 'Israel', languageLabel: 'Hebrew' },
];

// Returns the hint for the script that dominates the keyword's letters, or
// null when the keyword is Latin, empty, or written in an ambiguous script.
export function detectKeywordLocale(keyword: string): KeywordLocaleHint | null {
  const letters = Array.from(keyword).filter(ch => /\p{L}/u.test(ch));
  if (!letters.length) return null;
  for (const script of SCRIPTS) {
    const hits = letters.filter(ch => script.test.test(ch)).length;
    if (hits * 2 > letters.length) {
      const { test: _t, ...hint } = script;
      return hint;
    }
  }
  return null;
}

// The locale a keyword request should use: the detected script's own language
// and market when the current language cannot return data for it, otherwise
// the user's selection untouched.
export function resolveKeywordLocale(
  keyword: string,
  current: { location: string; language: string },
): { location: string; language: string; switched: KeywordLocaleHint | null } {
  const hint = detectKeywordLocale(keyword);
  if (!hint || hint.language_code === current.language) {
    return { location: current.location, language: current.language, switched: null };
  }
  return { location: String(hint.location_code), language: hint.language_code, switched: hint };
}
