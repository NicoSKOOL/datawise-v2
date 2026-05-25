import { api } from './api';
import { getLLMConfig, type LLMConfig } from './chat';
import { DEFAULT_OPENROUTER_MODEL, SEARCH_MODEL_ID, isApprovedOpenRouterModel } from './ai-models';

export { modelDisplayName } from './ai-models';

// Content-writer step-model selection.
// The Chat panel and the Content Writer both reuse the user's BYOK provider
// + API key (stored under `datawise_llm_config`), but we deliberately use
// different model defaults: chat answers are short and benefit from a
// frontier model, while content-writer steps are long-form and we want a
// search-grounded model for research and a cheap-but-strong writer for the
// rest. Without this split, a saved chat model (e.g. Sonnet) would bleed
// into the writer pipeline and override the step defaults.
export const CONTENT_WRITER_STEP_DEFAULTS: Record<PostStep, string> = {
  research: SEARCH_MODEL_ID,
  outline: DEFAULT_OPENROUTER_MODEL,
  draft: DEFAULT_OPENROUTER_MODEL,
  review: DEFAULT_OPENROUTER_MODEL,
};

const STEP_MODELS_KEY = 'datawise_content_writer_step_models';
// Dispatched after any per-step override is written. Same rationale as
// LLM_CONFIG_EVENT in chat.ts — same-tab listeners need an explicit signal.
export const CW_STEP_MODELS_EVENT = 'datawise:cw-step-models-changed';

export function getContentWriterStepModels(): Partial<Record<PostStep, string>> {
  try {
    const raw = localStorage.getItem(STEP_MODELS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function setContentWriterStepModel(step: PostStep, model: string | null): void {
  const current = getContentWriterStepModels();
  if (step === 'research') {
    delete current[step];
    localStorage.setItem(STEP_MODELS_KEY, JSON.stringify(current));
    window.dispatchEvent(new Event(CW_STEP_MODELS_EVENT));
    return;
  }
  if (!model) delete current[step];
  else if (isApprovedOpenRouterModel(model)) current[step] = model;
  else return;
  localStorage.setItem(STEP_MODELS_KEY, JSON.stringify(current));
  window.dispatchEvent(new Event(CW_STEP_MODELS_EVENT));
}

// Resolve the effective model for a given pipeline step. Priority:
//   1. Per-step popover override        (datawise_content_writer_step_models)
//   2. Settings → AI Chat Model.model   (chat config — only for non-research)
//   3. Hard-wired step default          (CONTENT_WRITER_STEP_DEFAULTS)
//
// Research is exempted from rule #2 because chat models can't do live web
// search — letting a saved chat model (e.g. Claude or GPT) become the
// research default would silently break the citation flow. Research only
// honors override > sonar-pro.
//
// Exposed so the ModelBadge tooltip can show exactly what runStep will use,
// and label the source ("Per-step override" / "From Settings" / "Default").
export function resolveContentWriterStepModel(step: PostStep): {
  model: string;
  source: 'override' | 'settings' | 'default';
} {
  const overrides = getContentWriterStepModels();
  if (step !== 'research' && isApprovedOpenRouterModel(overrides[step])) {
    return { model: overrides[step] as string, source: 'override' };
  }
  if (step !== 'research') {
    const base = getLLMConfig();
    if (isApprovedOpenRouterModel(base?.model)) return { model: base.model, source: 'settings' };
  }
  return { model: CONTENT_WRITER_STEP_DEFAULTS[step], source: 'default' };
}

// Build the llm_config to send to the worker for a given content-writer
// step. Reuses the BYOK provider + api_key from the chat config and the
// resolved step model. Returns undefined when there's no provider/key —
// worker then falls back to env-managed key (dev mode) or rejects (prod).
function buildStepLLMConfig(step: PostStep): LLMConfig | undefined {
  const base = getLLMConfig();
  if (!base) return undefined;
  return {
    provider: 'openrouter',
    api_key: base.api_key,
    model: resolveContentWriterStepModel(step).model,
  };
}

export type DocType =
  | 'sitemap'
  | 'tone_of_voice'
  | 'experience_notes'
  | 'service_details'
  | 'brand_guidelines';

export type AutoDraftDocType = Exclude<DocType, 'experience_notes'>;

export type DocStatus = 'empty' | 'in_progress' | 'ready';
export type PostStatus = 'draft' | 'researched' | 'outlined' | 'written';
export type PostStep = 'research' | 'outline' | 'draft' | 'review';

export const DOC_TYPES: DocType[] = [
  'sitemap',
  'tone_of_voice',
  'experience_notes',
  'service_details',
  'brand_guidelines',
];

export const DOC_LABELS: Record<DocType, string> = {
  sitemap: 'Website Pages',
  tone_of_voice: 'Tone of Voice',
  experience_notes: 'Experience Notes',
  service_details: 'Offer Details',
  brand_guidelines: 'Brand Guidelines',
};

export const DOC_DESCRIPTIONS: Record<DocType, string> = {
  sitemap: 'Every page on your site, with what it covers and whether blog posts should link to it.',
  tone_of_voice: 'Personality, sentence patterns, vocabulary, and rhythm to match in every post.',
  experience_notes: 'Your real expertise, stories, opinions, and credentials. The single biggest lift over generic AI content.',
  service_details: 'Source of truth for services, features, products, pricing, what is included, edge cases, and process. Stops invented facts.',
  brand_guidelines: 'Hard rules: banned words, regulated claims, competitor exclusions, formatting.',
};

export interface Workspace {
  id: string;
  user_id: string;
  property_id: string | null;
  property_url?: string | null;
  name: string;
  website_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface KBDocSummary {
  id: string;
  doc_type: DocType;
  status: DocStatus;
  conversation_id: string | null;
  content_length: number;
  updated_at: string;
}

export interface PostSummary {
  id: string;
  title: string | null;
  topic: string | null;
  target_keyword: string | null;
  status: PostStatus;
  updated_at: string;
  created_at?: string;
}

export interface KBDoc {
  id: string;
  workspace_id: string;
  doc_type: DocType;
  status: DocStatus;
  content: string | null;
  conversation_id: string | null;
  updated_at: string;
}

export type WebsitePageSource = 'sitemap' | 'homepage_link' | 'nav_link' | 'sonar_fallback';

export interface WebsitePageCandidate {
  url: string;
  title: string;
  page_type: string;
  description: string;
  link_worthy: 'yes' | 'sometimes' | 'no';
  source: WebsitePageSource;
  confidence: 'high' | 'medium' | 'low';
  slug?: string;
  meta_description?: string;
  h1?: string[];
  h2?: string[];
  canonical_url?: string;
  snippet?: string;
}

export interface WebsitePagesDiscoveryResponse {
  candidates: WebsitePageCandidate[];
  draft_content: string;
  metadata: {
    website_url: string;
    deterministic_candidate_count: number;
    final_candidate_count: number;
    sitemap_urls: string[];
    homepage_links_found: number;
    sonar_fallback_used: boolean;
    crawler: string;
    search_model: string | null;
    summarizer_model: string | null;
    llm_skipped_reason?: string | null;
    discovery_duration_ms?: number;
    site_archetype?: string;
    ranking_summary?: Record<string, number>;
    saved: boolean;
  };
}

export interface KBAutoDraftDocument {
  doc_type: AutoDraftDocType;
  label: string;
  content: string;
  confidence_warnings: string[];
  source_page_urls: string[];
  model: string | null;
  saved: boolean;
}

export interface KBAutoDraftMetadata {
  website_url: string;
  deterministic_candidate_count: number;
  final_candidate_count: number;
  sitemap_urls: string[];
  homepage_links_found: number;
  sonar_fallback_used: boolean;
  crawler: string;
  search_model: string | null;
  draft_model: string | null;
  llm_skipped_reason?: string | null;
  discovery_duration_ms?: number;
  duration_ms?: number;
  site_archetype?: string;
  ranking_summary?: Record<string, number>;
  saved: boolean;
}

export interface KBAutoDraftResponse {
  documents: Record<AutoDraftDocType, KBAutoDraftDocument>;
  evidence: {
    candidates: WebsitePageCandidate[];
    page_evidence: string;
    selected_source_urls: string[];
  };
  metadata: KBAutoDraftMetadata;
}

export interface InterviewMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface PostBrief {
  topic: string;
  target_keyword?: string;
  secondary_keywords?: string;
  takeaway?: string;
  notes?: string;
  include_tables?: boolean;
  include_tldr?: boolean;
  include_faq?: boolean;
  capsule_pct?: number;
  content_output_controls?: { language?: string };
}

export interface Post {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string | null;
  topic: string | null;
  target_keyword: string | null;
  status: PostStatus;
  brief_json: string | null;
  sources_json: string | null;
  outline_json: string | null;
  body_html: string | null;
  body_md: string | null;
  usage_json: string | null;
  created_at: string;
  updated_at: string;
}

const BASE = '/api/content-writer';

export async function listWorkspaces() {
  return api<{ workspaces: Workspace[] }>(`${BASE}/workspaces`);
}

// Resolve (find or create) the workspace bound to a given GSC property.
// Server-side handles the migration: a single dangling workspace gets
// adopted, otherwise a fresh one is created. Use this on Content Writer
// page mount and from the planner-import flow.
export async function resolveWorkspaceForProperty(propertyId: string) {
  return api<{ workspace: Workspace; migrated?: boolean; created?: boolean }>(
    `${BASE}/workspaces/resolve`,
    { method: 'POST', body: { property_id: propertyId } },
  );
}

export async function createWorkspace(input: { name: string; website_url?: string; property_id?: string | null }) {
  return api<{ workspace: Workspace }>(`${BASE}/workspaces`, { method: 'POST', body: input });
}

export async function getWorkspace(id: string) {
  return api<{ workspace: Workspace; kb_docs: KBDocSummary[]; posts: PostSummary[] }>(`${BASE}/workspaces/${id}`);
}

export async function deleteWorkspace(id: string) {
  return api<{ success: true }>(`${BASE}/workspaces/${id}`, { method: 'DELETE' });
}

export async function getKBDoc(workspaceId: string, docType: DocType) {
  return api<{ doc: KBDoc | null; messages: InterviewMessage[] }>(`${BASE}/workspaces/${workspaceId}/kb/${docType}`);
}

export async function updateKBDoc(workspaceId: string, docType: DocType, body: { content?: string; status?: DocStatus }) {
  return api<{ success: true }>(`${BASE}/workspaces/${workspaceId}/kb/${docType}`, { method: 'PUT', body });
}

export async function discoverWebsitePages(workspaceId: string, websiteUrl?: string) {
  const llm_config = getLLMConfig() || undefined;
  return api<WebsitePagesDiscoveryResponse>(
    `${BASE}/workspaces/${workspaceId}/kb/sitemap/discover`,
    { method: 'POST', body: { website_url: websiteUrl, llm_config } },
  );
}

export async function generateKnowledgeBaseDrafts(workspaceId: string, websiteUrl?: string) {
  const llm_config = getLLMConfig() || undefined;
  return api<KBAutoDraftResponse>(
    `${BASE}/workspaces/${workspaceId}/kb/auto-draft`,
    { method: 'POST', body: { website_url: websiteUrl, llm_config } },
  );
}

export async function sendInterviewMessage(workspaceId: string, docType: DocType, message: string) {
  const llm_config = getLLMConfig() || undefined;
  return api<{ reply: string; conversation_id: string }>(
    `${BASE}/workspaces/${workspaceId}/kb/${docType}/interview`,
    { method: 'POST', body: { message, llm_config } },
  );
}

export async function finalizeKBDoc(workspaceId: string, docType: DocType) {
  const llm_config = getLLMConfig() || undefined;
  return api<{ content: string; status: DocStatus }>(
    `${BASE}/workspaces/${workspaceId}/kb/${docType}/finalize`,
    { method: 'POST', body: { llm_config } },
  );
}

export async function listPosts(workspaceId: string) {
  return api<{ posts: PostSummary[] }>(`${BASE}/workspaces/${workspaceId}/posts`);
}

export async function createPost(workspaceId: string, brief: PostBrief & { title?: string }) {
  return api<{ post: { id: string; workspace_id: string; status: PostStatus } }>(
    `${BASE}/workspaces/${workspaceId}/posts`,
    { method: 'POST', body: brief },
  );
}

export async function getPost(postId: string) {
  return api<{ post: Post }>(`${BASE}/posts/${postId}`);
}

export async function updatePost(postId: string, body: Partial<{ title: string; body_html: string; body_md: string; status: PostStatus; sources_json: string; outline_json: string }>) {
  return api<{ success: true }>(`${BASE}/posts/${postId}`, { method: 'PUT', body });
}

export async function deletePost(postId: string) {
  return api<{ success: true }>(`${BASE}/posts/${postId}`, { method: 'DELETE' });
}

// Status pill color tokens. Used by the post list and any status filter UI.
// Order matches the pipeline: draft (untouched) → researched → outlined →
// written. Tailwind classes intentionally; no design-system tokens to keep
// the pill self-contained.
export const POST_STATUS_ORDER: PostStatus[] = ['draft', 'researched', 'outlined', 'written'];

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Draft',
  researched: 'Researched',
  outlined: 'Outlined',
  written: 'Written',
};

export const POST_STATUS_PILL: Record<PostStatus, string> = {
  draft:      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
  researched: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800',
  outlined:   'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:border-violet-800',
  written:    'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800',
};

// Auto-create a Content Writer post from a Content Planner keyword. Called
// when a planner item transitions into the "Draft" column. Best-effort and
// idempotent: if a post with the same target keyword already exists in the
// user's first workspace, we return that one instead of duplicating it.
// Returns a discriminated result so callers can toast appropriately.
export type ImportPlannerResult =
  | { created: true; postId: string; workspaceId: string }
  | { created: false; reason: 'no_property' }
  | { created: false; reason: 'duplicate'; postId: string; workspaceId: string };

// Auto-import flow: caller passes the currently-selected property id
// (from PropertyContext). We resolve the workspace bound to that property
// (creating one if needed) and create the post there. This keeps the
// planner → writer bridge tied to the website the user is actually
// planning for, instead of a stale "first workspace" guess.
export async function importPlannerKeywordToWriter(args: {
  propertyId: string;
  keyword: string;
  secondaryKeywords?: string;
  topic?: string;
  notes?: string;
}): Promise<ImportPlannerResult> {
  const keyword = args.keyword.trim();
  const propertyId = args.propertyId?.trim();
  if (!keyword || !propertyId) return { created: false, reason: 'no_property' };

  const { workspace } = await resolveWorkspaceForProperty(propertyId);

  // Dedupe by target_keyword inside the workspace. Case-insensitive match
  // because the planner sometimes capitalizes whereas the writer doesn't.
  const norm = keyword.toLowerCase();
  const { posts } = await listPosts(workspace.id);
  const existing = posts.find(
    (p) => (p.target_keyword || '').trim().toLowerCase() === norm,
  );
  if (existing) {
    return { created: false, reason: 'duplicate', postId: existing.id, workspaceId: workspace.id };
  }

  const { post } = await createPost(workspace.id, {
    topic: args.topic?.trim() || keyword,
    target_keyword: keyword,
    secondary_keywords: args.secondaryKeywords?.trim() || undefined,
    notes: args.notes?.trim() || undefined,
    title: keyword,
  });
  return { created: true, postId: post.id, workspaceId: workspace.id };
}

export interface StepUsage {
  input_tokens: number;
  output_tokens: number;
  provider?: string;
  model?: string | null;
  at?: string;
}

export type UsageMap = Partial<Record<PostStep, StepUsage>>;

export async function runPostStep(postId: string, step: PostStep) {
  const llm_config = buildStepLLMConfig(step);
  return api<{ step: PostStep; text: string; usage?: StepUsage; usage_all?: UsageMap; quality_warnings?: string[]; truncated?: boolean }>(`${BASE}/posts/${postId}/step`, {
    method: 'POST',
    body: { step, llm_config },
  });
}
