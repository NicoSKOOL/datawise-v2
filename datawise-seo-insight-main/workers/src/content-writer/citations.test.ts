import { describe, it, expect } from 'vitest';
import {
  buildCitationRepairPrompt,
  countMarkdownLinks,
  extractApprovedSourceUrls,
  missingCitationsWarning,
  shouldRepairMissingCitations,
  validateCitationRepair,
} from './citations';

const SITE = 'https://frostiq.com.au/';

const SOURCES_TEXT = [
  '- [Ice Cream Machine Troubleshooting Guide](https://www.webstaurantstore.com/guide/1288/ice-cream-machine-troubleshooting.html): //www.webstaurantstore.com/guide/1288/ice-cream-machine-troubleshooting.html): Detailed commercial guide.',
  '- [Soft Serve Machine Repair](https://www.tficanada.com/soft-serve-machine-repair): Industry service article.',
  '- [Frostiq machines](https://frostiq.com.au/machines/): our own page, not an external source.',
  '- Plain prose bullet with no link at all.',
  '',
  'AI search questions to answer:',
  '- Why is my soft serve machine not freezing?',
].join('\n');

describe('countMarkdownLinks', () => {
  it('splits markdown links into external and internal by workspace host', () => {
    const md = [
      '# Title',
      'Check the [troubleshooting guide](https://www.webstaurantstore.com/guide/1288/x.html) first.',
      'Then browse our [machines](https://frostiq.com.au/machines/) or [contact us](https://www.frostiq.com.au/contact/).',
      'A [repair article](https://www.tficanada.com/soft-serve-machine-repair) helps too.',
    ].join('\n');
    const result = countMarkdownLinks(md, SITE);
    expect(result.external).toBe(2);
    expect(result.internal).toBe(2);
    expect(result.externalUrls).toEqual([
      'https://www.webstaurantstore.com/guide/1288/x.html',
      'https://www.tficanada.com/soft-serve-machine-repair',
    ]);
  });

  it('treats every link as external when no site url is known', () => {
    const md = 'See [a](https://a.com/x) and [b](https://b.com/y).';
    expect(countMarkdownLinks(md, null).external).toBe(2);
  });

  it('ignores links inside fenced code blocks and non-http links', () => {
    const md = [
      'Real [link](https://example.org/p).',
      '```',
      '[code link](https://ignored.example/q)',
      '```',
      'A [mailto](mailto:hi@example.org) and an [anchor](#faq).',
    ].join('\n');
    const result = countMarkdownLinks(md, SITE);
    expect(result.external).toBe(1);
    expect(result.internal).toBe(0);
  });

  it('returns zero for a draft with internal links only', () => {
    const md = 'Visit the [shop](https://frostiq.com.au/shop/) or [contact](https://frostiq.com.au/contact/).';
    expect(countMarkdownLinks(md, SITE)).toMatchObject({ external: 0, internal: 2 });
  });
});

describe('extractApprovedSourceUrls', () => {
  it('collects deduplicated external urls from the approved sources text', () => {
    const urls = extractApprovedSourceUrls(SOURCES_TEXT, SITE);
    expect(urls).toEqual([
      'https://www.webstaurantstore.com/guide/1288/ice-cream-machine-troubleshooting.html',
      'https://www.tficanada.com/soft-serve-machine-repair',
    ]);
  });

  it('returns an empty list for empty or link-free text', () => {
    expect(extractApprovedSourceUrls('', SITE)).toEqual([]);
    expect(extractApprovedSourceUrls('- just prose', SITE)).toEqual([]);
    expect(extractApprovedSourceUrls(undefined, SITE)).toEqual([]);
  });

  it('strips trailing punctuation glued to bare urls', () => {
    const urls = extractApprovedSourceUrls('Source: https://example.org/report). Another https://example.org/two,', null);
    expect(urls).toEqual(['https://example.org/report', 'https://example.org/two']);
  });
});

describe('shouldRepairMissingCitations', () => {
  it('repairs only when approved sources exist and the draft has no external links', () => {
    expect(shouldRepairMissingCitations({ externalLinks: 0, approvedUrls: 5 })).toBe(true);
    expect(shouldRepairMissingCitations({ externalLinks: 1, approvedUrls: 5 })).toBe(false);
    expect(shouldRepairMissingCitations({ externalLinks: 0, approvedUrls: 0 })).toBe(false);
  });
});

describe('buildCitationRepairPrompt', () => {
  it('lists the approved urls and demands inline markdown citations without a references list', () => {
    const prompt = buildCitationRepairPrompt(['https://a.com/x', 'https://b.com/y']);
    expect(prompt).toContain('https://a.com/x');
    expect(prompt).toContain('https://b.com/y');
    expect(prompt).toMatch(/\[anchor text\]\(https:\/\/full-url\)/);
    expect(prompt).toMatch(/at least 2/);
    expect(prompt).toMatch(/full post/i);
    expect(prompt).not.toContain('—');
  });

  it('asks for at most three citations when many sources are approved', () => {
    const prompt = buildCitationRepairPrompt(['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com', 'https://e.com']);
    expect(prompt).toMatch(/at least 3/);
  });
});

describe('validateCitationRepair', () => {
  const original = [
    '# Why Is My Ice Cream Machine Not Freezing?',
    '',
    'Warm mix overworks the compressor. Pre-chill mix to 4°C before loading.',
    '',
    '## Is the condenser dirty?',
    'Dust on the coil stops heat rejection. Clean it every two weeks. Visit our [shop](https://frostiq.com.au/shop/).',
  ].join('\n');

  it('accepts a repair that adds external links and keeps the post intact', () => {
    const repaired = original
      .replace('Pre-chill mix to 4°C', 'Pre-chill mix to [4°C](https://www.tficanada.com/soft-serve-machine-repair)')
      .replace('Dust on the coil', 'Dust on the [coil](https://www.webstaurantstore.com/guide/1288/x.html)');
    expect(validateCitationRepair(original, repaired, SITE)).toEqual({ ok: true, externalLinks: 2 });
  });

  it('rejects a repair that still has no external links', () => {
    const result = validateCitationRepair(original, original, SITE);
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/no external/i) });
  });

  it('rejects a repair that rewrote or truncated the post', () => {
    const truncated = '# Why Is My Ice Cream Machine Not Freezing?\n\nSee [guide](https://www.tficanada.com/x).';
    expect(validateCitationRepair(original, truncated, SITE).ok).toBe(false);
    const bloated = `${original}\n\n${'Extra paragraph. '.repeat(40)}[x](https://www.tficanada.com/x)`;
    expect(validateCitationRepair(original, bloated, SITE).ok).toBe(false);
  });

  it('rejects a repair that dropped the title heading or appended a references list', () => {
    const noTitle = original.replace('# Why Is My Ice Cream Machine Not Freezing?', 'Why Is My Ice Cream Machine Not Freezing?')
      .replace('Dust on the coil', 'Dust on the [coil](https://www.webstaurantstore.com/x)');
    expect(validateCitationRepair(original, noTitle, SITE).ok).toBe(false);
    const withRefs = `${original}\n\n## References\n- [Guide](https://www.webstaurantstore.com/x)`;
    const result = validateCitationRepair(original, withRefs, SITE);
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/references/i) });
  });
});

describe('missingCitationsWarning', () => {
  it('tells the user how many approved sources were available', () => {
    const warning = missingCitationsWarning(7);
    expect(warning).toMatch(/no external citations/i);
    expect(warning).toContain('7 approved sources');
    expect(warning).not.toContain('—');
  });
});
