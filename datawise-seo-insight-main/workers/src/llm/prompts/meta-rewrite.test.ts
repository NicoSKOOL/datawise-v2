import { describe, it, expect } from 'vitest';
import { buildUserPrompt } from './meta-rewrite';

describe('meta rewrite prompt: improve (report af5ccffd)', () => {
  it('asks for a stronger version when nothing is flagged', () => {
    const prompt = buildUserPrompt({
      url: 'https://example.com/services',
      brand: 'Example',
      current_title: 'Plumbing Services in Leeds | Example',
      current_description: 'Fast, friendly plumbers across Leeds. Book online today.',
      issue_type: 'improve',
      context: { h1: 'Plumbing Services', h2s: [], body_excerpt: 'We fix leaks.' },
    } as any);
    expect(prompt).toContain('Issue to fix: improve');
    expect(prompt).toContain('already pass length and uniqueness checks');
  });
});
