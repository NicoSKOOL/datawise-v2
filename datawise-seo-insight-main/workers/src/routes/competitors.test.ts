import { describe, it, expect } from 'vitest';
import { buildGapAnalysisPrompt } from './competitors';

// The gap-analysis "AI Powered Insights" button used to call a Supabase edge
// function (keyword-analysis-ai) whose Lovable LLM key was removed during the
// Cloudflare migration, so every click returned 500 "AI service not configured"
// (bug bfe5d249, kevgraffiti@gmail.com). The analysis now runs server-side in
// the Worker via getLLMProvider. buildGapAnalysisPrompt is the pure,
// deterministic prompt builder — the only part worth unit-testing (the LLM
// call itself is network I/O). It mirrors the original Supabase prompt so the
// output UX is unchanged.
describe('buildGapAnalysisPrompt', () => {
  const base = {
    my_domain: 'mysite.com',
    competitor_domain: 'rival.com',
    both_ranking: [
      { keyword: 'seo tools', my_position: 4, competitor_position: 2, search_volume: 1000 },
    ],
    gaps: [
      { keyword: 'best seo software', search_volume: 5000, cpc: 3.2, competition: 0.6, competitor_position: 3 },
    ],
    advantages: [
      { keyword: 'my unique term', my_position: 1, search_volume: 200 },
    ],
  };

  it('includes both domains and the required strategy section headers', () => {
    const p = buildGapAnalysisPrompt(base);
    expect(p).toContain('mysite.com');
    expect(p).toContain('rival.com');
    expect(p).toContain('Key Opportunities');
    expect(p).toContain('Competitive Analysis');
    expect(p).toContain('Priority Recommendations');
    expect(p).toContain('Market Insights');
    expect(p).toContain('Action Items');
  });

  it('lists the top gap keyword with human-formatted metrics', () => {
    const p = buildGapAnalysisPrompt(base);
    expect(p).toContain('best seo software');
    expect(p).toContain('5,000'); // search_volume via toLocaleString
    expect(p).toContain('$3.20'); // cpc
    expect(p).toContain('60%'); // competition (0.6 -> 60%)
  });

  it('handles empty arrays without throwing', () => {
    const p = buildGapAnalysisPrompt({
      my_domain: 'a.com',
      competitor_domain: 'b.com',
      both_ranking: [],
      gaps: [],
      advantages: [],
    });
    expect(p).toContain('a.com');
    expect(p).toContain('b.com');
    expect(p).toContain('No gaps found');
  });

  it('handles missing/undefined arrays defensively', () => {
    const p = buildGapAnalysisPrompt({ my_domain: 'a.com', competitor_domain: 'b.com' } as any);
    expect(typeof p).toBe('string');
    expect(p).toContain('a.com');
    expect(p).toContain('Shared Keywords (both ranking): 0');
  });

  it('caps the gaps list at 10 to bound prompt/token size', () => {
    const manyGaps = Array.from({ length: 25 }, (_, i) => ({
      keyword: `gapkw${i}`,
      search_volume: 100 - i,
      cpc: 1,
      competition: 0.5,
      competitor_position: 5,
    }));
    const p = buildGapAnalysisPrompt({ ...base, gaps: manyGaps });
    expect(p).toContain('gapkw0');
    expect(p).toContain('gapkw9');
    expect(p).not.toContain('gapkw10'); // 11th item excluded by the cap
  });
});
