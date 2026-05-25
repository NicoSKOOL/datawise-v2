import type { Env } from '../index';
import { getLLMProvider, type ChatMessage, type UserLLMConfig } from '../llm/provider';
import { validateOpenRouterKey } from '../llm/openrouter-key';
import {
  getContentOutputInstruction,
  getContentOutputUserReminder,
  getControlsLanguageLabel,
} from '../llm/output-language';
import {
  detectLanguageFamily,
  expectedFamily,
  buildLanguageRetryPrompt,
} from '../llm/language-detect';
import {
  DOC_TYPES, DOC_LABELS, INTERVIEW_PROMPTS, FINALIZE_PROMPTS,
  AUTO_DRAFT_DOC_TYPES, KB_AUTO_DRAFT_PROMPTS, WEBSITE_PAGES_DISCOVERY_PROMPT,
  buildPostStepSystemPrompt, buildPostStepUserMessage, withScrapedPagesContext,
  type AutoDraftDocType, type DocType, type PostStep, type KBContext,
} from '../content-writer/prompts';
import {
  finalizePromptKey,
  interviewPromptKey,
  loadPromptConfigs,
  postStepPromptKeys,
  resolvePromptFromMap,
} from '../content-writer/prompt-registry';
import { repairWriterOutputIfNeeded } from '../content-writer/quality';
import { buildWriterPromptContext, renderPromptTemplate, type WriterPromptContext } from '../content-writer/prompt-template';
import { buildPostStepPersistenceUpdate, pruneDownstreamStepUsage } from '../content-writer/post-step-persistence';
import { extractNeverCiteTerms, filterExcludedSources } from '../content-writer/source-filter';
import {
  extractInternalLinks,
  extractPageEvidence,
  extractSitemapIndexUrls,
  candidateFromUrl,
  formatWebsitePagesDocument,
  inferSiteArchetype,
  normalizeWebsiteUrl,
  parseSitemapUrls,
  rankAndFilterPages,
  selectBalancedWebsitePages,
  type SiteArchetype,
  type WebsitePageCandidate,
} from '../content-writer/page-discovery';
import { fetchAndParseHtml } from '../site-audit/html-parser';
import { dataforseoRequestCached, extractResult } from '../dataforseo/client';
import { safeFetch, UnsafeUrlError } from '../lib/safe-fetch';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function isDocType(v: unknown): v is DocType {
  return typeof v === 'string' && (DOC_TYPES as string[]).includes(v);
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function stripWrappingCodeFence(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)\n```$/);
  return m ? m[1].trim() : s;
}

// Belt-and-braces cleanup for content the LLM was told NOT to produce.
// The draft prompt forbids em dashes, en dashes, and horizontal rules, but
// models slip up; better to strip these before persisting than to make the
// user fix them. We deliberately avoid touching content inside fenced code
// blocks so legitimate uses (regex literals, docs that quote a dash) stay
// intact.
function stripBannedTypography(s: string): string {
  if (!s) return s;
  const fenceRe = /```[\s\S]*?```/g;
  const fences: string[] = [];
  // Pull fenced code blocks out, replace with sentinels, transform, restore.
  const stripped = s.replace(fenceRe, (m) => {
    fences.push(m);
    return `__FENCE_${fences.length - 1}__`;
  });
  const cleaned = stripped
    // Drop any line whose entire content is a horizontal rule (---, ***, ___).
    .replace(/^[ \t]*(?:[-*_]){3,}[ \t]*$\n?/gm, '')
    // Replace em dashes used as a clause break with a comma.
    // " word — word " or "word—word" → "word, word".
    .replace(/\s*[—]\s*/g, ', ')
    // Replace en dashes in the same way (they're banned too).
    .replace(/\s*[–]\s*/g, ', ');
  return cleaned.replace(/__FENCE_(\d+)__/g, (_m, i) => fences[Number(i)]);
}

// Default model per pipeline step. Research uses a search-grounded model
// (Perplexity Sonar Pro returns real citations); writing steps use a cheap
// open writer (DeepSeek V4 Pro). Both routed through OpenRouter — keeps the
// provider surface to one and the API key to OPENROUTER_API_KEY.
const STEP_MODEL_DEFAULTS: Record<PostStep, { provider: NonNullable<UserLLMConfig['provider']>; model: string }> = {
  research: { provider: 'openrouter', model: 'perplexity/sonar-pro' },
  outline:  { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
  draft:    { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
  review:   { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
};

// Resolve the LLM config to use for a given step. Content Writer is
// OpenRouter-only: research is locked to Sonar Pro because it needs grounded
// citations, while non-search writing steps may use the user's curated
// OpenRouter model choice. api_key is left unset only for local/dev fallback.
function resolveStepLLMConfig(step: PostStep, userConfig: UserLLMConfig | undefined, _env: Env): UserLLMConfig {
  const defaults = STEP_MODEL_DEFAULTS[step];
  const model = step === 'research'
    ? defaults.model
    : userConfig?.model || defaults.model;
  return {
    provider: defaults.provider,
    model,
    api_key: userConfig?.api_key,
  };
}

function resolveContentWriterLLMConfig(userConfig: UserLLMConfig | undefined, model = STEP_MODEL_DEFAULTS.draft.model): UserLLMConfig {
  return {
    provider: 'openrouter',
    model: userConfig?.model || model,
    api_key: userConfig?.api_key,
  };
}

function resolvePostStepMaxTokens(step: PostStep, model: string | null | undefined): number {
  const normalizedModel = (model || '').toLowerCase();
  if (normalizedModel === 'openai/gpt-5.5-pro') {
    // GPT-5.5 Pro requires mandatory reasoning on OpenRouter. With the normal
    // 4096-token outline cap it can spend the full budget on reasoning and
    // return no visible content, so only this model gets a larger cap.
    if (step === 'outline' || step === 'review') return 12000;
    if (step === 'draft') return 16000;
  }
  if (step === 'draft') return 16384;
  if (step === 'review') return 8192;
  return 4096;
}

function userOpenRouterKeyRequired(env: Env, userConfig: UserLLMConfig | undefined): Response | null {
  if (env.ENVIRONMENT !== 'production') return null;
  if (userConfig?.provider === 'openrouter' && userConfig.api_key) return null;
  return json({ error: 'OpenRouter API key required. Add your key in Settings.' }, 400);
}

interface AiQuestionContext {
  source: 'chatgpt_fanout' | 'people_also_ask' | 'none';
  seed: string;
  questions: string[];
}

function normalizeResearchSeed(brief: { topic?: string; target_keyword?: string }): string {
  return String(brief.target_keyword || brief.topic || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function dedupeQuestions(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim().replace(/\s+/g, ' ');
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchChatGptFanoutQuestions(env: Env, seed: string): Promise<string[]> {
  if (seed.length < 3) return [];

  const data = await dataforseoRequestCached(
    env,
    '/ai_optimization/llm_mentions/search/live',
    [{
      target: [{ keyword: seed, match_type: 'partial_match' }],
      platform: 'chat_gpt',
      location_code: 2840,
      language_code: 'en',
      limit: 100,
    }],
    { ttlSeconds: 21600 }
  );

  const result = extractResult(data);
  const rows: Array<{ question?: string; fan_out_queries?: string[] }> = result?.items || [];
  const fanout: string[] = [];
  const questions: string[] = [];

  for (const row of rows) {
    for (const query of row.fan_out_queries || []) fanout.push(query);
    if (row.question) questions.push(row.question);
  }

  return dedupeQuestions(fanout.length > 0 ? fanout : questions, 12);
}

async function fetchFallbackPaaQuestions(env: Env, seed: string): Promise<string[]> {
  if (seed.length < 3) return [];

  const data = await dataforseoRequestCached(
    env,
    '/serp/google/organic/live/advanced',
    [{
      keyword: `${seed} questions`,
      location_code: 2840,
      language_code: 'en',
      device: 'desktop',
      os: 'windows',
    }],
    { ttlSeconds: 21600 }
  );

  const result = (data as any)?.tasks?.[0]?.result?.[0];
  const items = result?.items || [];
  const questions: string[] = [];

  for (const item of items) {
    if (item.type === 'people_also_ask') {
      for (const q of item.items || []) {
        if (q.title) questions.push(q.title);
      }
    }
    if (item.type === 'related_searches') {
      for (const q of item.items || []) {
        if (q.title) questions.push(q.title);
      }
    }
  }

  return dedupeQuestions(questions, 8);
}

async function buildAiQuestionContext(env: Env, brief: { topic?: string; target_keyword?: string }): Promise<AiQuestionContext> {
  const seed = normalizeResearchSeed(brief);
  if (!seed) return { source: 'none', seed: '', questions: [] };

  try {
    const fanout = await fetchChatGptFanoutQuestions(env, seed);
    if (fanout.length > 0) return { source: 'chatgpt_fanout', seed, questions: fanout };
  } catch (err) {
    console.warn('[content-writer] ChatGPT fan-out research failed:', err);
  }

  try {
    const paa = await fetchFallbackPaaQuestions(env, seed);
    if (paa.length > 0) return { source: 'people_also_ask', seed, questions: paa };
  } catch (err) {
    console.warn('[content-writer] PAA fallback research failed:', err);
  }

  return { source: 'none', seed, questions: [] };
}

function formatAiQuestionContext(ctx: AiQuestionContext | undefined): string {
  if (!ctx || ctx.questions.length === 0) return '';
  const label = ctx.source === 'chatgpt_fanout'
    ? 'ChatGPT fan-out queries from DataForSEO (US + English index)'
    : 'People Also Ask fallback questions';
  return [
    `AI search questions to answer (${label}, seed: "${ctx.seed}")`,
    ...ctx.questions.map((q) => `- ${q}`),
  ].join('\n');
}

async function safeLoadPromptConfigs(env: Env) {
  try {
    return await loadPromptConfigs(env.DB);
  } catch (err) {
    console.warn('[content-writer] prompt config load failed; using code defaults:', err);
    return new Map();
  }
}


interface WorkspaceRow {
  id: string;
  user_id: string;
  property_id: string | null;
  name: string;
  website_url: string | null;
  created_at: string;
  updated_at: string;
}

interface KBDocRow {
  id: string;
  workspace_id: string;
  doc_type: DocType;
  status: 'empty' | 'in_progress' | 'ready';
  content: string | null;
  conversation_id: string | null;
  updated_at: string;
}

interface PostRow {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string | null;
  topic: string | null;
  target_keyword: string | null;
  status: 'draft' | 'researched' | 'outlined' | 'written';
  brief_json: string | null;
  sources_json: string | null;
  outline_json: string | null;
  body_html: string | null;
  body_md: string | null;
  usage_json: string | null;
  created_at: string;
  updated_at: string;
}

async function getWorkspaceForUser(env: Env, userId: string, workspaceId: string): Promise<WorkspaceRow | null> {
  return env.DB.prepare(
    'SELECT * FROM content_writer_workspaces WHERE id = ? AND user_id = ?'
  ).bind(workspaceId, userId).first<WorkspaceRow>();
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export async function handleListWorkspaces(env: Env, userId: string): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT w.*, p.site_url as property_url
     FROM content_writer_workspaces w
     LEFT JOIN gsc_properties p ON w.property_id = p.id
     WHERE w.user_id = ?
     ORDER BY w.updated_at DESC`
  ).bind(userId).all();
  return json({ workspaces: rows.results || [] });
}

export async function handleCreateWorkspace(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json() as { name?: string; website_url?: string; property_id?: string };
  const name = body.name?.trim();
  if (!name) return json({ error: 'name required' }, 400);

  // If property_id provided, verify ownership and pull website_url default
  let propertyId: string | null = body.property_id || null;
  let websiteUrl = body.website_url?.trim() || '';
  if (propertyId) {
    const prop = await env.DB.prepare(
      'SELECT id, site_url FROM gsc_properties WHERE id = ? AND user_id = ?'
    ).bind(propertyId, userId).first<{ id: string; site_url: string }>();
    if (!prop) return json({ error: 'property not found' }, 404);
    if (!websiteUrl) {
      // sc-domain:example.com -> https://example.com
      websiteUrl = prop.site_url.startsWith('sc-domain:')
        ? `https://${prop.site_url.replace(/^sc-domain:/, '')}`
        : prop.site_url;
    }
  }

  const id = newId();
  await env.DB.prepare(
    `INSERT INTO content_writer_workspaces (id, user_id, property_id, name, website_url)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, userId, propertyId, name, websiteUrl || null).run();

  // Seed empty KB doc rows so the UI has something to render
  for (const docType of DOC_TYPES) {
    await env.DB.prepare(
      `INSERT INTO content_writer_kb_docs (id, workspace_id, doc_type, status)
       VALUES (?, ?, ?, 'empty')`
    ).bind(newId(), id, docType).run();
  }

  return json({ workspace: { id, user_id: userId, property_id: propertyId, name, website_url: websiteUrl || null } });
}

// POST /api/content-writer/workspaces/resolve { property_id }
// Returns the workspace bound to the given property, creating one on the
// fly if none exists. Implements migration A: if the user has exactly one
// dangling workspace (property_id IS NULL) and that's their only workspace,
// the dangling one is auto-bound to this property instead of creating a
// new empty workspace alongside it. This makes the post-refactor data
// model (1 workspace ↔ 1 property) self-healing on first access.
export async function handleResolveWorkspace(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { property_id?: string };
  const propertyId = body.property_id?.trim();
  if (!propertyId) return json({ error: 'property_id required' }, 400);

  // Verify property ownership and get its site_url for naming.
  const prop = await env.DB.prepare(
    'SELECT id, site_url FROM gsc_properties WHERE id = ? AND user_id = ?'
  ).bind(propertyId, userId).first<{ id: string; site_url: string }>();
  if (!prop) return json({ error: 'property not found' }, 404);

  // Already-bound workspace: just return it.
  const bound = await env.DB.prepare(
    `SELECT * FROM content_writer_workspaces WHERE user_id = ? AND property_id = ?`
  ).bind(userId, propertyId).first();
  if (bound) return json({ workspace: bound });

  // Migration A: if user has exactly one dangling workspace and no other
  // workspaces, adopt it instead of creating a sibling.
  const all = await env.DB.prepare(
    `SELECT id, property_id FROM content_writer_workspaces WHERE user_id = ?`
  ).bind(userId).all<{ id: string; property_id: string | null }>();
  const dangling = (all.results || []).filter((w) => !w.property_id);
  if (dangling.length === 1 && (all.results || []).length === 1) {
    const websiteUrl = prop.site_url.startsWith('sc-domain:')
      ? `https://${prop.site_url.replace(/^sc-domain:/, '')}`
      : prop.site_url;
    await env.DB.prepare(
      `UPDATE content_writer_workspaces
       SET property_id = ?, website_url = COALESCE(website_url, ?), updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).bind(propertyId, websiteUrl, dangling[0].id, userId).run();
    const adopted = await env.DB.prepare(
      `SELECT * FROM content_writer_workspaces WHERE id = ?`
    ).bind(dangling[0].id).first();
    return json({ workspace: adopted, migrated: true });
  }

  // Otherwise create a fresh workspace bound to this property.
  const websiteUrl = prop.site_url.startsWith('sc-domain:')
    ? `https://${prop.site_url.replace(/^sc-domain:/, '')}`
    : prop.site_url;
  const cleanDomain = websiteUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO content_writer_workspaces (id, user_id, property_id, name, website_url)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, userId, propertyId, cleanDomain, websiteUrl).run();
  for (const docType of DOC_TYPES) {
    await env.DB.prepare(
      `INSERT INTO content_writer_kb_docs (id, workspace_id, doc_type, status)
       VALUES (?, ?, ?, 'empty')`
    ).bind(newId(), id, docType).run();
  }
  return json({
    workspace: { id, user_id: userId, property_id: propertyId, name: cleanDomain, website_url: websiteUrl },
    created: true,
  });
}

export async function handleGetWorkspace(env: Env, userId: string, workspaceId: string): Promise<Response> {
  const ws = await getWorkspaceForUser(env, userId, workspaceId);
  if (!ws) return json({ error: 'not found' }, 404);

  const docs = await env.DB.prepare(
    `SELECT id, doc_type, status, conversation_id, updated_at,
            CASE WHEN content IS NULL OR content = '' THEN 0 ELSE LENGTH(content) END as content_length
     FROM content_writer_kb_docs WHERE workspace_id = ?`
  ).bind(workspaceId).all();

  const posts = await env.DB.prepare(
    `SELECT id, title, topic, target_keyword, status, updated_at
     FROM content_writer_posts WHERE workspace_id = ? ORDER BY updated_at DESC`
  ).bind(workspaceId).all();

  return json({
    workspace: ws,
    kb_docs: docs.results || [],
    posts: posts.results || [],
  });
}

export async function handleDeleteWorkspace(env: Env, userId: string, workspaceId: string): Promise<Response> {
  const ws = await getWorkspaceForUser(env, userId, workspaceId);
  if (!ws) return json({ error: 'not found' }, 404);
  await env.DB.prepare('DELETE FROM content_writer_kb_docs WHERE workspace_id = ?').bind(workspaceId).run();
  await env.DB.prepare('DELETE FROM content_writer_posts WHERE workspace_id = ?').bind(workspaceId).run();
  await env.DB.prepare('DELETE FROM content_writer_workspaces WHERE id = ?').bind(workspaceId).run();
  return json({ success: true });
}

// ---------------------------------------------------------------------------
// KB docs
// ---------------------------------------------------------------------------

async function loadKBDoc(env: Env, workspaceId: string, docType: DocType): Promise<KBDocRow | null> {
  return env.DB.prepare(
    `SELECT * FROM content_writer_kb_docs WHERE workspace_id = ? AND doc_type = ?`
  ).bind(workspaceId, docType).first<KBDocRow>();
}

async function loadReadyKBContext(env: Env, workspaceId: string): Promise<KBContext> {
  const rows = await env.DB.prepare(
    `SELECT doc_type, content FROM content_writer_kb_docs WHERE workspace_id = ? AND status = 'ready'`
  ).bind(workspaceId).all<{ doc_type: DocType; content: string }>();
  const kb: KBContext = {};
  for (const row of rows.results || []) kb[row.doc_type] = row.content;
  return kb;
}

export async function handleGetKBDoc(
  env: Env, userId: string, workspaceId: string, docType: string,
): Promise<Response> {
  if (!isDocType(docType)) return json({ error: 'invalid doc_type' }, 400);
  const ws = await getWorkspaceForUser(env, userId, workspaceId);
  if (!ws) return json({ error: 'workspace not found' }, 404);

  const doc = await loadKBDoc(env, workspaceId, docType);
  let messages: { role: string; content: string; created_at: string }[] = [];
  if (doc?.conversation_id) {
    const msgs = await env.DB.prepare(
      `SELECT role, content, created_at FROM chat_messages
       WHERE conversation_id = ? ORDER BY created_at ASC`
    ).bind(doc.conversation_id).all();
    messages = (msgs.results || []) as typeof messages;
  }
  return json({ doc, messages });
}

export async function handleUpdateKBDoc(
  request: Request, env: Env, userId: string, workspaceId: string, docType: string,
): Promise<Response> {
  if (!isDocType(docType)) return json({ error: 'invalid doc_type' }, 400);
  const ws = await getWorkspaceForUser(env, userId, workspaceId);
  if (!ws) return json({ error: 'workspace not found' }, 404);

  const body = await request.json() as { content?: string; status?: KBDocRow['status'] };
  if (typeof body.content !== 'string' && !body.status) {
    return json({ error: 'content or status required' }, 400);
  }

  // Make sure a row exists (CRUD-safe even if seeding was skipped)
  const existing = await loadKBDoc(env, workspaceId, docType);
  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO content_writer_kb_docs (id, workspace_id, doc_type, status, content, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      newId(), workspaceId, docType,
      body.status || (body.content ? 'ready' : 'empty'),
      body.content ?? null,
    ).run();
  } else {
    const newStatus = body.status || (body.content && body.content.trim() ? 'ready' : existing.status);
    await env.DB.prepare(
      `UPDATE content_writer_kb_docs SET content = ?, status = ?, updated_at = datetime('now')
       WHERE workspace_id = ? AND doc_type = ?`
    ).bind(
      body.content !== undefined ? body.content : existing.content,
      newStatus, workspaceId, docType,
    ).run();
  }
  await env.DB.prepare(
    `UPDATE content_writer_workspaces SET updated_at = datetime('now') WHERE id = ?`
  ).bind(workspaceId).run();
  return json({ success: true });
}

// Pre-fetched site context for sitemap interview (best-effort, never throws).
async function buildScrapedPagesContext(websiteUrl: string | null): Promise<string | null> {
  if (!websiteUrl) return null;
  try {
    const parsed = await fetchAndParseHtml(websiteUrl);
    if (!parsed) return null;
    const lines: string[] = [];
    lines.push(`Homepage URL: ${websiteUrl}`);
    if (parsed.title) lines.push(`Homepage <title>: ${parsed.title}`);
    if (parsed.meta_description) lines.push(`Homepage meta description: ${parsed.meta_description}`);
    if (parsed.h1.length) lines.push(`H1s: ${parsed.h1.slice(0, 3).join(' | ')}`);
    if (parsed.h2.length) lines.push(`Sample H2s: ${parsed.h2.slice(0, 8).join(' | ')}`);
    return lines.join('\n');
  } catch {
    return null;
  }
}

function contextValue(context: WriterPromptContext, key: string): string {
  if (context.fallbackKeys.includes(key)) return '';
  return context.values[key] || '';
}

function appendExperienceInterviewContext(
  systemPrompt: string,
  promptContext: WriterPromptContext,
  readyKb: KBContext,
): string {
  const contextLines = [
    ['Business', contextValue(promptContext, 'business_name')],
    ['Website', contextValue(promptContext, 'website_url')],
    ['Domain', contextValue(promptContext, 'domain')],
    ['Business type', contextValue(promptContext, 'business_type')],
    ['Industry', contextValue(promptContext, 'industry')],
    ['Service area', contextValue(promptContext, 'service_area')],
    ['Known offers', contextValue(promptContext, 'primary_services')],
    ['Offer facts', contextValue(promptContext, 'service_facts')],
    ['Tone summary', contextValue(promptContext, 'tone_summary')],
    ['Brand rules', contextValue(promptContext, 'brand_rules')],
    ['Credentials already known', contextValue(promptContext, 'credentials')],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`)
    .join('\n');

  const upstreamDocs: DocType[] = ['sitemap', 'tone_of_voice', 'service_details', 'brand_guidelines'];
  const readyDocs = upstreamDocs.filter((type) => !!readyKb[type]?.trim()).map((type) => DOC_LABELS[type]);
  const missingDocs = upstreamDocs.filter((type) => !readyKb[type]?.trim()).map((type) => DOC_LABELS[type]);

  return `${systemPrompt}

KNOWN BUSINESS CONTEXT FOR THIS EXPERIENCE NOTES INTERVIEW:
${contextLines || '- No saved business context is ready yet.'}

Ready supporting documents: ${readyDocs.length ? readyDocs.join(', ') : 'none'}.
Missing supporting documents: ${missingDocs.length ? missingDocs.join(', ') : 'none'}.

IMPORTANT:
- Use the known context before asking questions. If the business name, website, offer list, industry, or service area is already known, do not ask the user to repeat it.
- If useful context is missing, ask only the smallest clarifying question needed; do not restart the Website Pages, Tone of Voice, Offer Details, or Brand Guidelines interviews.
- Start the Experience Notes interview by briefly confirming what you already understand, then ask whether the user is an experienced operator or early-stage.
- Focus the interview on firsthand expertise, stories, opinions, credentials, customer situations, and examples the website cannot reliably provide.`;
}

const DISCOVERY_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; DataWiseBot/1.0; +https://www.datawiseseo.com)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchTextForDiscovery(url: string, maxBytes = 2 * 1024 * 1024, timeoutMs = 8_000): Promise<string | null> {
  try {
    const resp = await safeFetch(url, {
      headers: DISCOVERY_FETCH_HEADERS,
      maxBytes,
      timeoutMs,
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch (err) {
    if (err instanceof UnsafeUrlError) return null;
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  let nextIndex = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

async function discoverSitemapCandidates(websiteUrl: string): Promise<{ pages: WebsitePageCandidate[]; sitemapUrls: string[] }> {
  const base = normalizeWebsiteUrl(websiteUrl);
  if (!base) return { pages: [], sitemapUrls: [] };
  const sitemapUrls: string[] = [];
  const robots = await fetchTextForDiscovery(`${base}/robots.txt`, 512 * 1024);
  if (robots) {
    for (const line of robots.split('\n')) {
      if (!line.toLowerCase().startsWith('sitemap:')) continue;
      const declared = line.split(':').slice(1).join(':').trim();
      if (declared) sitemapUrls.push(declared);
    }
  }
  sitemapUrls.push(
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap-index.xml`,
    `${base}/wp-sitemap.xml`,
  );

  const unique = [...new Set(sitemapUrls)];
  const pages: WebsitePageCandidate[] = [];
  const usedSitemaps: string[] = [];

  const sitemapFetches = await mapWithConcurrency(unique.slice(0, 10), 4, async (sitemapUrl) => ({
    sitemapUrl,
    xml: await fetchTextForDiscovery(sitemapUrl, 2 * 1024 * 1024, 5_000),
  }));

  for (const { sitemapUrl, xml } of sitemapFetches) {
    if (!xml) continue;
    usedSitemaps.push(sitemapUrl);
    if (xml.includes('<sitemapindex') || xml.includes(':sitemapindex')) {
      const childUrls = extractSitemapIndexUrls(xml).slice(0, 10);
      const childXmls = await mapWithConcurrency(childUrls, 4, (childUrl) => fetchTextForDiscovery(childUrl, 2 * 1024 * 1024, 5_000));
      for (const childXml of childXmls) if (childXml) pages.push(...parseSitemapUrls(childXml, 'sitemap'));
    } else {
      pages.push(...parseSitemapUrls(xml, 'sitemap'));
    }
    if (pages.length >= 80) break;
  }

  return { pages: rankAndFilterPages(pages, base, 180), sitemapUrls: usedSitemaps };
}

async function discoverHomepageCandidates(websiteUrl: string): Promise<{ pages: WebsitePageCandidate[]; homepageHtml: string | null }> {
  const html = await fetchTextForDiscovery(websiteUrl);
  if (!html) return { pages: [], homepageHtml: null };
  const homepage = extractPageEvidence(websiteUrl, html, 'homepage_link');
  const links = extractInternalLinks(websiteUrl, html, 'homepage_link');
  return { pages: [homepage, ...links], homepageHtml: html };
}

interface DiscoveryOptions {
  reviewLimit?: number;
  blogLimit?: number;
  enrichLimit?: number;
  enrichConcurrency?: number;
  enrichTimeoutMs?: number;
  evidenceCharLimit?: number;
}

async function enrichPageCandidates(candidates: WebsitePageCandidate[], options: DiscoveryOptions = {}): Promise<WebsitePageCandidate[]> {
  const selected = candidates.slice(0, options.enrichLimit ?? 30);

  async function enrichOne(page: WebsitePageCandidate): Promise<WebsitePageCandidate> {
    const html = await fetchTextForDiscovery(page.url, 768 * 1024, options.enrichTimeoutMs ?? 6_000);
    if (!html) return page;
    try {
      return {
        ...page,
        ...extractPageEvidence(page.url, html, page.source),
        page_type: page.page_type,
        link_worthy: page.link_worthy,
        source: page.source,
        confidence: page.confidence,
      };
    } catch {
      return page;
    }
  }

  const enriched = await mapWithConcurrency(selected, options.enrichConcurrency ?? 5, enrichOne);
  return enriched.filter(Boolean);
}

function candidateUrlKey(raw: string): string {
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/$/, '');
  }
}

function mergeEnrichedCandidates(
  candidates: WebsitePageCandidate[],
  enriched: WebsitePageCandidate[],
): WebsitePageCandidate[] {
  const byUrl = new Map(enriched.map((page) => [candidateUrlKey(page.url), page]));
  return candidates.map((page) => byUrl.get(candidateUrlKey(page.url)) || page);
}

function formatWebsitePageEvidence(candidates: WebsitePageCandidate[]): string {
  return candidates.map((page, index) => [
    `PAGE ${index + 1}`,
    `URL: ${page.url}`,
    `Current type: ${page.page_type}`,
    `Source: ${page.source}; confidence: ${page.confidence}`,
    `Title: ${page.title || ''}`,
    `Meta description: ${page.meta_description || ''}`,
    `H1: ${(page.h1 || []).join(' | ')}`,
    `H2 sample: ${(page.h2 || []).slice(0, 5).join(' | ')}`,
    `Snippet: ${page.snippet || page.description || ''}`,
  ].join('\n')).join('\n\n');
}

interface WebsiteDiscoveryResult {
  websiteUrl: string;
  candidates: WebsitePageCandidate[];
  evidenceText: string;
  metadata: {
    website_url: string;
    deterministic_candidate_count: number;
    final_candidate_count: number;
    sitemap_urls: string[];
    homepage_links_found: number;
    sonar_fallback_used: boolean;
    crawler: string;
    search_model: string | null;
    llm_skipped_reason?: string | null;
    discovery_duration_ms?: number;
    site_archetype: SiteArchetype;
    ranking_summary?: Record<string, number>;
    saved: false;
  };
  canUseLLM: boolean;
}

async function buildWebsiteDiscoveryResult(
  env: Env,
  websiteUrl: string,
  llmConfig?: UserLLMConfig,
  options: DiscoveryOptions = {},
): Promise<WebsiteDiscoveryResult> {
  const startedAt = Date.now();
  const [sitemapResult, homepageResult] = await Promise.all([
    discoverSitemapCandidates(websiteUrl),
    discoverHomepageCandidates(websiteUrl),
  ]);
  const canUseLLM = env.ENVIRONMENT !== 'production' || (llmConfig?.provider === 'openrouter' && !!llmConfig.api_key);

  const rawCandidates = [
    ...sitemapResult.pages,
    ...homepageResult.pages,
  ];
  const siteArchetype = inferSiteArchetype(rawCandidates);
  const reviewLimit = options.reviewLimit ?? 40;
  const blogLimit = options.blogLimit;

  let candidates = selectBalancedWebsitePages(rawCandidates, websiteUrl, {
    siteArchetype,
    reviewLimit,
    blogLimit,
  });

  let sonarFallbackUsed = false;
  if (candidates.length < 3 && canUseLLM) {
    const fallback = await discoverSonarFallbackCandidates(env, websiteUrl, llmConfig);
    if (fallback.length) {
      sonarFallbackUsed = true;
      candidates = selectBalancedWebsitePages([...rawCandidates, ...fallback], websiteUrl, {
        siteArchetype,
        reviewLimit,
        blogLimit,
      });
    }
  }

  const enriched = await enrichPageCandidates(candidates, {
    enrichLimit: options.enrichLimit ?? 28,
    enrichConcurrency: options.enrichConcurrency ?? 5,
    enrichTimeoutMs: options.enrichTimeoutMs ?? 6_000,
  });
  candidates = mergeEnrichedCandidates(candidates, enriched).map((page) => ({
    ...page,
    description: page.description || page.meta_description || page.snippet || page.title || 'Important site page.',
  }));

  const evidenceText = formatWebsitePageEvidence(candidates).slice(0, options.evidenceCharLimit ?? 35_000);
  return {
    websiteUrl,
    candidates,
    evidenceText,
    canUseLLM,
    metadata: {
      website_url: websiteUrl,
      deterministic_candidate_count: sitemapResult.pages.length + homepageResult.pages.length,
      final_candidate_count: candidates.length,
      sitemap_urls: sitemapResult.sitemapUrls,
      homepage_links_found: homepageResult.pages.length,
      sonar_fallback_used: sonarFallbackUsed,
      crawler: 'robots+sitemap+homepage-links',
      search_model: sonarFallbackUsed ? 'perplexity/sonar-pro' : null,
      llm_skipped_reason: canUseLLM ? null : 'OpenRouter API key required for Sonar fallback and DeepSeek summarization in production.',
      discovery_duration_ms: Date.now() - startedAt,
      site_archetype: siteArchetype,
      ranking_summary: summarizePageTypes(candidates),
      saved: false,
    },
  };
}

function summarizePageTypes(candidates: WebsitePageCandidate[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const page of candidates) summary[page.page_type] = (summary[page.page_type] || 0) + 1;
  return summary;
}

async function discoverSonarFallbackCandidates(env: Env, websiteUrl: string, llmConfig?: UserLLMConfig): Promise<WebsitePageCandidate[]> {
  const domain = new URL(websiteUrl).hostname.replace(/^www\./, '');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'Find the most important public pages on a business website. Return only URLs, one per line. Prioritize homepage, services, locations, SaaS feature pages, products, product categories, pricing, tools, comparisons, about, contact, and pillar resources. Exclude legal, cart, checkout, login, tag, author, archive, and asset URLs.',
    },
    {
      role: 'user',
      content: `Find important pages for site:${domain}. Return 20 to 40 URLs from https://${domain}.`,
    },
  ];
  try {
    const provider = getLLMProvider(env, {
      provider: 'openrouter',
      api_key: llmConfig?.api_key,
      model: 'perplexity/sonar-pro',
    });
    const res = await provider.chatComplete(messages, env, {
      provider: 'openrouter',
      api_key: llmConfig?.api_key,
      model: 'perplexity/sonar-pro',
    }, 2048);
    const urls = new Set<string>();
    for (const match of res.text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) urls.add(match[0].replace(/[.,;]+$/, ''));
    for (const citation of res.citations || []) urls.add(citation.url);
    return [...urls]
      .map((url) => candidateFromUrl(url, 'sonar_fallback'))
      .filter((page): page is WebsitePageCandidate => !!page)
      .map((page) => ({ ...page, confidence: 'low' }));
  } catch (err) {
    console.warn('[content-writer] website page Sonar fallback failed:', err);
    return [];
  }
}

async function summarizeWebsitePagesDocument(env: Env, candidates: WebsitePageCandidate[], llmConfig?: UserLLMConfig): Promise<string | null> {
  if (!candidates.length) return null;
  const evidence = formatWebsitePageEvidence(candidates).slice(0, 30_000);
  const prompt = renderPromptTemplate(
    WEBSITE_PAGES_DISCOVERY_PROMPT,
    buildWriterPromptContext({ metadata: { website_pages_evidence: evidence } }),
  ).text;
  const config: UserLLMConfig = {
    provider: 'openrouter',
    api_key: llmConfig?.api_key,
    model: 'deepseek/deepseek-v4-pro',
  };
  try {
    const provider = getLLMProvider(env, config);
    const res = await provider.chatComplete([
      { role: 'system', content: 'You produce precise Website Pages knowledge-base documents from crawled page evidence.' },
      { role: 'user', content: prompt },
    ], env, config, 4096);
    const text = stripWrappingCodeFence(res.text).trim();
    return text.includes('URL:') && text.includes('Page type:') ? text : null;
  } catch (err) {
    console.warn('[content-writer] website page summarizer failed:', err);
    return null;
  }
}

function autoDraftPromptKey(docType: AutoDraftDocType): string {
  return docType === 'sitemap' ? 'discovery.sitemap.user' : `auto_draft.${docType}.user`;
}

function autoDraftLabel(docType: AutoDraftDocType): string {
  return DOC_LABELS[docType];
}

function sourceUrlsForAutoDraft(docType: AutoDraftDocType, candidates: WebsitePageCandidate[]): string[] {
  const offerPageTypes = [
    'Home',
    'Service',
    'Service+Location',
    'Location',
    'Feature',
    'Product',
    'Product Category',
    'Pricing',
    'Tool',
    'Comparison',
    'Case Study',
    'About',
    'Contact',
  ];
  const preferred = docType === 'tone_of_voice'
    ? candidates
    : docType === 'service_details'
      ? candidates.filter((page) => offerPageTypes.includes(page.page_type))
      : docType === 'brand_guidelines'
        ? candidates.filter((page) => ['Home', 'About', 'Service', 'Contact'].includes(page.page_type))
        : candidates;
  return (preferred.length ? preferred : candidates).slice(0, 12).map((page) => page.url);
}

function autoDraftWarnings(docType: AutoDraftDocType, candidates: WebsitePageCandidate[], usedLLM: boolean): string[] {
  const warnings: string[] = [];
  if (!usedLLM && docType !== 'sitemap') warnings.push('Generated from deterministic crawl fallback only; review carefully.');
  if (candidates.length < 3) warnings.push('Limited page evidence found; this draft may be incomplete.');
  if (docType === 'service_details') {
    warnings.push('Pricing, licensing, guarantees, availability, and inclusions must be reviewed before use.');
  }
  if (docType === 'brand_guidelines') {
    warnings.push('Competitor exclusions and regulated-claim rules need business confirmation.');
  }
  if (docType === 'tone_of_voice') {
    warnings.push('Tone is inferred from website copy only; owned writing samples are still better.');
  }
  return warnings;
}

function fallbackAutoDraftDocument(docType: AutoDraftDocType, candidates: WebsitePageCandidate[]): string {
  if (docType === 'sitemap') return formatWebsitePagesDocument(candidates);
  const urls = sourceUrlsForAutoDraft(docType, candidates).map((url) => `- ${url}`).join('\n') || '- No source pages found.';
  if (docType === 'tone_of_voice') {
    return [
      '1. ONE-LINE SUMMARY',
      'NEEDS CONFIRMATION: Not enough model-generated evidence was available to summarize the business voice.',
      '',
      '2. PERSONALITY TRAITS',
      '- NEEDS CONFIRMATION',
      '',
      '3. SENTENCE PATTERNS',
      '- NEEDS CONFIRMATION',
      '',
      '4. VOCABULARY',
      '- NEEDS CONFIRMATION',
      '',
      '5. RHYTHM AND PACING',
      '- NEEDS CONFIRMATION',
      '',
      '6. POINT OF VIEW',
      '- NEEDS CONFIRMATION',
      '',
      '7. THINGS TO AVOID',
      '- No em dashes.',
      '',
      '8. EXAMPLE PARAGRAPH',
      'NEEDS CONFIRMATION',
      '',
      'Source pages reviewed:',
      urls,
    ].join('\n');
  }
  if (docType === 'service_details') {
    return [
      'BUSINESS OVERVIEW',
      'NEEDS CONFIRMATION',
      '',
      'OFFER LIST',
      ...candidates.filter((page) => [
        'Service',
        'Service+Location',
        'Location',
        'Feature',
        'Product',
        'Product Category',
        'Pricing',
        'Tool',
        'Comparison',
      ].includes(page.page_type)).slice(0, 12).map((page) => `- ${page.title}: ${page.url}`),
      '',
      'OFFER DETAILS',
      'NEEDS CONFIRMATION: Review each service, feature, product, plan, or tool for inclusions, exclusions, availability, timeline, and scope.',
      '',
      'PRICING AND QUOTES',
      'NEEDS CONFIRMATION: Do not publish pricing unless confirmed by the business.',
      '',
      'SERVICE AREA',
      'NEEDS CONFIRMATION',
      '',
      'CREDENTIALS AND TRUST SIGNALS',
      'NEEDS CONFIRMATION',
      '',
      'CUSTOMER PROCESS',
      'NEEDS CONFIRMATION',
      '',
      'COMMON QUESTIONS',
      'NEEDS CONFIRMATION',
      '',
      'NEEDS CONFIRMATION',
      '- Pricing, licenses, guarantees, service inclusions, exclusions, and timelines.',
      '',
      'Source pages reviewed:',
      urls,
    ].join('\n');
  }
  return [
    'BUSINESS NAME AND SPELLING',
    'NEEDS CONFIRMATION',
    '',
    'PRONOUN AND POINT OF VIEW POLICY',
    'NEEDS CONFIRMATION',
    '',
    'FORMATTING RULES',
    '- No em dashes.',
    '',
    'BANNED WORDS AND PHRASES',
    '- No "let\'s dive in".',
    '- No "as an AI language model".',
    '- No unsupported superlatives.',
    '',
    'CLAIMS THE WRITER MUST NOT MAKE',
    '- NEEDS CONFIRMATION: regulated, legal, medical, financial, guarantee, and certification claims.',
    '',
    'CLAIMS THAT APPEAR SAFE TO MAKE',
    'NEEDS CONFIRMATION',
    '',
    'COMPETITOR AND SOURCE HANDLING',
    'NEEDS CONFIRMATION',
    '',
    'TONE GUARDRAILS',
    'NEEDS CONFIRMATION',
    '',
    'NEEDS CONFIRMATION',
    '- Exact business name, banned competitors, regulated claims, formatting preferences.',
    '',
    'Source pages reviewed:',
    urls,
  ].join('\n');
}

async function summarizeAutoDraftDocument(
  env: Env,
  docType: AutoDraftDocType,
  promptText: string,
  evidenceText: string,
  candidates: WebsitePageCandidate[],
  llmConfig?: UserLLMConfig,
  siteArchetype?: SiteArchetype,
): Promise<{ content: string; usedLLM: boolean }> {
  if (!evidenceText.trim()) {
    return { content: fallbackAutoDraftDocument(docType, candidates), usedLLM: false };
  }
  const prompt = renderPromptTemplate(
    promptText,
    buildWriterPromptContext({ metadata: { website_pages_evidence: evidenceText, site_archetype: siteArchetype } }),
  ).text;
  const config: UserLLMConfig = {
    provider: 'openrouter',
    api_key: llmConfig?.api_key,
    model: 'deepseek/deepseek-v4-pro',
  };
  try {
    const provider = getLLMProvider(env, config);
    const res = await provider.chatComplete([
      { role: 'system', content: 'You create conservative, reviewable knowledge-base drafts from crawled business website evidence.' },
      { role: 'user', content: prompt },
    ], env, config, 4096);
    const text = stripWrappingCodeFence(res.text).trim();
    if (text.length < 80) return { content: fallbackAutoDraftDocument(docType, candidates), usedLLM: false };
    return { content: text, usedLLM: true };
  } catch (err) {
    console.warn(`[content-writer] ${docType} auto-draft failed:`, err);
    return { content: fallbackAutoDraftDocument(docType, candidates), usedLLM: false };
  }
}

export async function handleDiscoverWebsitePages(
  request: Request, env: Env, userId: string, workspaceId: string,
): Promise<Response> {
  const ws = await getWorkspaceForUser(env, userId, workspaceId);
  if (!ws) return json({ error: 'workspace not found' }, 404);
  const body = await request.json().catch(() => ({})) as {
    website_url?: string;
    llm_config?: UserLLMConfig;
  };
  const websiteUrl = normalizeWebsiteUrl(body.website_url || ws.website_url || '');
  if (!websiteUrl) return json({ error: 'website_url required' }, 400);

  const discovery = await buildWebsiteDiscoveryResult(env, websiteUrl, body.llm_config);
  const llmDraft = discovery.canUseLLM ? await summarizeWebsitePagesDocument(env, discovery.candidates, body.llm_config) : null;
  const draftContent = llmDraft || formatWebsitePagesDocument(discovery.candidates);

  return json({
    candidates: discovery.candidates,
    draft_content: draftContent,
    metadata: {
      ...discovery.metadata,
      summarizer_model: llmDraft ? 'deepseek/deepseek-v4-pro' : null,
    },
  });
}

export async function handleAutoDraftKnowledgeBase(
  request: Request, env: Env, userId: string, workspaceId: string,
): Promise<Response> {
  const ws = await getWorkspaceForUser(env, userId, workspaceId);
  if (!ws) return json({ error: 'workspace not found' }, 404);
  const body = await request.json().catch(() => ({})) as {
    website_url?: string;
    llm_config?: UserLLMConfig;
  };
  const keyError = userOpenRouterKeyRequired(env, body.llm_config);
  if (keyError) return keyError;

  const websiteUrl = normalizeWebsiteUrl(body.website_url || ws.website_url || '');
  if (!websiteUrl) return json({ error: 'website_url required' }, 400);

  const startedAt = Date.now();
  const discovery = await buildWebsiteDiscoveryResult(env, websiteUrl, body.llm_config, {
    reviewLimit: 40,
    blogLimit: 10,
    enrichLimit: 28,
    enrichConcurrency: 6,
    enrichTimeoutMs: 5_000,
    evidenceCharLimit: 30_000,
  });
  const promptConfigs = await safeLoadPromptConfigs(env);
  const documents: Record<string, unknown> = {};
  const promptSources: Record<string, unknown> = {};

  const draftedDocuments = await Promise.all(AUTO_DRAFT_DOC_TYPES.map(async (docType) => {
    const key = autoDraftPromptKey(docType);
    const prompt = resolvePromptFromMap(
      promptConfigs,
      key,
      docType === 'sitemap' ? WEBSITE_PAGES_DISCOVERY_PROMPT : KB_AUTO_DRAFT_PROMPTS[docType],
    );
    const result = docType === 'sitemap'
      ? { content: formatWebsitePagesDocument(discovery.candidates), usedLLM: false }
      : await summarizeAutoDraftDocument(
        env,
        docType,
        prompt.text,
        discovery.evidenceText,
        discovery.candidates,
        body.llm_config,
        discovery.metadata.site_archetype,
      );
    return {
      docType,
      promptKey: key,
      promptSource: { source: prompt.source, publishedVersion: prompt.publishedVersion },
      document: {
        doc_type: docType,
        label: autoDraftLabel(docType),
        content: result.content,
        confidence_warnings: autoDraftWarnings(docType, discovery.candidates, result.usedLLM),
        source_page_urls: sourceUrlsForAutoDraft(docType, discovery.candidates),
        model: result.usedLLM ? 'deepseek/deepseek-v4-pro' : null,
        saved: false,
      },
    };
  }));

  for (const item of draftedDocuments) {
    promptSources[item.promptKey] = item.promptSource;
    documents[item.docType] = item.document;
  }

  return json({
    documents,
    evidence: {
      candidates: discovery.candidates,
      page_evidence: discovery.evidenceText,
      selected_source_urls: discovery.candidates.slice(0, 40).map((page) => page.url),
    },
    metadata: {
      ...discovery.metadata,
      draft_model: 'deepseek/deepseek-v4-pro',
      prompt_sources: promptSources,
      duration_ms: Date.now() - startedAt,
    },
  });
}

interface InterviewBody {
  message: string;
  llm_config?: UserLLMConfig;
}

// POST /api/content-writer/workspaces/:id/kb/:doc_type/interview
// Sends one user message in the interview conversation, returns the assistant
// reply (non-streaming for simplicity in v1).
export async function handleInterview(
  request: Request, env: Env, userId: string, workspaceId: string, docType: string,
): Promise<Response> {
  if (!isDocType(docType)) return json({ error: 'invalid doc_type' }, 400);
  const ws = await getWorkspaceForUser(env, userId, workspaceId);
  if (!ws) return json({ error: 'workspace not found' }, 404);

  const body = await request.json() as InterviewBody;
  if (!body.message || !body.message.trim()) return json({ error: 'message required' }, 400);
  const keyError = userOpenRouterKeyRequired(env, body.llm_config);
  if (keyError) return keyError;

  let doc = await loadKBDoc(env, workspaceId, docType);
  if (!doc) {
    const id = newId();
    await env.DB.prepare(
      `INSERT INTO content_writer_kb_docs (id, workspace_id, doc_type, status) VALUES (?, ?, ?, 'in_progress')`
    ).bind(id, workspaceId, docType).run();
    doc = (await loadKBDoc(env, workspaceId, docType))!;
  }

  // Lazily create a chat conversation for this KB doc
  let convId = doc.conversation_id;
  if (!convId) {
    convId = newId();
    await env.DB.prepare(
      `INSERT INTO chat_conversations (id, user_id, property_id, title)
       VALUES (?, ?, ?, ?)`
    ).bind(convId, userId, ws.property_id, `Interview: ${DOC_LABELS[docType]} (${ws.name})`).run();
    await env.DB.prepare(
      `UPDATE content_writer_kb_docs SET conversation_id = ?, status = 'in_progress', updated_at = datetime('now')
       WHERE workspace_id = ? AND doc_type = ?`
    ).bind(convId, workspaceId, docType).run();
  }

  // Store the user message
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)`
  ).bind(newId(), convId, body.message).run();

  // Build system prompt; for sitemap, prepend scraped homepage context if available
  const promptConfigs = await safeLoadPromptConfigs(env);
  const readyKb = await loadReadyKBContext(env, workspaceId);
  const promptContext = buildWriterPromptContext({
    workspace: ws,
    kb: readyKb,
  });
  let systemPrompt = resolvePromptFromMap(
    promptConfigs,
    interviewPromptKey(docType),
    INTERVIEW_PROMPTS[docType],
  ).text;
  systemPrompt = renderPromptTemplate(systemPrompt, promptContext).text;
  if (docType === 'experience_notes') {
    systemPrompt = appendExperienceInterviewContext(systemPrompt, promptContext, readyKb);
  }
  if (docType === 'sitemap' || docType === 'brand_guidelines' || docType === 'service_details') {
    const scraped = await buildScrapedPagesContext(ws.website_url);
    systemPrompt = withScrapedPagesContext(systemPrompt, scraped);
  }

  const history = await env.DB.prepare(
    `SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 50`
  ).bind(convId).all<{ role: 'user' | 'assistant' | 'system'; content: string }>();

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...((history.results || []) as ChatMessage[]),
  ];

  const llmConfig = resolveContentWriterLLMConfig(body.llm_config);
  const provider = getLLMProvider(env, llmConfig);
  let reply: string;
  try {
    const res = await provider.chatComplete(messages, env, llmConfig, 2048);
    reply = res.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'LLM provider error';
    return json({ error: msg }, 502);
  }

  await env.DB.prepare(
    `INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', ?)`
  ).bind(newId(), convId, reply).run();

  await env.DB.prepare(
    `UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?`
  ).bind(convId).run();
  await env.DB.prepare(
    `UPDATE content_writer_kb_docs SET status = 'in_progress', updated_at = datetime('now')
     WHERE workspace_id = ? AND doc_type = ?`
  ).bind(workspaceId, docType).run();

  return json({ reply, conversation_id: convId });
}

// POST /api/content-writer/workspaces/:id/kb/:doc_type/finalize
// Asks the LLM to emit the structured doc; saves it, marks status=ready.
export async function handleFinalize(
  request: Request, env: Env, userId: string, workspaceId: string, docType: string,
): Promise<Response> {
  if (!isDocType(docType)) return json({ error: 'invalid doc_type' }, 400);
  const ws = await getWorkspaceForUser(env, userId, workspaceId);
  if (!ws) return json({ error: 'workspace not found' }, 404);

  const body = await request.json().catch(() => ({})) as { llm_config?: UserLLMConfig };
  const keyError = userOpenRouterKeyRequired(env, body.llm_config);
  if (keyError) return keyError;
  const doc = await loadKBDoc(env, workspaceId, docType);
  if (!doc?.conversation_id) {
    return json({ error: 'no interview to finalize — start the interview first' }, 400);
  }

  const promptConfigs = await safeLoadPromptConfigs(env);
  const readyKb = await loadReadyKBContext(env, workspaceId);
  const promptContext = buildWriterPromptContext({
    workspace: ws,
    kb: readyKb,
  });
  const finalizeMsg = renderPromptTemplate(resolvePromptFromMap(
    promptConfigs,
    finalizePromptKey(docType),
    FINALIZE_PROMPTS[docType],
  ).text, promptContext).text;
  // Persist the finalize prompt as a user message so the conversation history
  // stays coherent if the user re-finalizes later.
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)`
  ).bind(newId(), doc.conversation_id, finalizeMsg).run();

  const history = await env.DB.prepare(
    `SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 100`
  ).bind(doc.conversation_id).all<{ role: 'user' | 'assistant'; content: string }>();

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: renderPromptTemplate(resolvePromptFromMap(
        promptConfigs,
        interviewPromptKey(docType),
        INTERVIEW_PROMPTS[docType],
      ).text, promptContext).text,
    },
    ...((history.results || []) as ChatMessage[]),
  ];

  const llmConfig = resolveContentWriterLLMConfig(body.llm_config);
  const provider = getLLMProvider(env, llmConfig);
  let final: string;
  try {
    const res = await provider.chatComplete(messages, env, llmConfig, 4096);
    final = res.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'LLM provider error';
    return json({ error: msg }, 502);
  }

  await env.DB.prepare(
    `INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', ?)`
  ).bind(newId(), doc.conversation_id, final).run();

  await env.DB.prepare(
    `UPDATE content_writer_kb_docs SET content = ?, status = 'ready', updated_at = datetime('now')
     WHERE workspace_id = ? AND doc_type = ?`
  ).bind(final, workspaceId, docType).run();
  await env.DB.prepare(
    `UPDATE content_writer_workspaces SET updated_at = datetime('now') WHERE id = ?`
  ).bind(workspaceId).run();

  return json({ content: final, status: 'ready' });
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export async function handleListPosts(env: Env, userId: string, workspaceId: string): Promise<Response> {
  const ws = await getWorkspaceForUser(env, userId, workspaceId);
  if (!ws) return json({ error: 'workspace not found' }, 404);
  const rows = await env.DB.prepare(
    `SELECT id, title, topic, target_keyword, status, updated_at, created_at
     FROM content_writer_posts WHERE workspace_id = ? ORDER BY updated_at DESC`
  ).bind(workspaceId).all();
  return json({ posts: rows.results || [] });
}

export async function handleCreatePost(
  request: Request, env: Env, userId: string, workspaceId: string,
): Promise<Response> {
  const ws = await getWorkspaceForUser(env, userId, workspaceId);
  if (!ws) return json({ error: 'workspace not found' }, 404);

  const body = await request.json() as {
    topic?: string;
    target_keyword?: string;
    secondary_keywords?: string;
    takeaway?: string;
    notes?: string;
    include_tables?: boolean;
    include_tldr?: boolean;
    include_faq?: boolean;
    capsule_pct?: number;
    title?: string;
    content_output_controls?: unknown;
  };
  if (!body.topic?.trim()) return json({ error: 'topic required' }, 400);

  const id = newId();
  const briefJson = JSON.stringify({
    topic: body.topic.trim(),
    target_keyword: body.target_keyword?.trim() || '',
    secondary_keywords: body.secondary_keywords?.trim() || '',
    takeaway: body.takeaway?.trim() || '',
    notes: body.notes?.trim() || '',
    include_tables: body.include_tables ?? true,
    include_tldr: body.include_tldr ?? true,
    include_faq: body.include_faq ?? true,
    capsule_pct: typeof body.capsule_pct === 'number' ? Math.max(0, Math.min(100, Math.round(body.capsule_pct))) : 65,
    // Multi-language output: persisted with the brief so every step
    // (research/outline/draft/review) inherits the same target language.
    content_output_controls: body.content_output_controls ?? undefined,
  });
  await env.DB.prepare(
    `INSERT INTO content_writer_posts (id, workspace_id, user_id, title, topic, target_keyword, status, brief_json)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`
  ).bind(
    id, workspaceId, userId,
    body.title?.trim() || body.topic.trim(),
    body.topic.trim(),
    body.target_keyword?.trim() || null,
    briefJson,
  ).run();
  return json({ post: { id, workspace_id: workspaceId, status: 'draft' } });
}

async function getPostForUser(env: Env, userId: string, postId: string): Promise<PostRow | null> {
  return env.DB.prepare(
    `SELECT * FROM content_writer_posts WHERE id = ? AND user_id = ?`
  ).bind(postId, userId).first<PostRow>();
}

export async function handleGetPost(env: Env, userId: string, postId: string): Promise<Response> {
  const post = await getPostForUser(env, userId, postId);
  if (!post) return json({ error: 'not found' }, 404);
  return json({ post });
}

export async function handleUpdatePost(
  request: Request, env: Env, userId: string, postId: string,
): Promise<Response> {
  const post = await getPostForUser(env, userId, postId);
  if (!post) return json({ error: 'not found' }, 404);

  const body = await request.json() as Partial<{
    title: string; body_html: string; body_md: string; status: PostRow['status'];
    sources_json: string; outline_json: string;
  }>;
  const bodyHtml = typeof body.body_html === 'string'
    ? repairWriterOutputIfNeeded(body.body_html).text
    : body.body_html;
  const bodyMd = typeof body.body_md === 'string'
    ? repairWriterOutputIfNeeded(body.body_md).text
    : body.body_md;
  await env.DB.prepare(
    `UPDATE content_writer_posts
     SET title = COALESCE(?, title),
         body_html = COALESCE(?, body_html),
         body_md = COALESCE(?, body_md),
         status = COALESCE(?, status),
         sources_json = COALESCE(?, sources_json),
         outline_json = COALESCE(?, outline_json),
         updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    body.title ?? null,
    bodyHtml ?? null,
    bodyMd ?? null,
    body.status ?? null,
    body.sources_json ?? null,
    body.outline_json ?? null,
    postId,
  ).run();
  return json({ success: true });
}

export async function handleDeletePost(env: Env, userId: string, postId: string): Promise<Response> {
  const post = await getPostForUser(env, userId, postId);
  if (!post) return json({ error: 'not found' }, 404);
  await env.DB.prepare(`DELETE FROM content_writer_posts WHERE id = ?`).bind(postId).run();
  return json({ success: true });
}

// POST /api/content-writer/posts/:id/step
// Body: { step: 'research' | 'outline' | 'draft' | 'review', llm_config? }
// For 'outline'/'draft' the prior approved sources/outline are loaded from
// the post row. For 'draft' the persisted draft (body_md) is used as input
// to 'review'.
export async function handlePostStep(
  request: Request, env: Env, userId: string, postId: string,
): Promise<Response> {
  const post = await getPostForUser(env, userId, postId);
  if (!post) return json({ error: 'not found' }, 404);

  const body = await request.json() as { step?: PostStep; llm_config?: UserLLMConfig };
  const step = body.step;
  if (!step || !['research', 'outline', 'draft', 'review'].includes(step)) {
    return json({ error: 'invalid step' }, 400);
  }
  const keyError = userOpenRouterKeyRequired(env, body.llm_config);
  if (keyError) return keyError;
  if (body.llm_config?.api_key) {
    const keyCheck = await validateOpenRouterKey(body.llm_config.api_key, env);
    if (!keyCheck.ok && keyCheck.reason === 'management') return json({ error: keyCheck.message }, 400);
    if (!keyCheck.ok && keyCheck.reason === 'invalid')    return json({ error: keyCheck.message }, 401);
  }

  const workspace = await getWorkspaceForUser(env, userId, post.workspace_id);
  if (!workspace) return json({ error: 'workspace not found' }, 404);
  const kb = await loadReadyKBContext(env, post.workspace_id);

  const brief = post.brief_json ? JSON.parse(post.brief_json) : { topic: post.topic || '' };
  const priorContext: { sources?: string; outline?: string; draft?: string } = {};
  let sourceSearchMeta: unknown = null;
  if (post.sources_json) {
    try {
      const parsedSources = JSON.parse(post.sources_json) as {
        text?: string;
        ai_questions?: AiQuestionContext;
        source_search?: unknown;
      };
      priorContext.sources = [parsedSources.text, formatAiQuestionContext(parsedSources.ai_questions)]
        .filter(Boolean)
        .join('\n\n');
      sourceSearchMeta = parsedSources.source_search || null;
    } catch { /* ignore */ }
  }
  // Outline overrides: settings stored on the outline (TL;DR, tables, capsule %)
  // take precedence over the brief defaults when running the draft step.
  type OutlineSettings = { include_tldr?: boolean; include_tables?: boolean; include_faq?: boolean; capsule_pct?: number };
  let outlineSettings: OutlineSettings | null = null;
  if (post.outline_json) {
    try {
      const ol = JSON.parse(post.outline_json) as { text?: string; settings?: OutlineSettings };
      priorContext.outline = ol.text;
      outlineSettings = ol.settings || null;
    } catch { /* ignore */ }
  }
  if (post.body_md) priorContext.draft = post.body_md;

  const effectiveBrief = {
    ...brief,
    include_tables: outlineSettings?.include_tables ?? brief.include_tables ?? true,
    include_tldr: outlineSettings?.include_tldr ?? brief.include_tldr ?? true,
    include_faq: outlineSettings?.include_faq ?? brief.include_faq ?? true,
    capsule_pct: outlineSettings?.capsule_pct ?? brief.capsule_pct ?? 65,
  };

  const promptConfigs = await safeLoadPromptConfigs(env);
  const promptKeys = postStepPromptKeys(step);
  const masterPrompt = resolvePromptFromMap(promptConfigs, promptKeys.master, '');
  const stepPrompt = resolvePromptFromMap(promptConfigs, promptKeys.system, '');
  const userPrompt = resolvePromptFromMap(promptConfigs, promptKeys.user, '');
  const promptContext = buildWriterPromptContext({
    workspace,
    brief: effectiveBrief,
    kb,
    priorContext,
    metadata: {
      source_search: sourceSearchMeta,
      outline_settings: outlineSettings,
    },
  });

  // Multi-language output: brief carries content_output_controls (set at
  // post creation time in NewPostDialog). Research returns JSON sources,
  // outline + draft + review return prose/markdown. Use preserveJsonShape
  // only for research.
  const briefControls = (brief && typeof brief === 'object' && 'content_output_controls' in brief)
    ? (brief as { content_output_controls?: unknown }).content_output_controls
    : undefined;
  const languageInstruction = getContentOutputInstruction(briefControls, {
    preserveJsonShape: step === 'research',
  });
  const languageReminder = getContentOutputUserReminder(briefControls);
  const languageLabel = getControlsLanguageLabel(briefControls);
  const briefControlsObj = briefControls as { language?: string } | undefined;
  const expectedLangFamily = expectedFamily(briefControlsObj?.language);
  const baseSystemPrompt = buildPostStepSystemPrompt(kb, step, {
    master: masterPrompt.source === 'published' ? masterPrompt.text : undefined,
    step: stepPrompt.source === 'published' ? stepPrompt.text : undefined,
    context: promptContext,
  });
  const baseUserMessage = buildPostStepUserMessage(
    effectiveBrief,
    step,
    priorContext,
    userPrompt.source === 'published' ? userPrompt.text : undefined,
    promptContext,
  );
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${baseSystemPrompt}\n\n${languageInstruction}`,
    },
    {
      role: 'user',
      content: `${baseUserMessage}${languageReminder}`,
    },
  ];
  const aiQuestionContextPromise = step === 'research'
    ? buildAiQuestionContext(env, effectiveBrief)
    : Promise.resolve(undefined);

  const stepConfig = resolveStepLLMConfig(step, body.llm_config, env);
  const provider = getLLMProvider(env, stepConfig);
  // Token budgets per step. Draft is the long-form output and needs more
  // room; GPT-5.5 Pro also needs a larger outline/review cap because
  // OpenRouter's endpoint requires reasoning before visible content.
  const maxTokens = resolvePostStepMaxTokens(step, stepConfig.model);
  let text: string;
  let usage: { input_tokens: number; output_tokens: number } = { input_tokens: 0, output_tokens: 0 };
  let citations: { url: string; title?: string; snippet?: string }[] | undefined;
  let aiQuestionContext: AiQuestionContext | undefined;
  let truncated = false;
  let qualityWarnings: string[] = [];
  const t0 = Date.now();
  try {
    const [res, questions] = await Promise.all([
      provider.chatComplete(messages, env, stepConfig, maxTokens),
      aiQuestionContextPromise,
    ]);
    let activeRes = res;
    text = activeRes.text;
    usage = activeRes.usage;
    citations = activeRes.citations;
    aiQuestionContext = questions;
    console.log(`[content-writer] step=${step} model=${stepConfig.model} elapsedMs=${Date.now() - t0} ok=true post=${postId}`);

    // Post-output language detection (#2). One corrective retry on
    // family mismatch. Skipped for English target and for very short
    // outputs (the detector returns 'unknown' below 30 words).
    if (expectedLangFamily !== 'en') {
      const detected = detectLanguageFamily(activeRes.text);
      if (detected !== 'unknown' && detected !== expectedLangFamily) {
        console.warn(`[content-writer] step=${step} language mismatch: expected=${expectedLangFamily} detected=${detected} post=${postId}`);
        const retryMessages: ChatMessage[] = [
          ...messages,
          { role: 'assistant', content: activeRes.text },
          { role: 'user', content: buildLanguageRetryPrompt(detected, languageLabel) },
        ];
        try {
          const retryRes = await provider.chatComplete(retryMessages, env, stepConfig, maxTokens);
          activeRes = retryRes;
          text = retryRes.text;
          usage = {
            input_tokens: usage.input_tokens + retryRes.usage.input_tokens,
            output_tokens: usage.output_tokens + retryRes.usage.output_tokens,
          };
          citations = retryRes.citations ?? citations;
          console.log(`[content-writer] step=${step} language-retry ok post=${postId}`);
        } catch (retryErr) {
          // If the retry fails, keep the original output rather than 500.
          console.warn(`[content-writer] step=${step} language-retry failed, keeping original. err=${String(retryErr)}`);
        }
      }
    }

    // finish_reason === 'length' means the model hit max_tokens before
    // finishing. Surface it so the UI can tell the user to re-run or
    // raise the cap, instead of silently persisting a half-finished post.
    if (activeRes.finishReason === 'length') {
      truncated = true;
      console.warn(`[content-writer] step=${step} truncated at max_tokens (${maxTokens}). post=${postId} model=${stepConfig.model}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'LLM provider error';
    console.error(`[content-writer] step=${step} model=${stepConfig.model} elapsedMs=${Date.now() - t0} ok=false post=${postId} err=${msg}`);
    return json({ error: msg }, 502);
  }

  const excludedSourceTerms = step === 'research' ? extractNeverCiteTerms(kb.brand_guidelines) : [];
  const structuredCitationCount = citations?.length || 0;
  const filteredCitations = filterExcludedSources(citations, excludedSourceTerms);
  citations = filteredCitations.sources;

  // Defensive: LLMs occasionally wrap the entire response in a ```markdown fence,
  // which makes downstream renderers treat it as one code block. Strip a single
  // leading/trailing fence pair when it spans the whole reply.
  text = stripWrappingCodeFence(text);
  // Apply the typography cleanup to writing steps only. Research output may
  // legitimately contain dashes inside quoted source titles, so leave it alone.
  if (step === 'outline' || step === 'draft' || step === 'review') {
    text = stripBannedTypography(text);
  }
  if (step === 'draft' || step === 'review') {
    const repair = repairWriterOutputIfNeeded(text);
    text = repair.text;
    qualityWarnings = repair.warnings;
  }

  const sourceSearch = step === 'research'
    ? {
        model: stepConfig.model || null,
        structured_citation_count: structuredCitationCount,
        ai_question_source: aiQuestionContext?.source || 'none',
        ai_question_count: aiQuestionContext?.questions?.length || 0,
        excluded_terms: excludedSourceTerms,
        filtered_source_count: filteredCitations.filteredCount,
        generated_at: new Date().toISOString(),
      }
    : undefined;

  // Persist step output on the post row
  const updates: { sql: string; params: unknown[] } = (() => {
    switch (step) {
      case 'research':
        return buildPostStepPersistenceUpdate(step, JSON.stringify({
          text,
          citations: citations || [],
          model: stepConfig.model,
          ai_questions: aiQuestionContext,
          source_search: sourceSearch,
        }), postId);
      case 'outline':
        return buildPostStepPersistenceUpdate(step, JSON.stringify({ text }), postId);
      case 'draft':
        return buildPostStepPersistenceUpdate(step, text, postId);
      case 'review':
        // Review is informational — don't overwrite the draft. The frontend
        // shows the review report to the user.
        return buildPostStepPersistenceUpdate(step, '', postId);
    }
  })();
  await env.DB.prepare(updates.sql).bind(...updates.params).run();

  // Merge this step's usage into usage_json. Each step overwrites its own slot
  // so re-running a step replaces (not appends) its cost.
  const stepUsage = {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    provider: stepConfig.provider || 'openrouter',
    model: stepConfig.model || null,
    at: new Date().toISOString(),
  };
  let usageMap: Partial<Record<PostStep, typeof stepUsage>> = {};
  if (post.usage_json) {
    try { usageMap = JSON.parse(post.usage_json); } catch { /* ignore corrupt */ }
  }
  usageMap = pruneDownstreamStepUsage(step, usageMap);
  usageMap[step] = stepUsage;
  await env.DB.prepare(
    `UPDATE content_writer_posts SET usage_json = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(JSON.stringify(usageMap), postId).run();

  return json({
    step,
    text,
    citations: citations || [],
    truncated,
    quality_warnings: qualityWarnings,
    usage: stepUsage,
    usage_all: usageMap,
  });
}
