// Deterministic script-class language-mismatch heuristic for
// normalize_keyword_universe (Phase 4 Task 7). Pure domain code: no I/O, no
// Date.now/Math.random, safe to unit test in isolation and to call once per
// keyword inside a hot loop over the whole run's keyword universe.
//
// The heuristic answers a narrower question than "is this keyword written in
// the wrong language": it answers "is this keyword written in the wrong
// SCRIPT for the expected language's family". That is a real limitation,
// documented below, not an oversight.

type ScriptClass = 'latin' | 'cyrillic' | 'cjk' | 'arabic' | 'greek' | 'hebrew' | 'other';

// Maps a language code's base subtag (before any '-' region suffix) to the
// script family a keyword in that language is expected to be written in.
// Every family named in this task's brief is listed explicitly; a language
// code missing from this map defaults to latin (see detectLanguageMismatch).
const LANGUAGE_SCRIPT_CLASS: Record<string, Exclude<ScriptClass, 'other'>> = {
  en: 'latin', es: 'latin', fr: 'latin', de: 'latin', it: 'latin', pt: 'latin',
  nl: 'latin', da: 'latin', sv: 'latin', no: 'latin', fi: 'latin', pl: 'latin', tr: 'latin',
  ru: 'cyrillic', uk: 'cyrillic', bg: 'cyrillic', sr: 'cyrillic',
  zh: 'cjk', ja: 'cjk', ko: 'cjk',
  ar: 'arabic', fa: 'arabic', ur: 'arabic',
  el: 'greek',
  he: 'hebrew',
};

// Unicode property escapes (\p{Script=...}), not hand-rolled code-point
// ranges: workerd's V8 supports them natively (ES2018+), and they are the
// correct, maintainable way to classify a character's script without
// enumerating every block by hand. 'cjk' covers Han ideographs plus the two
// Japanese kana scripts and Hangul (brief lumps zh/ja/ko into one family),
// since a mixed-script CJK keyword being majority-non-Han is still expected
// and correct for ja/ko.
const SCRIPT_TESTERS: Array<[Exclude<ScriptClass, 'other'>, RegExp]> = [
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['cjk', /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['greek', /\p{Script=Greek}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
];

const LETTER_RE = /\p{L}/u;

function classifyChar(ch: string): ScriptClass {
  for (const [cls, tester] of SCRIPT_TESTERS) {
    if (tester.test(ch)) return cls;
  }
  return 'other';
}

function scriptClassForLanguage(languageCode: string): Exclude<ScriptClass, 'other'> {
  const base = languageCode.trim().toLowerCase().split('-')[0];
  return LANGUAGE_SCRIPT_CLASS[base] ?? 'latin';
}

// Returns true when the normalized keyword's LETTER characters are majority
// (strictly more than half) outside the script class expected for
// expectedLanguageCode. Digits, punctuation, and whitespace never count as
// letters and are ignored entirely -- a keyword with no letters at all (pure
// digits, e.g. a model number) can never "mismatch". Unknown/unlisted
// language codes default to latin, per this task's brief.
//
// KNOWN LIMITATION (by design, not fixable with a script-only heuristic):
// same-script wrong-language pairs are undetectable here. A Portuguese
// keyword scored against an expected language of Spanish (or vice versa)
// both use the Latin script, so this always returns false for that pair
// regardless of which language the keyword is actually written in. Real
// cross-language detection inside one script family would need a language
// model or a dictionary, not a script census; that is out of scope for this
// deterministic, zero-cost stage.
export function detectLanguageMismatch(normalizedKeyword: string, expectedLanguageCode: string): boolean {
  const expectedClass = scriptClassForLanguage(expectedLanguageCode);
  let letters = 0;
  let mismatched = 0;
  for (const ch of normalizedKeyword) {
    if (!LETTER_RE.test(ch)) continue;
    letters += 1;
    if (classifyChar(ch) !== expectedClass) mismatched += 1;
  }
  if (letters === 0) return false;
  return mismatched * 2 > letters;
}
