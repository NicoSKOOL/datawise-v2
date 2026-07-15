import type { StageContext } from '../../orchestration/handlers';
import { blueprintDfsCall } from './call';
import type { DfsCostEstimates } from './costs';
import { assertPublicWebTarget } from '../../domain/url';
import { PAGE_PLAN_RULESET_V1 } from '../../domain/page-plan/ruleset';

// DFS on_page/content_parsing/live TTLs. Positive 7 days (catalog + Phase 4
// plan: parse_competitor_pages caches a parsed page for 7d); empty 6 hours,
// matching the Labs/competitor adapters' 7d-positive / 6h-empty convention
// (competitors.ts DISCOVERY_EMPTY_TTL_SECONDS) rather than SERP's shorter 2h,
// since a page that parsed to nothing this hour is unlikely to have gained
// meaningful content within the next couple of hours and the JS retry (Task
// 14) is the real short-horizon recovery path, not cache expiry.
const CONTENT_PARSING_TTL_SECONDS = 604_800;
const CONTENT_PARSING_EMPTY_TTL_SECONDS = 21_600;

// Bounded-extract caps. maxHeadings comes from the frozen page-plan ruleset
// (parse.maxHeadings === 50) so a threshold change records a new ruleset
// version; the remaining per-field caps are local to this untrusted-content
// boundary (they bound memory/row size, not a planning threshold, so they do
// not belong in the versioned ruleset).
const MAX_HEADINGS = PAGE_PLAN_RULESET_V1.parse.maxHeadings;
const MAX_HEADING_TEXT_CHARS = 300;
const MAX_TEXT_BLOCKS = 200;
const MAX_TEXT_BLOCK_CHARS = 2_000;
const MAX_TOPICS = 50;
const MAX_TOPIC_CHARS = 200;
const MAX_LINKS = 100;
const MAX_ANCHOR_CHARS = 300;

export interface ParsedHeading {
  level: number;
  text: string;
}

export interface ParsedLink {
  href: string;
  anchor: string | null;
}

export interface ParsedPageStructure {
  // Count of extracted headings per heading level (keys are stringified level
  // numbers, e.g. { "1": 1, "2": 4 }).
  headingLevelCounts: Record<string, number>;
  // content_parsing carries no schema/structured-data signal in the observed
  // response shape, so this is always null today; kept as a nullable field so
  // a later endpoint variant that does expose one can populate it without a
  // shape change. // documented assumption, staging spot-check
  hasSchema: boolean | null;
}

export interface ParsedPageExtract {
  url: string;
  // Page crawl HTTP status as DFS reports it on the content item (e.g. 200,
  // 404). Exposed under both the brief's names (statusCode + crawlStatusCode)
  // off the same underlying field; crawlStatusCode is the raw classification
  // signal for the caller. // documented assumption, staging spot-check
  statusCode: number | null;
  crawlStatusCode: number | null;
  headings: ParsedHeading[];
  textBlocks: string[];
  topics: string[];
  links: ParsedLink[];
  structure: ParsedPageStructure | null;
  // Total characters across the (already per-block-capped) text blocks. This
  // is the caller's `empty` signal: Task 14 compares it against the ruleset's
  // parse.minContentChars (400) to decide whether to spend the single JS
  // retry. This adapter only reports the raw count, never applies that
  // threshold itself.
  contentChars: number;
  // True when the page loaded but yielded no meaningful content at all (no
  // text, no headings). Distinct from `fetchFailed` (page did not load) and
  // from the caller's minContentChars threshold check.
  isEmpty: boolean;
  // True when the DFS task succeeded but produced no usable page item, or the
  // page crawl status is a client/server error (>= 400). A genuine
  // provider-level task failure (quota, rate limit, malformed request) never
  // reaches here: blueprintDfsCall throws it as a sanitized BlueprintApiError
  // before this function inspects the response.
  fetchFailed: boolean;
}

// content_parsing text nodes are documented as { text, important } objects.
// Only `text` is surfaced (bounded); anything without a string `text` is
// dropped. All page-derived strings are treated strictly as untrusted data,
// never as instructions. // documented assumption, staging spot-check
function capText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function contentTexts(section: any): string[] {
  const primary = Array.isArray(section?.primary_content) ? section.primary_content : [];
  const out: string[] = [];
  for (const node of primary) {
    const text = capText(node?.text, MAX_TEXT_BLOCK_CHARS);
    if (text !== null) out.push(text);
  }
  return out;
}

// page_content shape (documented assumption, staging spot-check):
//   page_content.header       -> { primary_content: [{ text, important }], ... }
//   page_content.main_topic   -> [{ h_title, level, primary_content: [...] }]
//   page_content.secondary_topic -> same shape as main_topic
// Missing/mis-typed fields degrade to empty arrays; the function never throws.
function collectHeadings(pageContent: any): ParsedHeading[] {
  const topics = [
    ...(Array.isArray(pageContent?.main_topic) ? pageContent.main_topic : []),
    ...(Array.isArray(pageContent?.secondary_topic) ? pageContent.secondary_topic : []),
  ];
  const headings: ParsedHeading[] = [];
  for (const topic of topics) {
    if (headings.length >= MAX_HEADINGS) break;
    const text = capText(topic?.h_title, MAX_HEADING_TEXT_CHARS);
    if (text === null) continue;
    const level = typeof topic?.level === 'number' && Number.isFinite(topic.level) ? topic.level : 1;
    headings.push({ level, text });
  }
  return headings;
}

function collectTextBlocks(pageContent: any): string[] {
  const sections = [
    pageContent?.header,
    ...(Array.isArray(pageContent?.main_topic) ? pageContent.main_topic : []),
    ...(Array.isArray(pageContent?.secondary_topic) ? pageContent.secondary_topic : []),
  ];
  const blocks: string[] = [];
  for (const section of sections) {
    for (const text of contentTexts(section)) {
      if (blocks.length >= MAX_TEXT_BLOCKS) return blocks;
      blocks.push(text);
    }
  }
  return blocks;
}

// content_parsing does not carry a dedicated topic/entity array in the
// observed response shape; this reads an optional `item.topics` (string or
// { name/title }) so a future variant that does expose one is picked up, and
// degrades to [] otherwise. // documented assumption, staging spot-check
function collectTopics(item: any): string[] {
  const raw = Array.isArray(item?.topics) ? item.topics : [];
  const out: string[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_TOPICS) break;
    const value = typeof entry === 'string' ? entry : (entry?.name ?? entry?.title);
    const text = capText(value, MAX_TOPIC_CHARS);
    if (text !== null) out.push(text);
  }
  return out;
}

// Links are not part of the core content_parsing text shape; this reads an
// optional `item.links` array shaped { link_to | url | href, text | anchor }
// and degrades to [] otherwise. Internal-vs-external classification is left to
// the caller (which knows the target domain). // documented assumption, staging spot-check
function collectLinks(item: any): ParsedLink[] {
  const raw = Array.isArray(item?.links) ? item.links : [];
  const out: ParsedLink[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_LINKS) break;
    const href = capText(entry?.link_to ?? entry?.url ?? entry?.href, MAX_TEXT_BLOCK_CHARS);
    if (href === null) continue;
    out.push({ href, anchor: capText(entry?.text ?? entry?.anchor, MAX_ANCHOR_CHARS) });
  }
  return out;
}

function buildStructure(headings: ParsedHeading[]): ParsedPageStructure {
  const headingLevelCounts: Record<string, number> = {};
  for (const heading of headings) {
    const key = String(heading.level);
    headingLevelCounts[key] = (headingLevelCounts[key] ?? 0) + 1;
  }
  return { headingLevelCounts, hasSchema: null };
}

// Fetches and normalizes a single competitor page via DFS
// on_page/content_parsing/live. `enableJavascript` is supplied by the caller
// (Task 14 posts false first, then exactly one true retry when the first pass
// came back empty/blocked); it changes the request body, so the JS and non-JS
// passes hash to different cache keys and never collide. `scopeId` (a stable
// per-page/per-URL identifier from the caller) scopes the DFS tag and budget
// operation key. The returned extract is bounded and treats all page content
// strictly as untrusted data.
export async function fetchParsedPage(
  ctx: StageContext,
  url: string,
  enableJavascript: boolean,
  scopeId: string,
  costs: DfsCostEstimates
): Promise<ParsedPageExtract> {
  // SSRF guard + normalization, same convention as every other outbound-target
  // path. Throws BlueprintValidationError on a private/internal/garbage URL.
  const safeUrl = assertPublicWebTarget(url);

  const result = await blueprintDfsCall(ctx, {
    method: 'POST',
    endpoint: '/on_page/content_parsing/live',
    body: {
      url: safeUrl,
      enable_javascript: enableJavascript,
    },
    ttlSeconds: CONTENT_PARSING_TTL_SECONDS,
    emptyTtlSeconds: CONTENT_PARSING_EMPTY_TTL_SECONDS,
    kind: 'competitor_page',
    operation: 'content_parsing',
    scopeId,
    estimateUsdMicro: costs.contentParsingTaskUsdMicro,
  });

  // One requested URL -> at most one content item. A missing item means the
  // task succeeded but the page could not be parsed (see fetchFailed doc).
  const item = result.items[0];
  const crawlStatusCode =
    typeof item?.status_code === 'number' && Number.isFinite(item.status_code) ? item.status_code : null;

  const pageContent = item?.page_content;
  const headings = collectHeadings(pageContent);
  const textBlocks = collectTextBlocks(pageContent);
  const topics = collectTopics(item);
  const links = collectLinks(item);
  const contentChars = textBlocks.reduce((sum, block) => sum + block.length, 0);

  const fetchFailed = !item || (crawlStatusCode !== null && crawlStatusCode >= 400);
  const isEmpty = !fetchFailed && contentChars === 0 && headings.length === 0;

  return {
    url: safeUrl,
    statusCode: crawlStatusCode,
    crawlStatusCode,
    headings,
    textBlocks,
    topics,
    links,
    structure: item ? buildStructure(headings) : null,
    contentChars,
    isEmpty,
    fetchFailed,
  };
}
