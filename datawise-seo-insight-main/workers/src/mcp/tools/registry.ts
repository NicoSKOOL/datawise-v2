import type { ToolDef } from './types';
import { keywordResearch, keywordMetrics } from './keywords';
import { domainOverview, rankedKeywords, competitors, keywordGap } from './domains';
import { backlinks } from './backlinks';
import { aiMentions } from './ai-mentions';
import { rankTracking, aiVisibility, localReviews, searchConsole } from './stored';
import { peopleAlsoAsk } from './paa';
import { gbpAudit } from './gbp-audit';

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
];
