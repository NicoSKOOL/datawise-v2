// Allocation rules for the Internal Links (Jev) tool. Ported from
// config.template.yaml in NicoSKOOL/jev-internal-links. These numbers decide
// what gets linked; Jev only supplies the judgements they are applied to.

export interface InternalLinksConfig {
  thresholds: {
    min_confidence: number;
    min_link_warranted: number;
    min_anchor_available: number;
    auto_approve_confidence: number;
  };
  weights: {
    confidence: number;
    link_warranted: number;
    anchor_available: number;
    similarity: number;
    orphan_boost: number;
    money_page_match: number;
    commercial_penalty: number;
  };
  caps: {
    max_new_links_per_source: number;
    max_new_links_per_target: number;
    target_decay: number;
    min_passages_between: number;
  };
  // Exact paths ("/pricing/"). A "ready" reader landing on one earns a bonus.
  money_pages: string[];
  // Path regexes for pages that never RECEIVE new links in their body.
  exclude_sources: string[];
  shortlist: {
    candidates_per_paragraph: number;
    min_similarity: number;
    min_words: number;
  };
}

export const DEFAULT_CONFIG: InternalLinksConfig = {
  thresholds: {
    min_confidence: 0.7,
    min_link_warranted: 0.8,
    min_anchor_available: 0.7,
    auto_approve_confidence: 0.88,
  },
  weights: {
    confidence: 1.0,
    link_warranted: 0.6,
    anchor_available: 0.4,
    similarity: 0.8,
    orphan_boost: 1.2,
    money_page_match: 0.5,
    commercial_penalty: -0.6,
  },
  caps: {
    max_new_links_per_source: 3,
    max_new_links_per_target: 8,
    target_decay: 0.75,
    min_passages_between: 2,
  },
  money_pages: ['/pricing/', '/contact/'],
  exclude_sources: [
    '^/(blog|news|novedades|articles)/$',
    '^/(tag|tags|category|categories|author|page)/',
    '^/(privacy|terms|legal|cookies?)',
  ],
  shortlist: {
    candidates_per_paragraph: 4,
    // The Python tool uses 0.25 with all-MiniLM-L6-v2. bge-m3 scores sit
    // higher: on the ghlcurso.com run (198 pages, 2026-10-02) bge-m3 at 0.45
    // kept 3.96 candidates per paragraph vs MiniLM's 3.98 at 0.25, and 95% of
    // the links Jev actually placed scored >= 0.518. KV key
    // `internal-links-min-sim` overrides this without a deploy.
    min_similarity: 0.45,
    min_words: 25,
  },
};

// "~typesafe/jev-latest" follows TypeSafe's newest release.
export const JEV_MODEL = '~typesafe/jev-latest';
export const JEV_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
// Measured in the Python tool: ~900 input tokens at $0.042/M per call.
export const JEV_COST_PER_CALL = 0.00004;
// Anchor writing cost per allocated link (DeepSeek V4 Pro with reasoning off,
// measured $0.00019 on 70 production links, 2026-10-05:
// ~560 prompt tokens + ~11 out), and the share of calls that end up allocated.
export const ANCHOR_COST_PER_LINK = 0.0002;
export const ALLOCATED_SHARE = 0.12;

export function estimateRunCost(jevCalls: number): number {
  return jevCalls * JEV_COST_PER_CALL + jevCalls * ALLOCATED_SHARE * ANCHOR_COST_PER_LINK;
}
