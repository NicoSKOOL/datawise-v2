// Rule-based "What to do" recommendations for the AI Search Visibility panel.
// Pure module: no Env, no D1, fully unit-tested. See
// docs/specs/2026-06-10-ai-visibility-panel-redesign.md for the rule table.

export interface RecCitation { domain: string; url: string | null; position: number }
export interface EngineCheck {
  engine: string;
  status: 'cited' | 'mentioned' | 'absent' | 'no_answer' | 'error';
  citation_position: number | null;
  citations: RecCitation[];
}
export interface Recommendation { title: string; body: string; priority: 'high' | 'medium' | 'low' }

const ENGINE_LABELS: Record<string, string> = {
  google_ai_mode: 'Google AI Mode', chatgpt: 'ChatGPT', perplexity: 'Perplexity',
};
const COMMUNITY_DOMAINS = ['reddit.com', 'quora.com', 'news.ycombinator.com'];
const DIRECTORY_DOMAINS = ['g2.com', 'capterra.com', 'clutch.co', 'trustpilot.com', 'yelp.com', 'producthunt.com'];
const LISTICLE_PATTERN = /best|top-|top\d|[-/]vs[-/]|comparison|tools|alternatives/i;

export type CitationCategory = 'listicle' | 'community' | 'directory' | 'editorial';

export function classifyCitationUrl(domain: string, url: string | null): CitationCategory {
  const d = domain.replace(/^www\./, '');
  if (COMMUNITY_DOMAINS.some(c => d === c || d.endsWith(`.${c}`))) return 'community';
  if (DIRECTORY_DOMAINS.some(c => d === c || d.endsWith(`.${c}`))) return 'directory';
  if (url) {
    try {
      const path = new URL(url).pathname;
      if (LISTICLE_PATTERN.test(path)) return 'listicle';
    } catch { /* fall through */ }
  }
  return 'editorial';
}

function label(engine: string): string { return ENGINE_LABELS[engine] || engine; }

function isUserDomain(domain: string, userDomain?: string): boolean {
  if (!userDomain) return false;
  const clean = (d: string) => d.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  const a = clean(domain);
  const b = clean(userDomain);
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function absentPlay(query: string, check: EngineCheck): Recommendation {
  const cites = check.citations.slice(0, 5);
  const byCategory = new Map<CitationCategory, RecCitation[]>();
  for (const c of cites) {
    const cat = classifyCitationUrl(c.domain, c.url);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(c);
  }
  let dominant: CitationCategory = 'editorial';
  let max = 0;
  for (const [cat, list] of byCategory) {
    if (list.length > max) { max = list.length; dominant = cat; }
  }
  const domains = (byCategory.get(dominant) || []).map(c => c.domain).slice(0, 3).join(', ');
  const title = `Win the ${label(check.engine)} citation`;
  let body: string;
  switch (dominant) {
    case 'listicle':
      body = `${label(check.engine)} cites comparison and listicle pages for this query (${domains}). Publish a comparison page targeting "${query}" with a feature table and a visible update date.`;
      break;
    case 'community':
      body = `${label(check.engine)} is citing community threads (${domains}). Participate in the cited threads with a substantive answer that references your page.`;
      break;
    case 'directory':
      body = `${label(check.engine)} cites review and directory listings here. Get or strengthen your listing on ${domains}.`;
      break;
    default:
      body = `${label(check.engine)} cites long-form editorial pages (${domains}). Publish an in-depth guide answering "${query}" with answer capsules and sourced stats.`;
  }
  if (cites.length === 0) {
    body = `${label(check.engine)} returned an answer without citing anyone for "${query}". Add citable stats and an FAQ block to your most relevant page so there is something to cite.`;
  }
  return { title, body, priority: 'high' };
}

export function buildRecommendation(query: string, checks: EngineCheck[], userDomain?: string): Recommendation {
  const usable = checks.filter(c => c.status !== 'error');
  if (!usable.length) {
    return { title: 'No checks yet', body: 'Run a check to get recommendations for this query.', priority: 'low' };
  }

  const absent = usable.find(c => c.status === 'absent');
  if (absent) return absentPlay(query, absent);

  const mentioned = usable.find(c => c.status === 'mentioned');
  if (mentioned) {
    return {
      title: `Turn the ${label(mentioned.engine)} mention into a citation`,
      body: `The AI knows your brand but has no source worth linking. Add citable stats, an FAQ block, and answer capsules to your most relevant page for "${query}" so engines have something to cite.`,
      priority: 'high',
    };
  }

  const low = usable.find(c => c.status === 'cited' && (c.citation_position ?? 99) > 3);
  if (low) {
    const own = low.citations.find(c => c.position === low.citation_position);
    const url = own?.url ? ` (${own.url})` : '';
    return {
      title: `Climb the ${label(low.engine)} citations`,
      body: `You are cited at #${low.citation_position} on ${label(low.engine)}. Refresh the cited page${url}, add original data, and tighten the answer capsule for "${query}" to improve your citation rank.`,
      priority: 'medium',
    };
  }

  const cited = usable.find(c => c.status === 'cited');
  if (cited) {
    const rival = cited.citations.find(c => !isUserDomain(c.domain, userDomain));
    return {
      title: 'Defend this query',
      body: `You are cited in the top 3. Keep the cited page fresh${rival ? `; ${rival.domain} is also being cited and could overtake you` : ''}.`,
      priority: 'low',
    };
  }

  return {
    title: 'No AI answer for this query',
    body: 'None of the checked engines currently return an AI answer here. No action needed; we keep monitoring.',
    priority: 'low',
  };
}
