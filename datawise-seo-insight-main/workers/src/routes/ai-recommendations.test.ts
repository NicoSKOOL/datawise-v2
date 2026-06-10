import { describe, it, expect } from 'vitest';
import { buildRecommendation, classifyCitationUrl, type EngineCheck } from './ai-recommendations';

const cite = (domain: string, url: string | null = null, position = 1) => ({ domain, url, position });

describe('classifyCitationUrl', () => {
  it('detects listicles by path', () => {
    expect(classifyCitationUrl('semrush.com', 'https://semrush.com/blog/best-ai-seo-tools')).toBe('listicle');
  });
  it('detects community domains', () => {
    expect(classifyCitationUrl('reddit.com', 'https://reddit.com/r/SEO/x')).toBe('community');
  });
  it('detects directories', () => {
    expect(classifyCitationUrl('g2.com', null)).toBe('directory');
  });
  it('falls back to editorial', () => {
    expect(classifyCitationUrl('searchengineland.com', 'https://searchengineland.com/some-news')).toBe('editorial');
  });
});

describe('buildRecommendation', () => {
  const q = 'best ai seo tool';

  it('rule 1: absent with listicle competitors -> comparison play, high priority', () => {
    const checks: EngineCheck[] = [
      { engine: 'perplexity', status: 'absent', citation_position: null, citations: [cite('semrush.com', 'https://semrush.com/blog/best-ai-seo-tools'), cite('backlinko.com', 'https://backlinko.com/ai-seo-tools', 2)] },
      { engine: 'google_ai_mode', status: 'cited', citation_position: 2, citations: [cite('semrush.com'), cite('airankingskool.com', null, 2)] },
    ];
    const rec = buildRecommendation(q, checks);
    expect(rec.priority).toBe('high');
    expect(rec.title).toContain('Perplexity');
    expect(rec.body).toContain('comparison');
  });

  it('rule 1: absent with directory competitors -> get listed', () => {
    const checks: EngineCheck[] = [
      { engine: 'chatgpt', status: 'absent', citation_position: null, citations: [cite('g2.com'), cite('capterra.com', null, 2)] },
    ];
    const rec = buildRecommendation(q, checks);
    expect(rec.body).toMatch(/listing|listed/i);
    expect(rec.body).toContain('g2.com');
  });

  it('rule 2: mentioned but not cited -> citability play', () => {
    const checks: EngineCheck[] = [
      { engine: 'chatgpt', status: 'mentioned', citation_position: null, citations: [cite('semrush.com')] },
    ];
    const rec = buildRecommendation(q, checks);
    expect(rec.priority).toBe('high');
    expect(rec.body).toMatch(/citable|FAQ/i);
  });

  it('rule 3: cited below #3 -> climb play, medium priority', () => {
    const checks: EngineCheck[] = [
      { engine: 'google_ai_mode', status: 'cited', citation_position: 6, citations: [cite('semrush.com'), cite('airankingskool.com', 'https://airankingskool.com/post', 6)] },
    ];
    const rec = buildRecommendation(q, checks);
    expect(rec.priority).toBe('medium');
    expect(rec.body).toMatch(/refresh|improve/i);
  });

  it('rule 4: cited top-3 everywhere -> defend, low priority, names top competitor', () => {
    const checks: EngineCheck[] = [
      { engine: 'google_ai_mode', status: 'cited', citation_position: 1, citations: [cite('airankingskool.com', null, 1), cite('semrush.com', null, 2)] },
    ];
    const rec = buildRecommendation(q, checks, 'airankingskool.com');
    expect(rec.priority).toBe('low');
    expect(rec.body).toContain('semrush.com');
  });

  it('rule 4: rival is a competitor domain, never the user, regardless of positions', () => {
    const checks: EngineCheck[] = [
      { engine: 'google_ai_mode', status: 'cited', citation_position: 2, citations: [cite('semrush.com', null, 1), cite('airankingskool.com', null, 2)] },
    ];
    const rec = buildRecommendation(q, checks, 'airankingskool.com');
    expect(rec.body).toContain('semrush.com');
    expect(rec.body).not.toContain('airankingskool.com');
  });

  it('rule 5: no answer anywhere -> informational', () => {
    const checks: EngineCheck[] = [
      { engine: 'perplexity', status: 'no_answer', citation_position: null, citations: [] },
    ];
    const rec = buildRecommendation(q, checks);
    expect(rec.priority).toBe('low');
    expect(rec.title).toMatch(/no ai answer/i);
  });

  it('absent beats cited-below-3 when both present', () => {
    const checks: EngineCheck[] = [
      { engine: 'google_ai_mode', status: 'cited', citation_position: 7, citations: [] },
      { engine: 'perplexity', status: 'absent', citation_position: null, citations: [cite('semrush.com', 'https://semrush.com/blog/best-tools')] },
    ];
    expect(buildRecommendation(q, checks).title).toContain('Perplexity');
  });
});
