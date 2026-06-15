import { describe, it, expect } from 'vitest';
import { summarizeCrawledPages } from './on-page-analyzer';
import type { OnPagePage } from '../dataforseo/on-page';

// Regression test for the "Site Audit only analyzing the homepage" bug:
// the crawl returns every page, but the analysis only surfaced the homepage.
// summarizeCrawledPages must turn the full crawled `pages` array into a
// per-page summary so the UI can show all crawled pages, not just the homepage.

const pages: OnPagePage[] = [
  // A non-homepage discovered first (DFS does not order homepage first).
  {
    url: 'https://example.com/about',
    status_code: 200,
    meta: {
      title: 'About Our Company and What We Make',
      title_length: 34,
      description: 'd'.repeat(100),
      description_length: 100,
      htags: { h1: ['About'] },
      internal_links_count: 10,
      external_links_count: 2,
      images_count: 3,
    },
    page_timing: { duration_time: 1234.6 },
  },
  // The homepage (root path) — everything healthy.
  {
    url: 'https://example.com/',
    status_code: 200,
    meta: {
      title: 'Example Co — Quality Widgets for Everyone',
      title_length: 41,
      description: 'h'.repeat(120),
      description_length: 120,
      htags: { h1: ['Welcome'] },
      internal_links_count: 20,
      external_links_count: 4,
      images_count: 5,
    },
    page_timing: { duration_time: 800 },
  },
  // A broken, content-less, slow page.
  {
    url: 'https://example.com/broken',
    status_code: 404,
    meta: { htags: { h1: [] } },
    page_timing: { duration_time: 4200 },
  },
  // Too-long title + multiple H1s.
  {
    url: 'https://example.com/services',
    status_code: 200,
    meta: {
      title: 'T'.repeat(80),
      title_length: 80,
      description: 'z'.repeat(120),
      description_length: 120,
      htags: { h1: ['A', 'B'] },
    },
    page_timing: { duration_time: 500 },
  },
  // Duplicate URL — must be deduped.
  {
    url: 'https://example.com/about',
    status_code: 200,
    meta: {},
  },
];

describe('summarizeCrawledPages', () => {
  const summaries = summarizeCrawledPages(pages, 'https://example.com/');
  const byPath = (p: string) =>
    summaries.find((s) => new URL(s.url).pathname === p)!;

  it('returns one summary per unique crawled page (deduped)', () => {
    expect(summaries).toHaveLength(4);
  });

  it('sorts the homepage first and flags it', () => {
    expect(summaries[0].url).toBe('https://example.com/');
    expect(summaries[0].is_homepage).toBe(true);
    expect(byPath('/about').is_homepage).toBe(false);
  });

  it('marks a healthy page as having no issues', () => {
    const home = byPath('/');
    expect(home.title_status).toBe('ok');
    expect(home.description_status).toBe('ok');
    expect(home.h1_status).toBe('ok');
    expect(home.issue_count).toBe(0);
    expect(home.load_ms).toBe(800);
    expect(home.internal_links_count).toBe(20);
  });

  it('rounds load time and surfaces link/image counts', () => {
    const about = byPath('/about');
    expect(about.load_ms).toBe(1235);
    expect(about.external_links_count).toBe(2);
    expect(about.images_count).toBe(3);
    expect(about.issue_count).toBe(0);
  });

  it('flags missing metadata, 4xx status, and slow loads', () => {
    const broken = byPath('/broken');
    expect(broken.status_code).toBe(404);
    expect(broken.title).toBeNull();
    expect(broken.title_status).toBe('missing');
    expect(broken.description_status).toBe('missing');
    expect(broken.h1_status).toBe('missing');
    // 404 + missing title + missing description + missing h1 + load > 3000ms
    expect(broken.issue_count).toBe(5);
  });

  it('flags too-long titles and multiple H1s', () => {
    const services = byPath('/services');
    expect(services.title_status).toBe('too_long');
    expect(services.h1_status).toBe('multiple');
    expect(services.description_status).toBe('ok');
    expect(services.issue_count).toBe(2);
  });
});
