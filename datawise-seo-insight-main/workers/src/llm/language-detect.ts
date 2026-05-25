// Lightweight server-side language detector for the 6 language families
// the app supports (en, es, fr, de, it, pt). Uses stopword frequency —
// no external dependency, ~1ms per call, deterministic, works in Workers.
//
// We only detect FAMILY (es covers both es-ES and es-419; pt covers
// pt-PT and pt-BR), not variant. The variant guidance is enforced
// upstream by the prompt instruction; this check is the safety net for
// the case where the model ignores the prompt and ships English (or
// the wrong family entirely).

import type { OutputLanguageCode } from './output-language';

export type LanguageFamily = 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'unknown';

// Curated stopwords. Each list is roughly the 12-15 most distinctive
// closed-class words in that language. Picked to minimize collisions
// (e.g. "la" appears in es/fr/it — kept in all three so the count is
// fair; "der/die/das" is German-only so it weights strongly).
const STOPWORDS: Record<Exclude<LanguageFamily, 'unknown'>, string[]> = {
  en: ['the', 'and', 'of', 'to', 'is', 'in', 'for', 'with', 'on', 'that', 'this', 'are', 'be', 'as', 'or'],
  es: ['el', 'la', 'los', 'las', 'que', 'de', 'es', 'un', 'una', 'para', 'con', 'por', 'pero', 'como', 'más'],
  fr: ['le', 'la', 'les', 'que', 'est', 'des', 'un', 'une', 'pour', 'avec', 'sur', 'dans', 'pas', 'plus', 'mais'],
  de: ['der', 'die', 'das', 'und', 'ist', 'ein', 'eine', 'mit', 'für', 'auf', 'von', 'sich', 'nicht', 'auch', 'sind'],
  it: ['il', 'la', 'i', 'le', 'di', 'che', 'un', 'una', 'per', 'con', 'sono', 'non', 'come', 'più', 'sul'],
  pt: ['o', 'a', 'os', 'as', 'de', 'que', 'um', 'uma', 'para', 'com', 'por', 'mas', 'como', 'não', 'são'],
};

const FAMILIES = Object.keys(STOPWORDS) as Array<Exclude<LanguageFamily, 'unknown'>>;

// Strip markdown / code / URLs / numbers to focus on prose words.
function extractWords(text: string): string[] {
  return text
    .toLowerCase()
    // remove fenced code blocks
    .replace(/```[\s\S]*?```/g, ' ')
    // remove inline code
    .replace(/`[^`]*`/g, ' ')
    // remove URLs
    .replace(/https?:\/\/\S+/g, ' ')
    // remove markdown punctuation
    .replace(/[#*_\[\]\(\)\{\}<>|]/g, ' ')
    // keep latin letters + the diacritics used by our 6 languages
    .replace(/[^a-záéíóúüñàèìòùâêîôûäöüßãõç']+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Returns the detected family, or 'unknown' if the text is too short or
// no family clearly wins. The 'unknown' result is treated as "trust the
// upstream prompt" by callers — we don't retry on uncertain detection.
export function detectLanguageFamily(text: string): LanguageFamily {
  const words = extractWords(text);
  if (words.length < 30) return 'unknown'; // too short to be reliable

  const scores: Record<string, number> = { en: 0, es: 0, fr: 0, de: 0, it: 0, pt: 0 };
  for (const w of words) {
    for (const family of FAMILIES) {
      if (STOPWORDS[family].includes(w)) scores[family]++;
    }
  }

  const sorted = FAMILIES
    .map((f) => ({ family: f, score: scores[f] }))
    .sort((a, b) => b.score - a.score);

  if (sorted[0].score === 0) return 'unknown';
  // Require a clear winner: top family must score at least 1.5x the runner-up
  // and at least 3 absolute hits. Otherwise the text is too mixed to call.
  if (sorted[0].score < 3) return 'unknown';
  if (sorted[0].score < sorted[1].score * 1.5) return 'unknown';
  return sorted[0].family;
}

// Map an OutputLanguageCode (variant-aware) to the broader family the
// detector reports. Variants of the same language share a family.
export function expectedFamily(code: OutputLanguageCode | string | undefined): LanguageFamily {
  if (!code || typeof code !== 'string') return 'en';
  if (code === 'en') return 'en';
  if (code.startsWith('es')) return 'es';
  if (code.startsWith('fr')) return 'fr';
  if (code.startsWith('de')) return 'de';
  if (code.startsWith('it')) return 'it';
  if (code.startsWith('pt')) return 'pt';
  return 'en';
}

const FAMILY_NAME: Record<Exclude<LanguageFamily, 'unknown'>, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
};

// Build the corrective user prompt for the retry-on-wrong-language case.
// `expectedLabel` is the human-readable target (e.g. "Brazilian Portuguese")
// from output-language.ts — pass it in so we keep the variant precision.
export function buildLanguageRetryPrompt(detected: LanguageFamily, expectedLabel: string): string {
  const detectedName = detected === 'unknown' ? 'another language' : FAMILY_NAME[detected];
  return [
    `Your previous response was in ${detectedName}, but the requested output language is ${expectedLabel}.`,
    `Rewrite your previous response ENTIRELY in ${expectedLabel}. Translate every sentence, heading, list item, table cell, and bullet point.`,
    'Preserve markdown structure, URLs, citations, code identifiers, schema.org property names, and quoted brand names exactly as they were. Translate only the prose around them.',
    `Do NOT mix languages. The entire response, except for the items listed above, must be in ${expectedLabel}.`,
  ].join('\n');
}

// Convenience: returns true if the output language matches what we asked
// for, OR if detection was uncertain (we don't penalize uncertainty).
export function languageMatches(text: string, code: OutputLanguageCode | string | undefined): boolean {
  const expected = expectedFamily(code);
  const detected = detectLanguageFamily(text);
  if (detected === 'unknown') return true;
  return detected === expected;
}
