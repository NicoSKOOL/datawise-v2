import type { Env } from '../index';
import type { ChatCompleteOptions, ChatCompleteResult, ChatMessage, LLMProvider, UserLLMConfig } from './provider';

export function escalateBudget(current: number, ceiling: number): number {
  return Math.min(current * 2, ceiling);
}

export interface LengthEscalationOpts {
  startTokens: number;
  ceilingTokens: number;
  // Route tag for the truncation log line, e.g. 'content-tools/analyze'.
  label: string;
  responseFormat?: 'json';
}

// Reasoning models (DeepSeek V4 Pro is the default across features) count
// hidden reasoning tokens against max_tokens even with reasoning excluded,
// and their reasoning length is bimodal: the long mode alone can consume a
// small budget and return zero visible content (finish_reason=length). This
// wrapper retries the SAME messages with a doubled budget on truncation.
// Re-asking with appended messages would only grow the input and hit the
// same wall. Usage is summed across attempts; the final (possibly still
// truncated) result is returned so callers keep their own error handling.
export async function chatCompleteEscalating(
  provider: LLMProvider,
  messages: ChatMessage[],
  env: Env,
  config: UserLLMConfig | undefined,
  opts: LengthEscalationOpts,
): Promise<ChatCompleteResult> {
  const callOpts: ChatCompleteOptions | undefined = opts.responseFormat ? { responseFormat: opts.responseFormat } : undefined;
  let maxTokens = opts.startTokens;
  let totalIn = 0;
  let totalOut = 0;
  for (let attempt = 1; ; attempt++) {
    const result = await provider.chatComplete(messages, env, config, maxTokens, callOpts);
    totalIn += result.usage.input_tokens;
    totalOut += result.usage.output_tokens;
    if (result.finishReason === 'length' && maxTokens < opts.ceilingTokens && attempt < 3) {
      console.warn(`[${opts.label}] output truncated at max_tokens=${maxTokens} model=${config?.model || 'default'}, retrying with escalated budget`);
      maxTokens = escalateBudget(maxTokens, opts.ceilingTokens);
      continue;
    }
    return { ...result, usage: { input_tokens: totalIn, output_tokens: totalOut } };
  }
}
