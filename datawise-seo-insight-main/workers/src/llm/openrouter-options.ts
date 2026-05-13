export interface OpenRouterReasoningConfig {
  effort: 'minimal' | 'none';
  exclude: true;
}

export function getOpenRouterReasoningConfig(model: string | null | undefined): OpenRouterReasoningConfig | undefined {
  const normalized = (model || '').toLowerCase();
  if (!normalized || normalized.startsWith('perplexity/')) return undefined;
  if (normalized.startsWith('moonshotai/kimi-k2')) {
    return { effort: 'none', exclude: true };
  }
  if (normalized.startsWith('openai/gpt-5') || normalized.startsWith('deepseek/deepseek-v4')) {
    return { effort: 'minimal', exclude: true };
  }
  return undefined;
}

export function extractOpenRouterMessageText(message: unknown): string {
  const msg = message as {
    content?: unknown;
    text?: unknown;
    output_text?: unknown;
  } | null | undefined;
  const content = msg?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof msg?.text === 'string') return msg.text;
  if (typeof msg?.output_text === 'string') return msg.output_text;
  return '';
}
