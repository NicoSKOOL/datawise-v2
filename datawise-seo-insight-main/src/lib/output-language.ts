export type OutputLanguageCode = 'en' | 'es-419' | 'es-ES' | 'fr-FR' | 'de-DE' | 'it-IT' | 'pt-PT' | 'pt-BR';

export type ContentOutputRegister = 'professional' | 'conversational' | 'informal';
export type ContentOutputLength = 'standard' | 'expanded' | 'comprehensive';
export type ContentOutputSourcePolicy =
  | 'credible-non-competitor'
  | 'primary-only'
  | 'broad-reputable';

export interface OutputLanguageOption {
  value: OutputLanguageCode;
  label: string;
  description: string;
}

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

export interface ContentOutputOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

export const OUTPUT_LANGUAGE_STORAGE_KEY = 'datawise_output_language';
export const CONTENT_OUTPUT_CONTROLS_STORAGE_KEY = 'datawise_content_output_controls_v1';

export const outputLanguageOptions: OutputLanguageOption[] = [
  { value: 'en',     label: 'English',                description: '' },
  { value: 'es-ES',  label: 'Spanish (Spain)',        description: '' },
  { value: 'es-419', label: 'Spanish (Latin America)', description: '' },
  { value: 'fr-FR',  label: 'French',                 description: '' },
  { value: 'de-DE',  label: 'German',                 description: '' },
  { value: 'it-IT',  label: 'Italian',                description: '' },
  { value: 'pt-PT',  label: 'Portuguese (Portugal)',  description: '' },
  { value: 'pt-BR',  label: 'Portuguese (Brazil)',    description: '' },
];

export const contentOutputRegisterOptions: Array<ContentOutputOption<ContentOutputRegister>> = [
  {
    value: 'professional',
    label: 'Professional',
    description: 'Formal, direct, and suitable for business content.',
  },
  {
    value: 'conversational',
    label: 'Conversational',
    description: 'Approachable and plain-spoken without sounding casual.',
  },
  {
    value: 'informal',
    label: 'Informal',
    description: 'Casual and direct for consumer-friendly content.',
  },
];

export const contentOutputLengthOptions: Array<ContentOutputOption<ContentOutputLength>> = [
  {
    value: 'standard',
    label: 'Standard',
    description: 'Concise but complete.',
  },
  {
    value: 'expanded',
    label: 'Expanded',
    description: 'More depth for stronger SEO coverage.',
  },
  {
    value: 'comprehensive',
    label: 'Comprehensive',
    description: 'Long-form coverage with examples and supporting detail.',
  },
];

export const contentOutputSourcePolicyOptions: Array<ContentOutputOption<ContentOutputSourcePolicy>> = [
  {
    value: 'credible-non-competitor',
    label: 'Credible non-competitor',
    description: 'Prefer official and reputable sources while avoiding direct competitors.',
  },
  {
    value: 'primary-only',
    label: 'Primary only',
    description: 'Use official, government, academic, or original research sources where possible.',
  },
  {
    value: 'broad-reputable',
    label: 'Broad reputable',
    description: 'Allow reputable publishers and industry blogs when they help the answer.',
  },
];

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

const outputLanguageValues = new Set<OutputLanguageCode>(
  outputLanguageOptions.map((option) => option.value),
);

const registerValues = new Set<ContentOutputRegister>(
  contentOutputRegisterOptions.map((option) => option.value),
);

const lengthValues = new Set<ContentOutputLength>(
  contentOutputLengthOptions.map((option) => option.value),
);

const sourcePolicyValues = new Set<ContentOutputSourcePolicy>(
  contentOutputSourcePolicyOptions.map((option) => option.value),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function isOutputLanguageCode(value: unknown): value is OutputLanguageCode {
  return typeof value === 'string' && outputLanguageValues.has(value as OutputLanguageCode);
}

export function normalizeOutputLanguage(value: unknown): OutputLanguageCode {
  return isOutputLanguageCode(value) ? value : 'en';
}

export function normalizeContentOutputControls(
  value: unknown,
  fallbackLanguage: OutputLanguageCode = 'en',
): ContentOutputControls {
  const defaults: ContentOutputControls = {
    ...DEFAULT_CONTENT_OUTPUT_CONTROLS,
    language: fallbackLanguage,
  };

  if (typeof value === 'string') {
    return {
      ...defaults,
      language: normalizeOutputLanguage(value),
    };
  }

  if (!isRecord(value)) return defaults;

  const language = normalizeOutputLanguage(value.language ?? fallbackLanguage);
  const register = typeof value.register === 'string' && registerValues.has(value.register as ContentOutputRegister)
    ? value.register as ContentOutputRegister
    : defaults.register;
  const length = typeof value.length === 'string' && lengthValues.has(value.length as ContentOutputLength)
    ? value.length as ContentOutputLength
    : defaults.length;
  const sourcePolicy = typeof value.source_policy === 'string' && sourcePolicyValues.has(value.source_policy as ContentOutputSourcePolicy)
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

export function getOutputLanguagePreference(): OutputLanguageCode {
  if (typeof window === 'undefined') return 'en';
  return normalizeOutputLanguage(window.localStorage.getItem(OUTPUT_LANGUAGE_STORAGE_KEY));
}

export function saveOutputLanguagePreference(value: OutputLanguageCode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OUTPUT_LANGUAGE_STORAGE_KEY, value);
}

export function getContentOutputControlsPreference(): ContentOutputControls {
  if (typeof window === 'undefined') return DEFAULT_CONTENT_OUTPUT_CONTROLS;
  const legacyLanguage = getOutputLanguagePreference();
  const stored = window.localStorage.getItem(CONTENT_OUTPUT_CONTROLS_STORAGE_KEY);

  if (!stored) {
    return {
      ...DEFAULT_CONTENT_OUTPUT_CONTROLS,
      language: legacyLanguage,
    };
  }

  try {
    return normalizeContentOutputControls(JSON.parse(stored), legacyLanguage);
  } catch {
    return {
      ...DEFAULT_CONTENT_OUTPUT_CONTROLS,
      language: legacyLanguage,
    };
  }
}

export function saveContentOutputControlsPreference(value: ContentOutputControls): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeContentOutputControls(value, getOutputLanguagePreference());
  window.localStorage.setItem(CONTENT_OUTPUT_CONTROLS_STORAGE_KEY, JSON.stringify(normalized));
  saveOutputLanguagePreference(normalized.language);
}

export function getOutputLanguageLabel(value: OutputLanguageCode): string {
  return outputLanguageOptions.find((option) => option.value === value)?.label || 'English';
}

export function getContentOutputSummary(value: ContentOutputControls): string {
  const language = getOutputLanguageLabel(value.language);
  const register = contentOutputRegisterOptions.find((option) => option.value === value.register)?.label || 'Professional';
  const length = contentOutputLengthOptions.find((option) => option.value === value.length)?.label || 'Expanded';
  return `${language} · ${register} · ${length}`;
}
