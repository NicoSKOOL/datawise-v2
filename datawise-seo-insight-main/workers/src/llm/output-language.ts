export type OutputLanguageCode = 'en' | 'es-419' | 'es-ES' | 'fr-FR' | 'de-DE' | 'it-IT' | 'pt-PT' | 'pt-BR';

export type ContentOutputRegister = 'professional' | 'conversational' | 'informal';
export type ContentOutputLength = 'standard' | 'expanded' | 'comprehensive';
export type ContentOutputSourcePolicy =
  | 'credible-non-competitor'
  | 'primary-only'
  | 'broad-reputable';

export interface ContentOutputControls {
  language: OutputLanguageCode;
  register: ContentOutputRegister;
  length: ContentOutputLength;
  source_policy: ContentOutputSourcePolicy;
  include_tldr: boolean;
  include_tables: boolean;
  include_faq: boolean;
  include_meta: boolean;
}

export const DEFAULT_CONTENT_OUTPUT_CONTROLS: ContentOutputControls = {
  language: 'en',
  register: 'professional',
  length: 'expanded',
  source_policy: 'credible-non-competitor',
  include_tldr: false,
  include_tables: true,
  include_faq: true,
  include_meta: false,
};

const OUTPUT_LANGUAGE_CODES = new Set<OutputLanguageCode>(['en', 'es-419', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT', 'pt-BR']);
const REGISTER_VALUES = new Set<ContentOutputRegister>(['professional', 'conversational', 'informal']);
const LENGTH_VALUES = new Set<ContentOutputLength>(['standard', 'expanded', 'comprehensive']);
const SOURCE_POLICY_VALUES = new Set<ContentOutputSourcePolicy>(['credible-non-competitor', 'primary-only', 'broad-reputable']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeOutputLanguage(value: unknown): OutputLanguageCode {
  return typeof value === 'string' && OUTPUT_LANGUAGE_CODES.has(value as OutputLanguageCode)
    ? value as OutputLanguageCode
    : 'en';
}

export function normalizeContentOutputControls(
  value: unknown,
  fallbackLanguage: unknown = 'en',
): ContentOutputControls {
  const fallback = normalizeOutputLanguage(fallbackLanguage);
  const defaults: ContentOutputControls = {
    ...DEFAULT_CONTENT_OUTPUT_CONTROLS,
    language: fallback,
  };

  if (typeof value === 'string') {
    return {
      ...defaults,
      language: normalizeOutputLanguage(value),
    };
  }

  if (!isRecord(value)) return defaults;

  const language = normalizeOutputLanguage(value.language ?? fallback);
  const register = typeof value.register === 'string' && REGISTER_VALUES.has(value.register as ContentOutputRegister)
    ? value.register as ContentOutputRegister
    : defaults.register;
  const length = typeof value.length === 'string' && LENGTH_VALUES.has(value.length as ContentOutputLength)
    ? value.length as ContentOutputLength
    : defaults.length;
  const sourcePolicy = typeof value.source_policy === 'string' && SOURCE_POLICY_VALUES.has(value.source_policy as ContentOutputSourcePolicy)
    ? value.source_policy as ContentOutputSourcePolicy
    : defaults.source_policy;

  return {
    language,
    register,
    length,
    source_policy: sourcePolicy,
    include_tldr: normalizeBoolean(value.include_tldr, defaults.include_tldr),
    include_tables: normalizeBoolean(value.include_tables, defaults.include_tables),
    include_faq: normalizeBoolean(value.include_faq, defaults.include_faq),
    include_meta: normalizeBoolean(value.include_meta, defaults.include_meta),
  };
}

function languageName(code: OutputLanguageCode): string {
  switch (code) {
    case 'es-419':
      return 'neutral Latin American Spanish';
    case 'es-ES':
      return 'Spain Spanish';
    case 'fr-FR':
      return 'France French';
    case 'de-DE':
      return 'Germany German';
    case 'it-IT':
      return 'Italy Italian';
    case 'pt-PT':
      return 'European Portuguese (Portugal)';
    case 'pt-BR':
      return 'Brazilian Portuguese';
    case 'en':
    default:
      return 'English';
  }
}

function languageVariantRule(code: OutputLanguageCode): string {
  switch (code) {
    case 'es-419':
      return '- Use neutral Latin American Spanish. Avoid Spain-specific vocabulary, phrasing, and vosotros forms. Use ustedes for plural address. Avoid voseo unless a future country-specific control explicitly asks for it.';
    case 'es-ES':
      return '- Use natural Spanish as written for Spain. Spain-specific vocabulary is allowed where appropriate. Use vosotros only when the selected register and audience make it natural.';
    case 'fr-FR':
      return '- Use France French. Default to vous in professional and conversational business contexts. Avoid English-style Title Case; use French capitalization norms for headings and titles.';
    case 'de-DE':
      return '- Use Germany German. Preserve German noun capitalization. In professional register, use the formal Sie/Ihr forms with correct capitalization.';
    case 'it-IT':
      return '- Use Italy Italian. Default to Lei in professional and conversational business contexts; use tu only when the register is explicitly informal. Avoid English-style title case in headings; use Italian sentence-case capitalization.';
    case 'pt-PT':
      return '- Use European Portuguese (Portugal). Prefer "a" + infinitive over "-ndo" gerund constructions (e.g. "a fazer", not "fazendo"). Use você or formal third-person address in professional registers. Avoid Brazilian-specific vocabulary and Brazilian gerund usage. Apply Portugal spelling conventions where they still differ post-1990 orthographic agreement.';
    case 'pt-BR':
      return '- Use Brazilian Portuguese. Use você by default; gerund constructions ("-ndo") are natural and preferred. Avoid Portugal-specific vocabulary and Portugal-specific spellings where they differ from Brazilian usage.';
    case 'en':
    default:
      return '- Use natural English.';
  }
}

function registerRule(register: ContentOutputRegister): string {
  switch (register) {
    case 'informal':
      return '- Register: informal. Use casual direct address when natural for the selected language, without becoming sloppy or unserious.';
    case 'conversational':
      return '- Register: conversational. Use approachable, plain-language phrasing while keeping professional credibility.';
    case 'professional':
    default:
      return '- Register: professional. Use formal or business-appropriate address forms for the selected language, such as usted, vous, or Sie where relevant.';
  }
}

function lengthRule(length: ContentOutputLength): string {
  switch (length) {
    case 'standard':
      return '- Length: standard. Keep prose concise but complete. For full article rewrites, target roughly 900-1,200 words unless the prompt requires more.';
    case 'comprehensive':
      return '- Length: comprehensive. Add stronger depth, examples, and supporting detail. For full article rewrites, target roughly 1,600+ words when source material supports it.';
    case 'expanded':
    default:
      return '- Length: expanded. Provide enough depth for SEO usefulness. For full article rewrites, target roughly 1,200-1,600 words when source material supports it.';
  }
}

function sourcePolicyRule(policy: ContentOutputSourcePolicy): string {
  switch (policy) {
    case 'primary-only':
      return '- Source policy: cite primary sources where possible: official documentation, government sources, academic research, original data, or company-owned pages. Avoid secondary summaries unless no primary source is available.';
    case 'broad-reputable':
      return '- Source policy: use reputable sources including official sources, research, major publications, and trusted industry blogs. Avoid weak aggregators and low-quality affiliate pages.';
    case 'credible-non-competitor':
    default:
      return '- Source policy: prefer official, government, academic, original research, and reputable industry sources. Avoid external links to direct competitors; use competitor pages only as private research context if unavoidable.';
  }
}

function featureRules(controls: ContentOutputControls, preserveJsonShape?: boolean): string[] {
  return [
    controls.include_tldr
      ? '- TL;DR: include a short direct-answer summary near the top for long-form markdown outputs. For fixed JSON responses, use an existing suitable user-facing field only if one exists.'
      : '- TL;DR: do not add a TL;DR block unless the tool prompt explicitly requires one.',
    controls.include_tables
      ? '- Tables: include markdown tables where they improve comparisons, examples, pricing, steps, or local proof. Do not force a table when prose is clearer.'
      : '- Tables: avoid markdown tables unless the tool prompt explicitly requires a table.',
    controls.include_faq
      ? '- FAQ: include FAQ content when the tool supports it.'
      : preserveJsonShape
        ? '- FAQ: suppress FAQ content. If the required JSON shape includes an FAQ array, return an empty array.'
        : '- FAQ: do not add an FAQ section unless the tool prompt explicitly requires one.',
    controls.include_meta
      ? '- Meta: generate meta title and meta description suggestions when the API response supports metadata.'
      : preserveJsonShape
        ? '- Meta: do not add optional meta suggestions beyond the required JSON shape.'
        : '- Meta: do not embed meta title or meta description text inside the markdown body.',
  ];
}

export function getOutputLanguageInstruction(
  value: unknown,
  options: { preserveJsonShape?: boolean } = {},
): string {
  const language = normalizeOutputLanguage(value);
  const target = languageName(language);
  const shapeRule = options.preserveJsonShape
    ? '- Keep JSON keys, enum values, field names, markdown syntax, URLs, and schema.org property names exactly as requested. Translate only user-facing string values.'
    : '- Preserve markdown syntax, URLs, citations, code identifiers, and schema.org property names. Translate only prose shown to the user.';

  return [
    `OUTPUT LANGUAGE: Write all user-facing output in ${target}.`,
    languageVariantRule(language),
    shapeRule,
  ].join('\n');
}

export function getContentOutputInstruction(
  value: unknown,
  options: { preserveJsonShape?: boolean; fallbackLanguage?: unknown } = {},
): string {
  const controls = normalizeContentOutputControls(value, options.fallbackLanguage);
  const shapeRule = options.preserveJsonShape
    ? '- Keep JSON keys, enum values, field names, markdown syntax, URLs, and schema.org property names exactly as requested. Translate only user-facing string values.'
    : '- Preserve markdown syntax, URLs, citations, code identifiers, and schema.org property names. Translate only prose shown to the user.';

  return [
    'CONTENT OUTPUT CONTROLS: These settings override conflicting brief text for language, register, length, source selection, and optional content blocks.',
    `- Language: write all user-facing output in ${languageName(controls.language)}.`,
    languageVariantRule(controls.language),
    registerRule(controls.register),
    lengthRule(controls.length),
    sourcePolicyRule(controls.source_policy),
    ...featureRules(controls, options.preserveJsonShape),
    '- SEO locale note: es-419 is only an internal content-generation locale. Do not output es-419 as an hreflang value; future hreflang should use concrete country tags.',
    shapeRule,
  ].join('\n');
}

export function getChatOutputLanguageInstruction(value: unknown): string {
  const language = normalizeOutputLanguage(value);
  const target = languageName(language);

  return [
    `OUTPUT LANGUAGE: Answer in ${target} unless the latest user message explicitly requests another language.`,
    languageVariantRule(language),
    '- Preserve GSC query text, URLs, brand names, numbers, table structure, and metric names when translating would reduce clarity.',
  ].join('\n');
}
