import type { Env } from '../index';
import { getLLMProvider, type UserLLMConfig, type ChatMessage } from '../llm/provider';
import { validateOpenRouterKey } from '../llm/openrouter-key';
import {
  META_REWRITE_SYSTEM_PROMPT,
  buildUserPrompt,
  buildLengthRetryPrompt,
  TITLE_MIN, TITLE_MAX, META_MIN, META_MAX,
  type IssueType, type PageContext,
} from '../llm/prompts/meta-rewrite';
import { fetchPageContext } from './meta-checker';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

interface RewriteRequestBody {
  url?: string;
  current_title?: string | null;
  current_description?: string | null;
  issue_type?: IssueType;
  target_keyword?: string;
  context?: PageContext;
  llm_config?: UserLLMConfig;
}

interface LLMResponseShape {
  title?: unknown;
  description?: unknown;
  target_keyword?: unknown;
  reasoning?: unknown;
}

const VALID_ISSUES: IssueType[] = [
  'missing_title', 'long_title', 'short_title', 'duplicate_title',
  'missing_desc', 'long_desc', 'short_desc',
];

const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','to','for','on','in','at','by','with',
  'is','are','be','from','as','this','that','it','your','our','you','we',
  'how','why','what','when','where','best','top','vs','our',
]);

function inferKeywordFromContext(h1: string | null | undefined, fallbackTitle: string | null | undefined): string {
  const source = (h1 || fallbackTitle || '').toLowerCase();
  if (!source) return '';
  // Take the first 4 non-stopword tokens.
  const tokens = source
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
  return tokens.slice(0, 4).join(' ').trim();
}

function brandFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const root = host.split('.').slice(-2, -1)[0] || host;
    return root.charAt(0).toUpperCase() + root.slice(1);
  } catch {
    return '';
  }
}

function stripCodeFences(text: string): string {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.includes('\n') ? t.split('\n').slice(1).join('\n') : t.slice(3);
    if (t.endsWith('```')) t = t.slice(0, -3);
  }
  return t.trim();
}

// Some models occasionally produce near-JSON: JS-style // line comments,
// /* block */ comments, trailing commas before } or ]. JSON.parse rejects
// all of these. Strip them as a fallback before retrying parse.
function relaxJsonSyntax(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')          // /* block comments */
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')    // // line comments (not URLs)
    .replace(/,\s*([}\]])/g, '$1');             // trailing commas
}

// Some models wrap the answer: {"result": {...}}, {"data": {...}},
// {"response": {...}}. Unwrap one level if the wrapper has exactly one
// object-valued key and the inner object has the fields we need.
function unwrapNestedObject(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  const o = obj as Record<string, unknown>;
  if (typeof o.title === 'string' || typeof o.description === 'string') return o;
  for (const key of ['result', 'data', 'response', 'output']) {
    const inner = o[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const innerObj = inner as Record<string, unknown>;
      if (typeof innerObj.title === 'string' || typeof innerObj.description === 'string') {
        return innerObj;
      }
    }
  }
  return obj;
}

function tryExtractJson(raw: string): LLMResponseShape | null {
  const cleaned = stripCodeFences(raw);
  const attempts: string[] = [cleaned];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) attempts.push(cleaned.slice(start, end + 1));
  attempts.push(relaxJsonSyntax(cleaned));
  if (start >= 0 && end > start) attempts.push(relaxJsonSyntax(cleaned.slice(start, end + 1)));

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      const unwrapped = unwrapNestedObject(parsed);
      if (unwrapped && typeof unwrapped === 'object') {
        return unwrapped as LLMResponseShape;
      }
    } catch { /* try next */ }
  }
  return null;
}

interface LengthCheck { ok: boolean; problems: string[] }

function checkLengths(title: string, description: string): LengthCheck {
  const problems: string[] = [];
  const tlen = [...title].length;
  const dlen = [...description].length;
  if (tlen < TITLE_MIN) problems.push(`Title too short: ${tlen} chars (min ${TITLE_MIN}).`);
  if (tlen > TITLE_MAX) problems.push(`Title too long: ${tlen} chars (max ${TITLE_MAX}).`);
  if (dlen < META_MIN) problems.push(`Description too short: ${dlen} chars (min ${META_MIN}).`);
  if (dlen > META_MAX) problems.push(`Description too long: ${dlen} chars (max ${META_MAX}).`);
  return { ok: problems.length === 0, problems };
}

export async function handleMetaRewrite(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as RewriteRequestBody;

  if (typeof body.url !== 'string' || !body.url.trim()) {
    return json({ error: 'url is required' }, 400);
  }
  if (!body.issue_type || !VALID_ISSUES.includes(body.issue_type)) {
    return json({ error: 'issue_type is invalid' }, 400);
  }
  if (!body.llm_config?.api_key) {
    return json({ error: 'llm_config.api_key is required' }, 400);
  }
  if (body.llm_config.provider === 'openrouter') {
    const keyCheck = await validateOpenRouterKey(body.llm_config.api_key, env);
    if (!keyCheck.ok && keyCheck.reason === 'management') return json({ error: keyCheck.message }, 400);
    // NOTE: must NOT be 401. The SPA's api.ts treats every non-/auth 401 as
    // session-expired and force-logs the user out (bug 7b7e46d1). A bad
    // OpenRouter key is a user-input error, not an auth-session error.
    if (!keyCheck.ok && keyCheck.reason === 'invalid')    return json({ error: keyCheck.message }, 400);
  }

  // 1. Resolve page context: prefer pre-supplied (Site Audit), fetch otherwise.
  let context: PageContext;
  let fetchedTitle: string | null = null;
  let fetchedDesc: string | null = null;
  if (body.context && (body.context.h1 || body.context.body_excerpt || (body.context.h2s && body.context.h2s.length))) {
    context = {
      h1: body.context.h1,
      h2s: body.context.h2s,
      body_excerpt: body.context.body_excerpt,
      keywords: body.context.keywords,
    };
  } else {
    const fetched = await fetchPageContext(body.url);
    if (!fetched.ok) {
      return json({ error: `Could not fetch page: ${fetched.error || 'unknown error'}` }, 502);
    }
    context = {
      h1: fetched.h1 || undefined,
      h2s: fetched.h2s,
      body_excerpt: fetched.body_excerpt,
      keywords: fetched.keywords || undefined,
    };
    fetchedTitle = fetched.title;
    fetchedDesc = fetched.description;
  }

  const currentTitle = body.current_title ?? fetchedTitle ?? null;
  const currentDesc = body.current_description ?? fetchedDesc ?? null;

  // 2. Resolve target keyword.
  const userKeyword = (body.target_keyword || '').trim();
  const targetKeyword = userKeyword || inferKeywordFromContext(context.h1, currentTitle) || brandFromUrl(body.url).toLowerCase();
  const userOverrode = !!userKeyword;

  // 3. Build messages.
  const userPrompt = buildUserPrompt({
    url: body.url,
    brand: brandFromUrl(body.url),
    current_title: currentTitle,
    current_description: currentDesc,
    issue_type: body.issue_type,
    context,
    target_keyword: targetKeyword,
    user_overrode_keyword: userOverrode,
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: META_REWRITE_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const provider = getLLMProvider(env, body.llm_config);

  // 4. Call LLM with up to 2 length-retry rounds (3 attempts total).
  let attempt = 0;
  let parsed: LLMResponseShape | null = null;
  let title = '';
  let description = '';
  let echoedKeyword = targetKeyword;
  let reasoning = '';
  let lengthWarning = false;
  let totalInput = 0;
  let totalOutput = 0;

  while (attempt < 3) {
    attempt++;
    let result;
    try {
      result = await provider.chatComplete(messages, env, body.llm_config, 1200, { responseFormat: 'json' });
    } catch (err) {
      return json({ error: `LLM error: ${err instanceof Error ? err.message : 'Unknown error'}` }, 502);
    }
    totalInput += result.usage.input_tokens;
    totalOutput += result.usage.output_tokens;

    parsed = tryExtractJson(result.text);
    const validShape = !!(parsed && typeof parsed.title === 'string' && typeof parsed.description === 'string');
    console.log(`[meta-rewrite] attempt=${attempt} model=${body.llm_config?.model || 'default'} finish=${result.finishReason || 'unknown'} parsedOk=${validShape} outputTokens=${result.usage.output_tokens}`);

    if (!validShape || !parsed) {
      // Truncation is a different failure than a malformed reply — surface it
      // distinctly so the user knows to retry rather than thinking the LLM
      // misbehaved.
      if (result.finishReason === 'length' && attempt >= 2) {
        return json({
          error: 'The model output was cut off before it finished writing the JSON. Try again, or pick a model with a higher token budget in Settings.',
          raw: result.text.slice(0, 500),
        }, 502);
      }
      // Single re-ask with stricter wording, then bail.
      if (attempt >= 2) {
        return json({ error: 'LLM did not return valid JSON', raw: result.text.slice(0, 500) }, 502);
      }
      messages.push({ role: 'assistant', content: result.text });
      messages.push({
        role: 'user',
        content: 'That was not valid JSON. Reply with ONLY a single JSON object with keys title, description, target_keyword, reasoning. No code fences. No prose.',
      });
      continue;
    }

    title = (parsed.title as string).trim();
    description = (parsed.description as string).trim();
    echoedKeyword = typeof parsed.target_keyword === 'string' && parsed.target_keyword.trim()
      ? (parsed.target_keyword as string).trim()
      : targetKeyword;
    reasoning = typeof parsed.reasoning === 'string' ? (parsed.reasoning as string).trim() : '';

    const check = checkLengths(title, description);
    if (check.ok) break;

    if (attempt >= 3) {
      lengthWarning = true;
      break;
    }
    // Targeted retry: feed previous JSON + length problems.
    messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
    messages.push({ role: 'user', content: buildLengthRetryPrompt(title, description, check.problems) });
  }

  return json({
    title,
    title_length: [...title].length,
    description,
    description_length: [...description].length,
    target_keyword: echoedKeyword,
    reasoning,
    length_warning: lengthWarning || undefined,
    usage: { input_tokens: totalInput, output_tokens: totalOutput },
  });
}
