// SEO title tag + meta description generation for a drafted post.
// Pure prompt-builder and parser so both are unit-testable; the LLM call
// lives in routes/content-writer.ts (handleGenerateSeoMeta).

export interface SeoMetaPromptInput {
  topic: string;
  targetKeyword: string;
  businessName: string;
  bodyMd: string;
}

const BODY_CHAR_BUDGET = 6000;

// The visible JSON reply is ~60 tokens, but reasoning models (DeepSeek V4
// Pro is the step default) spend hidden reasoning tokens out of the same
// max_tokens budget. 512 starved the call: content came back empty or cut
// off mid-object, parseSeoMetaResponse returned null, and every retry
// failed the same way ("could not parse title and meta").
export function resolveSeoMetaMaxTokens(model: string | null | undefined): number {
  const normalized = (model || '').toLowerCase();
  // GPT-5.5 Pro's reasoning is mandatory on OpenRouter and can be long even
  // for tiny outputs; mirrors the larger caps in resolvePostStepMaxTokens.
  if (normalized === 'openai/gpt-5.5-pro') return 8000;
  return 2048;
}

export function buildSeoMetaPrompt(input: SeoMetaPromptInput): { system: string; user: string } {
  const system = [
    'You write SEO metadata for blog posts.',
    'Return ONLY a JSON object, no prose, no code fence, exactly this shape:',
    '{"title": "...", "meta_description": "..."}',
    'Rules for title: maximum 60 characters, contains the target keyword near the front, states a concrete benefit, no clickbait, no pipe-brand suffix, no em dashes.',
    'Rules for meta_description: maximum 155 characters, contains the target keyword, starts with or contains an action verb, summarises the post honestly, no em dashes, no quotes inside the text.',
    'Write both in the same language as the post body.',
  ].join('\n');
  const body = input.bodyMd.length > BODY_CHAR_BUDGET
    ? `${input.bodyMd.slice(0, BODY_CHAR_BUDGET)}\n[truncated]`
    : input.bodyMd;
  const user = [
    `Business: ${input.businessName}`,
    `Topic: ${input.topic}`,
    `Target keyword: ${input.targetKeyword}`,
    '',
    'Post body (markdown):',
    body,
  ].join('\n');
  return { system, user };
}

export function parseSeoMetaResponse(text: string): { title: string; meta_description: string } | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { title?: unknown; meta_description?: unknown };
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const meta = typeof parsed.meta_description === 'string' ? parsed.meta_description.trim() : '';
    if (!title || !meta) return null;
    return {
      title: title.slice(0, 70),
      meta_description: meta.slice(0, 170),
    };
  } catch {
    return null;
  }
}
