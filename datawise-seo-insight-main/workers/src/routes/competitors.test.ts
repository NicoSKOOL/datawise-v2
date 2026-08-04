import { describe, it, expect } from 'vitest';
import {
  buildGapAnalysisPrompt, buildTrafficHistorySeries, sanitizeDomainTarget,
  resolveGapAnalysisKey,
} from './competitors';

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

// Traffic Trends (feature request a369f5f2): buildTrafficHistorySeries folds
// DFS historical_bulk_traffic_estimation items (metrics.organic / metrics.paid
// are arrays of { year, month, etv, count }) into one sorted monthly series
// per target, zero-filling whichever type is missing for a month.
describe('buildTrafficHistorySeries', () => {
  it('merges organic and paid entries by month, sorted ascending', () => {
    const [series] = buildTrafficHistorySeries([{
      target: 'calixpert.com',
      metrics: {
        organic: [
          { year: 2026, month: 6, etv: 1234.7, count: 89 },
          { year: 2026, month: 5, etv: 1100.2, count: 80 },
        ],
        paid: [
          { year: 2026, month: 6, etv: 55.4, count: 3 },
        ],
      },
    }]);
    expect(series.target).toBe('calixpert.com');
    expect(series.months.map((m) => m.date)).toEqual(['2026-05-01', '2026-06-01']);
    expect(series.months[1]).toEqual({
      date: '2026-06-01', organic_etv: 1235, organic_count: 89, paid_etv: 55, paid_count: 3,
    });
    // May has no paid entry: zero-filled, not dropped.
    expect(series.months[0].paid_etv).toBe(0);
  });

  it('tolerates null etv/count and missing metrics', () => {
    const result = buildTrafficHistorySeries([
      { target: 'a.com', metrics: { organic: [{ year: 2026, month: 1, etv: null, count: null }] } },
      { target: 'b.com' },
    ]);
    expect(result[0].months).toEqual([
      { date: '2026-01-01', organic_etv: 0, organic_count: 0, paid_etv: 0, paid_count: 0 },
    ]);
    expect(result[1].months).toEqual([]);
  });
});

// Bug fe933c66 (ads@digitaloverlords.com): "Put in 3 competing URLs and it
// returns data not found." DFS Labs domain endpoints reject any target that
// is not a bare domain; pasted URLs carry protocol, www., trailing slashes,
// or paths, the task error was swallowed, and the SPA showed a generic "no
// data found". Every domain-target handler now normalizes through
// sanitizeDomainTarget before calling DFS.
describe('sanitizeDomainTarget', () => {
  it('passes bare domains through', () => {
    expect(sanitizeDomainTarget('ahrefs.com')).toBe('ahrefs.com');
  });

  it('strips protocol, www, trailing slash, and paths from pasted URLs', () => {
    expect(sanitizeDomainTarget('https://www.ahrefs.com/')).toBe('ahrefs.com');
    expect(sanitizeDomainTarget('http://digitaloverlords.com/services/?utm=x#top')).toBe('digitaloverlords.com');
    expect(sanitizeDomainTarget('peptidebestellung.de/')).toBe('peptidebestellung.de');
  });

  it('lowercases and trims', () => {
    expect(sanitizeDomainTarget('  Ahrefs.COM  ')).toBe('ahrefs.com');
  });

  it('returns empty string for garbage', () => {
    expect(sanitizeDomainTarget('   ')).toBe('');
    expect(sanitizeDomainTarget('https://')).toBe('');
  });
});

// Gap Analysis AI is platform-paid, but OPENROUTER_API_KEY has never been set
// on the worker, so the route returned 503 on every call it ever received
// (10 of 10 over the 7 days to 2026-08-04, ~168ms each: the guard, not a
// timeout). Falling back to the caller's own OpenRouter key turns a dead button
// into a working feature without waiting on platform billing.
describe('resolveGapAnalysisKey', () => {
  it('prefers the platform key, keeping the feature platform-paid', () => {
    const r = resolveGapAnalysisKey('platform-key', {
      provider: 'openrouter',
      api_key: 'sk-or-user',
    });
    expect(r.ok).toBe(true);
    // api_key omitted so the provider falls back to env.OPENROUTER_API_KEY.
    expect(r.ok && r.apiKey).toBeUndefined();
  });

  it('uses the caller key when the platform key is unset', () => {
    const r = resolveGapAnalysisKey(undefined, {
      provider: 'openrouter',
      api_key: 'sk-or-user',
    });
    expect(r.ok && r.apiKey).toBe('sk-or-user');
  });

  it('treats an empty platform key as unset', () => {
    // wrangler secret put uploads an empty string on a mispaste and still
    // reports success, which is how RESEND_WEBHOOK_SECRET broke on 2026-07-27.
    const r = resolveGapAnalysisKey('   ', { provider: 'openrouter', api_key: 'sk-or-user' });
    expect(r.ok && r.apiKey).toBe('sk-or-user');
  });

  it('refuses a caller key from a non-OpenRouter provider', () => {
    // GAP_ANALYSIS_AI_MODEL is an OpenRouter model id; an Anthropic key cannot
    // serve it, so failing loudly beats a confusing upstream 401.
    const r = resolveGapAnalysisKey(undefined, { provider: 'claude', api_key: 'sk-ant-user' });
    expect(r.ok).toBe(false);
  });

  it('reports unconfigured when neither key exists', () => {
    const r = resolveGapAnalysisKey(undefined, undefined);
    expect(r.ok).toBe(false);
  });

  it('ignores a blank caller key', () => {
    const r = resolveGapAnalysisKey(undefined, { provider: 'openrouter', api_key: '  ' });
    expect(r.ok).toBe(false);
  });
});
