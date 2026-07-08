import type { KBContext } from './prompts';
import { extractNeverCiteTerms } from './source-filter';

export interface WriterPromptWorkspace {
  name?: string | null;
  website_url?: string | null;
}

export interface WriterPromptBrief {
  topic?: string | null;
  target_keyword?: string | null;
  secondary_keywords?: string | null;
  takeaway?: string | null;
  notes?: string | null;
  include_tables?: boolean;
  include_tldr?: boolean;
  include_faq?: boolean;
  capsule_pct?: number;
}

export interface WriterPromptContextInput {
  workspace?: WriterPromptWorkspace | null;
  brief?: WriterPromptBrief | null;
  kb?: KBContext | null;
  priorContext?: {
    sources?: string;
    outline?: string;
    draft?: string;
  };
  metadata?: Record<string, unknown>;
  now?: Date;
  /**
   * Client's local calendar date (YYYY-MM-DD). The worker only knows UTC, so
   * without this a user ahead of UTC gets yesterday's date baked into
   * generated documents (bug 56bd3cb3). Takes precedence over `now`.
   */
  currentDate?: string;
}

export interface WriterPromptContext {
  values: Record<string, string>;
  fallbackKeys: string[];
}

export interface RenderedPromptTemplate {
  text: string;
  placeholders: string[];
  placeholder_warnings: string[];
}

const FALLBACKS: Record<string, string> = {
  business_name: 'the business',
  business_type: 'local service business',
  website_url: 'the business website',
  domain: 'the business website',
  industry: 'the relevant industry',
  service_area: 'the target service area',
  primary_services: 'the services, features, products, or offers described in Offer Details',
  audience: 'the target customers',
  tone_summary: 'the provided tone of voice',
  experience_summary: 'the provided experience notes',
  credentials: 'the provided credentials',
  service_facts: 'the provided offer details',
  brand_rules: 'the provided brand guidelines',
  never_cite_competitors: 'competitors excluded by Brand Guidelines',
  format_settings: 'TL;DR: include; Tables: allowed; FAQ: include; Content Capsule target: 65%',
  tldr_setting: 'include a TL;DR block at the top',
  tables_setting: 'allow markdown tables when they make comparisons clearer',
  faq_setting: 'include a final FAQ section',
  content_capsule_percentage: '65%',
  content_capsule_target: 'roughly 65% of H2 sections use the Content Capsule technique',
  content_capsule_guidance: 'Aim for roughly 65% of H2 sections to use the Content Capsule format. The rest should use natural narrative, storytelling, or step-by-step explanation.',
  approved_sources_summary: 'the approved source list',
  ai_questions_summary: 'the captured AI search questions',
  source_search_summary: 'the source-search metadata',
  outline_settings: 'the outline format settings',
  website_pages_evidence: 'sample crawled page evidence',
  site_archetype: 'mixed',
  post_topic: 'the post topic',
  topic: 'the post topic',
  target_keyword: 'the target keyword',
  secondary_keywords: 'the secondary keywords',
  main_takeaway: 'the intended takeaway',
  takeaway: 'the intended takeaway',
  notes: 'the post notes',
  current_date: 'the current date',
};

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function buildWriterPromptContext(input: WriterPromptContextInput): WriterPromptContext {
  const kb = input.kb || {};
  const brief = input.brief || {};
  const workspace = input.workspace || {};
  const metadata = input.metadata || {};
  const now = input.now instanceof Date && !isNaN(input.now.getTime()) ? input.now : new Date();

  const values: Record<string, string> = {};
  const fallbackKeys = new Set<string>();

  const set = (key: string, value: unknown) => {
    const clean = normalizeValue(value);
    if (clean) values[key] = clean;
  };
  const setFallback = (key: string, value: string) => {
    if (values[key]) return;
    values[key] = value;
    fallbackKeys.add(key);
  };

  const clientDate = typeof input.currentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.currentDate)
    ? input.currentDate
    : null;
  set('current_date', clientDate ?? now.toISOString().slice(0, 10));
  set('business_name', findFirst([
    extractLineValue(kb.brand_guidelines, ['business name', 'exact name']),
    extractLineValue(kb.service_details, ['business name']),
    extractLineValue(kb.experience_notes, ['business name']),
    workspace.name,
  ]));
  set('website_url', workspace.website_url);
  set('domain', cleanDomain(workspace.website_url || ''));

  set('business_type', findFirst([
    extractLineValue(kb.service_details, ['business type', 'what they sell', 'what the business does']),
    extractLineValue(kb.experience_notes, ['business type', 'what they do']),
    inferBusinessType(kb.service_details),
  ]));
  set('industry', findFirst([
    extractLineValue(kb.service_details, ['industry']),
    extractLineValue(kb.brand_guidelines, ['industry']),
    inferIndustry(kb.service_details || kb.experience_notes || ''),
  ]));
  set('service_area', findFirst([
    extractLineValue(kb.service_details, ['locations / service area', 'service area', 'locations']),
    extractLineValue(kb.brand_guidelines, ['service area', 'locations']),
  ]));
  set('primary_services', findFirst([
    extractLineValue(kb.service_details, ['primary services', 'services']),
    summarizeBullets(kb.service_details, ['OFFER LIST', 'OFFERS', 'SERVICE LIST', 'SERVICES'], 5),
  ]));
  set('audience', findFirst([
    extractLineValue(kb.service_details, ['audience', 'who it is for', 'customers']),
    extractLineValue(kb.tone_of_voice, ['audience']),
  ]));
  set('tone_summary', findFirst([
    extractSectionAfterHeading(kb.tone_of_voice, 'ONE-LINE SUMMARY'),
    firstMeaningfulLine(kb.tone_of_voice),
  ]));
  set('experience_summary', findFirst([
    extractSectionAfterHeading(kb.experience_notes, 'SUMMARY'),
    firstMeaningfulLine(kb.experience_notes),
  ]));
  set('credentials', findFirst([
    extractLineValue(kb.experience_notes, ['credentials', 'qualifications', 'certifications']),
    extractLineValue(kb.service_details, ['credentials', 'licensing', 'licenses']),
  ]));
  set('service_facts', findFirst([
    summarizeBullets(kb.service_details, ['PRICING', 'OFFER DETAILS', 'SERVICE DETAILS', 'COMMON FAQ'], 6),
    firstMeaningfulLine(kb.service_details),
  ]));
  set('brand_rules', findFirst([
    summarizeBullets(kb.brand_guidelines, ['FORBIDDEN', 'BRAND RULES', 'FORMATTING RULES', 'COMPETITOR'], 6),
    firstMeaningfulLine(kb.brand_guidelines),
  ]));

  const excluded = extractNeverCiteTerms(kb.brand_guidelines);
  set('never_cite_competitors', excluded.join(', '));

  set('post_topic', brief.topic);
  set('topic', brief.topic);
  set('target_keyword', brief.target_keyword);
  set('secondary_keywords', brief.secondary_keywords);
  set('main_takeaway', brief.takeaway);
  set('takeaway', brief.takeaway);
  set('notes', brief.notes);

  set('approved_sources_summary', input.priorContext?.sources);
  set('ai_questions_summary', extractAiQuestionsSummary(input.priorContext?.sources));
  set('source_search_summary', summarizeJson(metadata.source_search));
  set('website_pages_evidence', typeof metadata.website_pages_evidence === 'string' ? metadata.website_pages_evidence : '');
  set('site_archetype', typeof metadata.site_archetype === 'string' ? metadata.site_archetype : '');
  const formatSettings = normalizeFormatSettings(metadata.outline_settings, brief);
  set('outline_settings', summarizeOutlineSettings(formatSettings));
  set('format_settings', summarizeOutlineSettings(formatSettings));
  set('tldr_setting', describeTldrSetting(formatSettings.include_tldr));
  set('tables_setting', describeTablesSetting(formatSettings.include_tables));
  set('faq_setting', describeFaqSetting(formatSettings.include_faq));
  set('content_capsule_percentage', `${formatSettings.capsule_pct}%`);
  set('content_capsule_target', describeCapsuleTarget(formatSettings.capsule_pct));
  set('content_capsule_guidance', describeCapsuleGuidance(formatSettings.capsule_pct));

  for (const [key, fallback] of Object.entries(FALLBACKS)) {
    setFallback(key, fallback);
  }

  return { values, fallbackKeys: [...fallbackKeys] };
}

export function renderPromptTemplate(template: string, context: WriterPromptContext): RenderedPromptTemplate {
  const seen = new Set<string>();
  const warnings = new Set<string>();
  const text = template.replace(PLACEHOLDER_RE, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    seen.add(key);
    const value = context.values[key] || FALLBACKS[key] || '';
    if (!context.values[key] || context.fallbackKeys.includes(key)) {
      warnings.add(`${key} not found, using fallback.`);
    }
    return value;
  });

  return {
    text,
    placeholders: [...seen],
    placeholder_warnings: [...warnings],
  };
}

export function detectPromptPlaceholders(template: string): string[] {
  const placeholders = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    placeholders.add(match[1].toLowerCase());
  }
  return [...placeholders];
}

function normalizeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function findFirst(values: unknown[]): string {
  for (const value of values) {
    const clean = normalizeValue(value);
    if (clean) return clean;
  }
  return '';
}

function extractLineValue(text: string | null | undefined, labels: string[]): string {
  if (!text) return '';
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^[-*]\s*/, '').trim();
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const label = line.slice(0, idx).trim().toLowerCase();
    if (!normalizedLabels.includes(label)) continue;
    return line.slice(idx + 1).trim();
  }
  return '';
}

function extractSectionAfterHeading(text: string | null | undefined, heading: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  const idx = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  if (idx === -1) return '';
  for (const line of lines.slice(idx + 1)) {
    const clean = line.replace(/^[-*]\s*/, '').trim();
    if (clean) return clean;
  }
  return '';
}

function firstMeaningfulLine(text: string | null | undefined): string {
  if (!text) return '';
  for (const line of text.split('\n')) {
    const clean = line.replace(/^[-*#]+\s*/, '').trim();
    if (clean && !/^[A-Z /&-]{5,}$/.test(clean)) return clean;
  }
  return '';
}

function summarizeBullets(text: string | null | undefined, headings: string[], maxItems: number): string {
  if (!text) return '';
  const lowerHeadings = headings.map((heading) => heading.toLowerCase());
  const lines = text.split('\n');
  let active = lowerHeadings.length === 0;
  const out: string[] = [];

  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;
    if (/^[A-Z0-9 /&()'-]{5,}$/.test(clean)) {
      active = lowerHeadings.some((heading) => clean.toLowerCase().includes(heading));
      continue;
    }
    if (!active) continue;
    if (/^[-*]\s+/.test(clean)) out.push(clean.replace(/^[-*]\s+/, ''));
    if (out.length >= maxItems) break;
  }

  return out.join('; ');
}

function inferBusinessType(text: string | null | undefined): string {
  const services = extractLineValue(text, ['primary services', 'services']);
  if (!services) return '';
  const first = services.split(',')[0]?.trim();
  return first ? `${first} provider` : '';
}

function inferIndustry(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('plumb')) return 'plumbing';
  if (lower.includes('hvac') || lower.includes('air conditioning') || lower.includes('heating')) return 'HVAC';
  if (lower.includes('roof')) return 'roofing';
  if (lower.includes('mortgage')) return 'mortgage and real estate finance';
  if (lower.includes('real estate')) return 'real estate';
  return '';
}

function cleanDomain(url: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^(sc-domain:|https?:\/\/|www\.)/, '').replace(/\/+$/, '');
  }
}

function extractAiQuestionsSummary(sources: string | undefined): string {
  if (!sources?.includes('AI search questions to answer')) return '';
  return sources
    .split('\n')
    .filter((line) => line.trim().startsWith('- '))
    .slice(0, 8)
    .map((line) => line.replace(/^-\s+/, '').trim())
    .join('; ');
}

function summarizeJson(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const pairs = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  return pairs.join('; ');
}

interface NormalizedFormatSettings {
  include_tldr: boolean;
  include_tables: boolean;
  include_faq: boolean;
  capsule_pct: number;
}

function normalizeFormatSettings(value: unknown, brief: WriterPromptBrief): NormalizedFormatSettings {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    include_tldr: normalizeBoolean(settings.include_tldr, brief.include_tldr ?? true),
    include_tables: normalizeBoolean(settings.include_tables, brief.include_tables ?? true),
    include_faq: normalizeBoolean(settings.include_faq, brief.include_faq ?? true),
    capsule_pct: normalizePercentage(settings.capsule_pct, brief.capsule_pct ?? 65),
  };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const clean = value.trim().toLowerCase();
    if (['true', 'yes', 'include', 'allowed', '1'].includes(clean)) return true;
    if (['false', 'no', 'skip', 'disallow', 'not allowed', '0'].includes(clean)) return false;
  }
  return fallback;
}

function normalizePercentage(value: unknown, fallback: number): number {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace('%', '')) : fallback;
  if (!Number.isFinite(raw)) return 65;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function summarizeOutlineSettings(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const settings = value as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof settings.include_tldr === 'boolean') parts.push(`TL;DR: ${settings.include_tldr ? 'include' : 'skip'}`);
  if (typeof settings.include_tables === 'boolean') parts.push(`Tables: ${settings.include_tables ? 'allowed' : 'not allowed'}`);
  if (typeof settings.include_faq === 'boolean') parts.push(`FAQ: ${settings.include_faq ? 'include' : 'skip'}`);
  if (typeof settings.capsule_pct === 'number') parts.push(`Capsule target: ${settings.capsule_pct}%`);
  return parts.join('; ');
}

function describeTldrSetting(include: boolean): string {
  return include
    ? 'include a TL;DR block at the top with 3 to 5 concise takeaways'
    : 'skip the TL;DR block entirely';
}

function describeTablesSetting(include: boolean): string {
  return include
    ? 'allow markdown tables when a comparison, specification list, or grid is clearer than prose'
    : 'do not use markdown tables; render comparisons as bullets or short paragraphs';
}

function describeFaqSetting(include: boolean): string {
  return include
    ? 'include a final FAQ section with reader questions not already answered directly in the body'
    : 'skip the final FAQ section';
}

function describeCapsuleTarget(pct: number): string {
  if (pct <= 0) return '0% of H2 sections use the Content Capsule technique';
  if (pct >= 100) return '100% of H2 sections use the Content Capsule technique';
  return `roughly ${pct}% of H2 sections use the Content Capsule technique`;
}

function describeCapsuleGuidance(pct: number): string {
  if (pct <= 0) {
    return 'Do not use the Content Capsule technique on H2 sections. Write sections in natural narrative, storytelling, or step-by-step explanation unless the user manually marks a section otherwise.';
  }
  if (pct >= 100) {
    return 'Use the Content Capsule format on every H2 section: question-style heading, direct first-sentence answer, then supporting detail.';
  }
  return `Aim for roughly ${pct}% of H2 sections to use the Content Capsule format. The rest should use natural narrative, storytelling, or step-by-step explanation.`;
}
