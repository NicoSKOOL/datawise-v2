// Length rules mirror src/lib/meta-checker.ts on the frontend.
// Keep these in sync with TITLE_MIN/MAX, META_MIN/MAX there.
export const TITLE_MIN = 30;
export const TITLE_MAX = 60;
export const META_MIN = 70;
export const META_MAX = 160;

export type IssueType =
  | 'missing_title'
  | 'long_title'
  | 'short_title'
  | 'duplicate_title'
  | 'missing_desc'
  | 'long_desc'
  | 'short_desc';

export interface PageContext {
  h1?: string;
  h2s?: string[];
  body_excerpt?: string;
  keywords?: string;
}

export interface RewriteInput {
  url: string;
  brand: string;
  current_title: string | null;
  current_description: string | null;
  issue_type: IssueType;
  context: PageContext;
  target_keyword: string;
  user_overrode_keyword: boolean;
}

export const META_REWRITE_SYSTEM_PROMPT = `You are a senior SEO copywriter. Your job is to rewrite page titles and meta descriptions so they rank, get clicked, and accurately describe the page.

HARD RULES (no exceptions):
- Title: ${TITLE_MIN}-${TITLE_MAX} characters. Aim for 50-58.
- Meta description: ${META_MIN}-${META_MAX} characters. Aim for 145-158.
- The target keyword must appear naturally in the first ${TITLE_MAX} characters of the title.
- The target keyword should appear once in the description, ideally in the first 100 characters.
- Description must contain a verb that implies user action or benefit (e.g. learn, compare, find, get, discover, build, run, track).
- Sentence case for both. No ALL CAPS. No emoji. No clickbait ("you won't believe", "shocking", "this one trick").
- If the current title contains a brand suffix pattern like " | Brand" or " - Brand", preserve a similar suffix using the supplied brand. Otherwise do not invent a suffix.
- Do NOT invent facts, prices, dates, statistics, or features that are not present in the supplied page context. Stay grounded in the H1, H2s, and body excerpt.
- If the page context is sparse, write a conservative, generic-but-accurate title and description rather than inventing specifics.

OUTPUT FORMAT:
Return ONLY a single JSON object with these exact keys, no prose, no code fences:
{
  "title": string,
  "description": string,
  "target_keyword": string,
  "reasoning": string
}
"reasoning" is one or two sentences explaining the choice (what the previous version got wrong, why the new keyword/angle, etc.). Keep it under 280 characters.`;

function summarizeIssue(issue: IssueType, currentTitle: string | null, currentDesc: string | null): string {
  switch (issue) {
    case 'missing_title':
      return 'Page has NO title tag. Write one from scratch grounded in the page content.';
    case 'long_title':
      return `Current title is too long (${currentTitle ? [...currentTitle].length : 0} chars). Tighten while keeping the core meaning.`;
    case 'short_title':
      return `Current title is too short (${currentTitle ? [...currentTitle].length : 0} chars). Expand with intent qualifiers grounded in the page content; do not pad with filler.`;
    case 'duplicate_title':
      return 'This title is duplicated across multiple pages. Make it specific to THIS page using its H1 and content.';
    case 'missing_desc':
      return 'Page has NO meta description. Write one from scratch grounded in the page content.';
    case 'long_desc':
      return `Current description is too long (${currentDesc ? [...currentDesc].length : 0} chars). Tighten while preserving the core promise and CTA.`;
    case 'short_desc':
      return `Current description is too short (${currentDesc ? [...currentDesc].length : 0} chars). Expand with a benefit and a soft CTA grounded in the page content.`;
  }
}

export function buildUserPrompt(input: RewriteInput): string {
  const { url, brand, current_title, current_description, issue_type, context, target_keyword, user_overrode_keyword } = input;
  const h2List = (context.h2s || []).slice(0, 6);
  const body = (context.body_excerpt || '').slice(0, 800);

  const lines: string[] = [];
  lines.push(`URL: ${url}`);
  lines.push(`Brand: ${brand}`);
  lines.push(`Issue to fix: ${issue_type}`);
  lines.push(`Diagnosis: ${summarizeIssue(issue_type, current_title, current_description)}`);
  lines.push('');
  lines.push(`Current title: ${current_title ? JSON.stringify(current_title) : '(none)'}`);
  lines.push(`Current description: ${current_description ? JSON.stringify(current_description) : '(none)'}`);
  lines.push('');
  lines.push('--- Page context ---');
  lines.push(`H1: ${context.h1 || '(none detected)'}`);
  if (h2List.length) {
    lines.push('H2s:');
    for (const h of h2List) lines.push(`  - ${h}`);
  } else {
    lines.push('H2s: (none detected)');
  }
  if (context.keywords) lines.push(`Meta keywords: ${context.keywords}`);
  lines.push('Body excerpt (first ~800 chars, plain text):');
  lines.push(body || '(no body text extracted)');
  lines.push('');
  lines.push(`Target keyword: ${target_keyword}${user_overrode_keyword ? ' (user-supplied — must use)' : ' (inferred — adjust if a clearly better one fits the content)'}`);
  lines.push('');
  lines.push('Rewrite the title AND description, even if only one was flagged. They must work as a pair. Return JSON only.');

  return lines.join('\n');
}

export function buildLengthRetryPrompt(
  prevTitle: string,
  prevDesc: string,
  problems: string[],
): string {
  return `Your previous response broke length rules:
${problems.map((p) => `- ${p}`).join('\n')}

Previous title (${[...prevTitle].length} chars): ${JSON.stringify(prevTitle)}
Previous description (${[...prevDesc].length} chars): ${JSON.stringify(prevDesc)}

Rewrite ONLY the fields that violate the rules. Keep the meaning and the target keyword. Return the same JSON shape with ALL four keys (title, description, target_keyword, reasoning).`;
}
