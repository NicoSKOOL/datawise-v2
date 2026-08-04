// Deterministic keyword-to-page-name cleaning, shared by the clustering engine
// (cluster-v3 name-based dedupe) and the page-plan engine (titles/slugs/logical
// ids). It lives here, not in page-plan/, so clustering can import it without a
// clustering -> page-plan dependency. Pure and deterministic: same input always
// yields the same output, no LLM, no clock, no randomness.
//
// The canonical modifier lists also back PAGE_PLAN_RULESET_V1.naming (the frozen
// page-plan ruleset references these same constants). They are the single source
// of truth for both the cleaner and that ruleset, so a change here is a change to
// the pinned ruleset hash by construction.

// Proximity phrases removed anywhere in a keyword: "drain cleaning near me" ->
// "drain cleaning". Query-shaped, never used as a page name.
export const NAMING_STRIPPED_PHRASES: readonly string[] = Object.freeze([
  'near me',
  'near you',
  'close to me',
  'in my area',
  'around me',
  'nearby',
  'open now',
]);

// Modifier words stripped only when they LEAD the keyword, so "best practices"
// content topics mid-keyword survive but "best drain cleaning" -> "drain cleaning".
export const NAMING_STRIPPED_LEADING_WORDS: readonly string[] = Object.freeze([
  'best',
  'top',
  'cheap',
  'cheapest',
]);

// Removes every contiguous, case-insensitive occurrence of `phraseWords` from
// `words`. Pure and deterministic.
function removePhraseOccurrences(words: string[], phraseWords: string[]): string[] {
  if (phraseWords.length === 0 || words.length < phraseWords.length) return words;
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let matches = i + phraseWords.length <= words.length;
    for (let j = 0; matches && j < phraseWords.length; j++) {
      if (words[i + j].toLowerCase() !== phraseWords[j]) matches = false;
    }
    if (matches) {
      i += phraseWords.length;
    } else {
      out.push(words[i]);
      i++;
    }
  }
  return out;
}

// Turns a search query into something usable as a page name. Strips the
// query-shaped modifiers listed above: proximity phrases ("near me") anywhere,
// modifier words ("best", "cheap") only when leading, and trailing year tokens.
// The raw keyword stays the page's SEO target; only the name changes. If
// stripping would empty the keyword, the original is returned so no page ever
// ends up nameless.
export function cleanKeywordForNaming(keyword: string): string {
  const original = keyword.trim().replace(/\s+/g, ' ');
  if (original === '') return '';
  let words = original.split(' ');
  for (const phrase of NAMING_STRIPPED_PHRASES) {
    words = removePhraseOccurrences(words, phrase.split(' '));
  }
  while (words.length > 0 && NAMING_STRIPPED_LEADING_WORDS.includes(words[0].toLowerCase())) {
    words = words.slice(1);
  }
  while (words.length > 0 && /^20\d{2}$/.test(words[words.length - 1])) {
    words = words.slice(0, -1);
  }
  const cleaned = words.join(' ');
  return cleaned === '' ? original : cleaned;
}
