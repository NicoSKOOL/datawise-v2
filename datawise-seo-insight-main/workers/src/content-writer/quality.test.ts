import { describe, it, expect } from 'vitest';
import { stripOutlineMarkers } from './quality';

describe('stripOutlineMarkers', () => {
  it('removes CAPSULE/NARRATIVE/TABLE tags from headings', () => {
    const md = '## What is fan-out? [CAPSULE]\n\nBody.\n\n## Step-by-step process [NARRATIVE]\n\n## Pricing comparison [TABLE]\n';
    const out = stripOutlineMarkers(md);
    expect(out).toContain('## What is fan-out?\n');
    expect(out).toContain('## Step-by-step process\n');
    expect(out).toContain('## Pricing comparison\n');
    expect(out).not.toMatch(/\[(CAPSULE|NARRATIVE|TABLE)\]/i);
  });

  it('is case-insensitive and handles mid-line tags', () => {
    const out = stripOutlineMarkers('Some intro [capsule] text and [Table] grid.');
    expect(out).toBe('Some intro text and grid.');
  });

  it('leaves fenced code blocks untouched', () => {
    const md = '## Clean heading [CAPSULE]\n\n```\nkeep [CAPSULE] literal\n```\n';
    const out = stripOutlineMarkers(md);
    expect(out).toContain('## Clean heading\n');
    expect(out).toContain('keep [CAPSULE] literal');
  });

  it('does not touch unrelated bracketed text', () => {
    const md = 'See [the study](https://x.gov) and [INTERNAL LINK: anchor].';
    expect(stripOutlineMarkers(md)).toBe(md);
  });
});
