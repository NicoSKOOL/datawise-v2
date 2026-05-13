import type { StoredLLMConfig } from './chat';

export type ContentWriterLLMSetupCode =
  | 'OPENROUTER_KEY_REQUIRED'
  | 'OPENROUTER_PROVIDER_REQUIRED'
  | 'OPENROUTER_INVALID_KEY'
  | 'OPENROUTER_RATE_LIMITED'
  | 'OPENROUTER_MODEL_UNAVAILABLE'
  | 'OPENROUTER_UPSTREAM_ERROR';

export interface ContentWriterLLMSetupError {
  code: ContentWriterLLMSetupCode;
  title: string;
  description: string;
}

const SETUP_ERRORS: Record<ContentWriterLLMSetupCode, ContentWriterLLMSetupError> = {
  OPENROUTER_KEY_REQUIRED: {
    code: 'OPENROUTER_KEY_REQUIRED',
    title: 'OpenRouter key required',
    description: 'Add an OpenRouter API key in Settings before starting the Experience Notes interview.',
  },
  OPENROUTER_PROVIDER_REQUIRED: {
    code: 'OPENROUTER_PROVIDER_REQUIRED',
    title: 'OpenRouter must be selected',
    description: 'Content Writer interviews require OpenRouter. Select OpenRouter in Settings, then retry.',
  },
  OPENROUTER_INVALID_KEY: {
    code: 'OPENROUTER_INVALID_KEY',
    title: 'Invalid OpenRouter key',
    description: 'The saved OpenRouter key was rejected. Update it in Settings, then retry.',
  },
  OPENROUTER_RATE_LIMITED: {
    code: 'OPENROUTER_RATE_LIMITED',
    title: 'OpenRouter rate limit hit',
    description: 'OpenRouter is rate limiting requests. Wait a moment, then retry the interview.',
  },
  OPENROUTER_MODEL_UNAVAILABLE: {
    code: 'OPENROUTER_MODEL_UNAVAILABLE',
    title: 'OpenRouter model unavailable',
    description: 'The selected OpenRouter model is unavailable. Choose another model in Settings, then retry.',
  },
  OPENROUTER_UPSTREAM_ERROR: {
    code: 'OPENROUTER_UPSTREAM_ERROR',
    title: 'OpenRouter request failed',
    description: 'OpenRouter returned an unexpected error. Check Settings, then retry.',
  },
};

export function getContentWriterLLMSetupError(
  config: StoredLLMConfig | null,
): ContentWriterLLMSetupError | null {
  if (!config || !config.api_key?.trim()) return SETUP_ERRORS.OPENROUTER_KEY_REQUIRED;
  if (config.provider !== 'openrouter') return SETUP_ERRORS.OPENROUTER_PROVIDER_REQUIRED;
  return null;
}

export function contentWriterApiErrorToSetupError(error: unknown): ContentWriterLLMSetupError | null {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/OpenRouter API key required/i.test(message)) return SETUP_ERRORS.OPENROUTER_KEY_REQUIRED;
  if (/OpenRouter must be selected/i.test(message)) return SETUP_ERRORS.OPENROUTER_PROVIDER_REQUIRED;
  if (/Invalid OpenRouter API key/i.test(message)) return SETUP_ERRORS.OPENROUTER_INVALID_KEY;
  if (/OpenRouter rate limit/i.test(message)) return SETUP_ERRORS.OPENROUTER_RATE_LIMITED;
  if (/OpenRouter model unavailable/i.test(message)) return SETUP_ERRORS.OPENROUTER_MODEL_UNAVAILABLE;
  return null;
}
