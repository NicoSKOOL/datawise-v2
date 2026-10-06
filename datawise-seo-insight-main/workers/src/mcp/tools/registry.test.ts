import { describe, it, expect } from 'vitest';
import { ALL_TOOLS } from './registry';

// Clients cache tools/list by position and prompt caches key on it. New
// tools are appended; existing positions never move.
describe('MCP tool registry', () => {
  it('keeps the published order', () => {
    expect(ALL_TOOLS.map((t) => t.name)).toEqual([
      'datawise_keyword_research', 'datawise_keyword_metrics', 'datawise_domain_overview', 'datawise_ranked_keywords',
      'datawise_competitors', 'datawise_keyword_gap', 'datawise_backlinks', 'datawise_ai_mentions', 'datawise_rank_tracking',
      'datawise_ai_visibility', 'datawise_local_reviews', 'datawise_search_console', 'datawise_people_also_ask', 'datawise_gbp_audit',
      'datawise_gbp_profile', 'datawise_site_pages',
    ]);
  });
  it('every tool has a description that states cost and a non-empty schema', () => {
    for (const t of ALL_TOOLS) {
      expect(t.description.length).toBeGreaterThan(80);
      expect(Object.keys(t.inputSchema.shape).length).toBeGreaterThan(0);
    }
  });
});
