export const SEARCH_MODEL_ID = 'perplexity/sonar-pro';
export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4-pro';

export const OPENROUTER_PROVIDER_GROUPS = [
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'moonshotai', name: 'Moonshot AI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
] as const;

export type OpenRouterProviderId = typeof OPENROUTER_PROVIDER_GROUPS[number]['id'];

export const OPENROUTER_MODELS = [
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', tier: 'recommended', input: '$0.44', output: '$0.87', context: '1M', why: 'Default writer. Near-frontier quality at lower cost than premium closed models.' },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', tier: 'recommended', input: '$0.14', output: '$0.28', context: '1M', why: 'Speed pick. Faster and cheaper than V4 Pro, with slightly less depth on nuanced topics.' },
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', provider: 'moonshotai', tier: 'premium', input: '$0.74', output: '$4.66', context: '256K', why: 'Strong English prose among open models. Slower than DeepSeek in full writer tests.' },
  { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5', provider: 'moonshotai', tier: 'premium', input: 'varies', output: 'varies', context: '256K', why: 'Premium Moonshot fallback for long-form writing tests.' },
  { id: 'anthropic/claude-opus-4.7', name: 'Claude Opus 4.7', provider: 'anthropic', tier: 'premium', input: 'varies', output: 'varies', context: '1M', why: 'Premium Anthropic model for high-depth writing and review tests.' },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'anthropic', tier: 'premium', input: '$3.00', output: '$15.00', context: '1M', why: 'Best for nuanced SEO analysis and content strategy.' },
  { id: 'openai/gpt-5.5-pro', name: 'GPT-5.5 Pro', provider: 'openai', tier: 'premium', input: 'varies', output: 'varies', context: '128K+', why: 'Premium OpenAI model. Passes with a larger output budget but is slower and costlier.' },
  { id: 'openai/gpt-5.5', name: 'GPT-5.5', provider: 'openai', tier: 'premium', input: 'varies', output: 'varies', context: '128K+', why: 'OpenAI general-purpose writing model for the curated test set.' },
  { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openai', tier: 'budget', input: 'varies', output: 'varies', context: '128K+', why: 'Lower-cost OpenAI option for outline, draft, and review tests.' },
] as const;

export type OpenRouterModelId = typeof OPENROUTER_MODELS[number]['id'];

export const OPENROUTER_MODEL_IDS = OPENROUTER_MODELS.map((model) => model.id);

export function isApprovedOpenRouterModel(model: string | null | undefined): model is OpenRouterModelId {
  return !!model && OPENROUTER_MODEL_IDS.includes(model as OpenRouterModelId);
}

export function modelDisplayName(modelId: string | null | undefined): string {
  if (!modelId) return 'Unknown model';
  if (modelId === SEARCH_MODEL_ID) return 'Perplexity Sonar Pro';
  const approved = OPENROUTER_MODELS.find((model) => model.id === modelId);
  if (approved) return approved.name;
  const tail = modelId.split('/').slice(-1)[0] || modelId;
  return tail
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
