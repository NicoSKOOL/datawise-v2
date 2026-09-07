import type { ToolDef } from './types';
import { keywordResearch, keywordMetrics } from './keywords';
import { domainOverview, rankedKeywords, competitors, keywordGap } from './domains';
import { backlinks } from './backlinks';
import { aiMentions } from './ai-mentions';
import { rankTracking, aiVisibility, localReviews, searchConsole } from './stored';

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
];
