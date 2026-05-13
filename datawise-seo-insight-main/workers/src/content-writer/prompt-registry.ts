import {
  DOC_LABELS,
  DOC_TYPES,
  FINALIZE_PROMPTS,
  INTERVIEW_PROMPTS,
  KB_AUTO_DRAFT_PROMPTS,
  MASTER_WRITING_PROMPT_BASE,
  POST_STEP_USER_PROMPTS,
  STEP_INSTRUCTIONS,
  WEBSITE_PAGES_DISCOVERY_PROMPT,
  type AutoDraftDocType,
  type DocType,
  type PostStep,
} from './prompts';

export type PromptGroup =
  | 'Knowledge Base Interviews'
  | 'Knowledge Base Finalizers'
  | 'Post Generation'
  | 'User Message Builders'
  | 'Implementation Notes';

export interface PromptRegistryEntry {
  key: string;
  label: string;
  group: PromptGroup;
  description: string;
  defaultText: string;
  editable: boolean;
  placeholders?: string[];
}

const KB_PLACEHOLDERS = [
  'business_name',
  'website_url',
  'domain',
];

const POST_PLACEHOLDERS = [
  'business_name',
  'business_type',
  'industry',
  'service_area',
  'primary_services',
  'audience',
  'tone_summary',
  'experience_summary',
  'credentials',
  'service_facts',
  'brand_rules',
  'never_cite_competitors',
  'format_settings',
  'tldr_setting',
  'tables_setting',
  'faq_setting',
  'content_capsule_percentage',
  'content_capsule_target',
  'content_capsule_guidance',
  'post_topic',
  'target_keyword',
  'secondary_keywords',
  'main_takeaway',
  'approved_sources_summary',
  'ai_questions_summary',
  'source_search_summary',
  'outline_settings',
];

export interface PromptConfigLike {
  draft_text?: string | null;
  published_text?: string | null;
  published_version?: number | null;
}

export interface ResolvedPromptText {
  text: string;
  source: 'default' | 'published';
  publishedVersion: number;
}

export interface PromptConfigRow {
  prompt_key: string;
  draft_text: string | null;
  published_text: string | null;
  published_version: number;
  updated_by: string | null;
  updated_at: string | null;
  published_by: string | null;
  published_at: string | null;
}

export interface PromptVersionRow {
  id: string;
  prompt_key: string;
  version: number;
  prompt_text: string;
  published_by: string | null;
  published_at: string;
}

export const PROMPT_REGISTRY: PromptRegistryEntry[] = [
  ...DOC_TYPES.map((docType) => ({
    key: `interview.${docType}.system`,
    label: `${DOC_LABELS[docType]} interview`,
    group: 'Knowledge Base Interviews' as const,
    description: `System prompt used while interviewing users for ${DOC_LABELS[docType]}. Supports workspace placeholders such as {{business_name}}, {{website_url}}, and {{domain}}.`,
    defaultText: INTERVIEW_PROMPTS[docType],
    editable: true,
    placeholders: KB_PLACEHOLDERS,
  })),
  ...DOC_TYPES.map((docType) => ({
    key: `finalize.${docType}.user`,
    label: `${DOC_LABELS[docType]} finalizer`,
    group: 'Knowledge Base Finalizers' as const,
    description: `User-style finalize instruction that turns the interview transcript into the ${DOC_LABELS[docType]} document. Supports workspace placeholders such as {{business_name}}, {{website_url}}, and {{domain}}.`,
    defaultText: FINALIZE_PROMPTS[docType],
    editable: true,
    placeholders: KB_PLACEHOLDERS,
  })),
  {
    key: 'discovery.sitemap.user',
    label: 'Website Pages discovery',
    group: 'Knowledge Base Finalizers',
    description: 'Prompt that turns crawled URL/page evidence into the Website Pages KB document after the deterministic crawler has collected and context-ranked candidate pages.',
    defaultText: WEBSITE_PAGES_DISCOVERY_PROMPT,
    editable: true,
    placeholders: [...KB_PLACEHOLDERS, 'website_pages_evidence'],
  },
  ...(['tone_of_voice', 'service_details', 'brand_guidelines'] as AutoDraftDocType[]).map((docType) => ({
    key: `auto_draft.${docType}.user`,
    label: `${DOC_LABELS[docType]} website auto-draft`,
    group: 'Knowledge Base Finalizers' as const,
    description: `Prompt that turns crawled website evidence into a reviewable ${DOC_LABELS[docType]} KB draft. Supports {{website_pages_evidence}}, {{site_archetype}}, plus workspace placeholders.`,
    defaultText: KB_AUTO_DRAFT_PROMPTS[docType],
    editable: true,
    placeholders: [...KB_PLACEHOLDERS, 'website_pages_evidence', 'site_archetype'],
  })),
  {
    key: 'post.master.system',
    label: 'Master writing prompt',
    group: 'Post Generation',
    description: 'Base system prompt injected into every post-generation step before KB documents and step instructions. Supports derived writer context placeholders including {{business_name}}, {{industry}}, {{service_area}}, {{primary_services}}, {{tone_summary}}, {{never_cite_competitors}}, and writer format settings such as {{content_capsule_target}}, {{tldr_setting}}, {{tables_setting}}, and {{faq_setting}}.',
    defaultText: MASTER_WRITING_PROMPT_BASE,
    editable: true,
    placeholders: POST_PLACEHOLDERS,
  },
  ...(['research', 'outline', 'draft', 'review'] as PostStep[]).map((step) => ({
    key: `post.step.${step}.system`,
    label: `${stepLabel(step)} system step`,
    group: 'Post Generation' as const,
    description: `System instruction block for the ${stepLabel(step)} post step. Supports derived writer context placeholders such as {{business_name}}, {{industry}}, {{service_area}}, and {{never_cite_competitors}}.`,
    defaultText: STEP_INSTRUCTIONS[step],
    editable: true,
    placeholders: POST_PLACEHOLDERS,
  })),
  ...(['research', 'outline', 'draft', 'review'] as PostStep[]).map((step) => ({
    key: `post.step.${step}.user`,
    label: `${stepLabel(step)} user request`,
    group: 'User Message Builders' as const,
    description: `Editable task request appended to the generated user message for the ${stepLabel(step)} step. Supports post placeholders such as {{post_topic}}, {{target_keyword}}, {{secondary_keywords}}, {{main_takeaway}}, plus derived business and KB placeholders.`,
    defaultText: POST_STEP_USER_PROMPTS[step],
    editable: true,
    placeholders: POST_PLACEHOLDERS,
  })),
  {
    key: 'notes.source-search',
    label: 'Source search implementation',
    group: 'Implementation Notes',
    description: 'Read-only explanation of how the research step finds and filters sources.',
    defaultText: [
      'Research uses the step model resolved for the research step, defaulting to OpenRouter Perplexity Sonar Pro.',
      'The model receives the research user prompt and returns prose. OpenRouter search_results/citations are stored separately as structured source candidates.',
      'Brand Guidelines are parsed for never-cite competitors before sources are shown to the user.',
    ].join('\n'),
    editable: false,
  },
  {
    key: 'notes.ai-question-enrichment',
    label: 'AI question enrichment',
    group: 'Implementation Notes',
    description: 'Read-only explanation of how DataForSEO fan-out/PAA questions are attached.',
    defaultText: [
      'The writer normalizes the topic/target keyword into a seed.',
      'It first asks DataForSEO LLM Mentions for ChatGPT fan-out questions using US English, then falls back to Google People Also Ask/related searches.',
      'Captured questions are appended to approved source context so the outline can cover AI-search intent naturally.',
    ].join('\n'),
    editable: false,
  },
  {
    key: 'notes.kb-assembly',
    label: 'Knowledge base assembly',
    group: 'Implementation Notes',
    description: 'Read-only explanation of how custom knowledge is injected into writer prompts.',
    defaultText: [
      'Only ready KB documents for the workspace are loaded.',
      'The five document slots are injected into the system prompt as WEBSITE PAGES, TONE OF VOICE, EXPERIENCE NOTES, OFFER DETAILS, and BRAND GUIDELINES.',
      'Missing documents are represented as “not yet provided” so the writer does not treat absent knowledge as factual input.',
    ].join('\n'),
    editable: false,
  },
  {
    key: 'notes.post-processing',
    label: 'Post-processing and repair',
    group: 'Implementation Notes',
    description: 'Read-only explanation of cleanup after model output.',
    defaultText: [
      'The Worker strips wrapping markdown fences and banned typography from writing steps.',
      'Draft/review output is scanned for high-density citation-marker artifacts such as word16, )16, [16], ^16, and <sup>16</sup>.',
      'If artifact density crosses the threshold, obvious markers are removed before persistence and the API returns quality warnings to the UI.',
    ].join('\n'),
    editable: false,
  },
];

export function getPromptEntry(key: string): PromptRegistryEntry | undefined {
  return PROMPT_REGISTRY.find((entry) => entry.key === key);
}

export function resolvePromptText(defaultText: string, config: PromptConfigLike | null | undefined): ResolvedPromptText {
  const publishedText = config?.published_text?.trim();
  if (publishedText) {
    return {
      text: publishedText,
      source: 'published',
      publishedVersion: config?.published_version || 1,
    };
  }
  return { text: defaultText, source: 'default', publishedVersion: 0 };
}

export function nextPromptVersion(config: PromptConfigLike | null | undefined): number {
  return Math.max(0, config?.published_version || 0) + 1;
}

export function promptConfigMap(rows: PromptConfigRow[]): Map<string, PromptConfigRow> {
  return new Map(rows.map((row) => [row.prompt_key, row]));
}

export async function loadPromptConfigs(db: D1Database): Promise<Map<string, PromptConfigRow>> {
  const rows = await db.prepare(
    `SELECT prompt_key, draft_text, published_text, published_version,
            updated_by, updated_at, published_by, published_at
     FROM content_writer_prompt_configs`
  ).all<PromptConfigRow>();
  return promptConfigMap((rows.results || []) as PromptConfigRow[]);
}

export function resolvePromptFromMap(configs: Map<string, PromptConfigRow>, key: string, defaultText: string): ResolvedPromptText {
  return resolvePromptText(defaultText, configs.get(key));
}

export function postStepPromptKeys(step: PostStep): { master: string; system: string; user: string } {
  return {
    master: 'post.master.system',
    system: `post.step.${step}.system`,
    user: `post.step.${step}.user`,
  };
}

export function interviewPromptKey(docType: DocType): string {
  return `interview.${docType}.system`;
}

export function finalizePromptKey(docType: DocType): string {
  return `finalize.${docType}.user`;
}

function stepLabel(step: PostStep): string {
  return step.charAt(0).toUpperCase() + step.slice(1);
}
