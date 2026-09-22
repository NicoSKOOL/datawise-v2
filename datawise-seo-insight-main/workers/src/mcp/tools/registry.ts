import type { ToolDef } from './types';
import { keywordResearch, keywordMetrics } from './keywords';
import { domainOverview, rankedKeywords, competitors, keywordGap } from './domains';
import { backlinks } from './backlinks';
import { aiMentions } from './ai-mentions';
import { rankTracking, aiVisibility, localReviews, searchConsole } from './stored';
import { peopleAlsoAsk } from './paa';
import { gbpAudit } from './gbp-audit';
import { gbpProfile } from './gbp-profile';
import { sitePages } from './site-pages';

// Order is deliberate and stable: clients cache tools/list by position and
// prompt caches key on it (spec section 5).
export const ALL_TOOLS: ToolDef[] = [
  keywordResearch,
  keywordMetrics,
  domainOverview,
  rankedKeywords,
  competitors,
  keywordGap,
  backlinks,
  aiMentions,
  rankTracking,
  aiVisibility,
  localReviews,
  searchConsole,
  // Added 2026-09-11, appended so earlier positions stay stable.
  peopleAlsoAsk,
  gbpAudit,
  // Added 2026-09-22 (spec docs/superpowers/specs/2026-09-22-mcp-gbp-site-alignment-design.md).
  gbpProfile,
  sitePages,
];
