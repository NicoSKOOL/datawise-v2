import { describe, it, expect } from 'vitest';
import {
  INTERVIEW_CONDUCT_RULES,
  INTERVIEW_BLANK_FALLBACK,
  withInterviewConductRules,
  resolveInterviewReply,
  FINALIZE_PROMPTS,
  MASTER_WRITING_PROMPT_BASE,
  STEP_INSTRUCTIONS,
  buildPostStepUserMessage,
  POST_STEP_USER_PROMPTS,
} from './prompts';
import { buildWriterPromptContext, renderPromptTemplate } from './prompt-template';

// Bug ae77a909: the Content Writer interview re-asked the same "misconception?"
// question 20+ times while the user answered "no", and ignored an explicit
// "output the final document" request. Also returned occasional empty replies
// (blank bubbles). These helpers back the fix.
describe('withInterviewConductRules', () => {
  it('appends the conduct rules to the base prompt (keeps the base intact)', () => {
    const base = 'BASE PROMPT BODY';
    const out = withInterviewConductRules(base);
    expect(out.startsWith(base)).toBe(true);
    expect(out).toContain('INTERVIEW CONDUCT');
    expect(out.length).toBeGreaterThan(base.length);
  });

  it('encodes the anti-loop and stop behaviors that were missing', () => {
    const out = withInterviewConductRules('x');
    // accept a negative/absent answer and move on
    expect(out).toMatch(/never re-ask/i);
    expect(out).toMatch(/"no"|none|not sure/i);
    expect(out).toMatch(/move on/i);
    // honor a finalize / stop request
    expect(out).toMatch(/finalize|finish|stop/i);
    expect(out).toMatch(/output the final document/i);
    // no empty replies
    expect(out).toMatch(/never send an empty response/i);
  });
});

describe('resolveInterviewReply', () => {
  it('returns the primary reply when non-empty', () => {
    expect(resolveInterviewReply('What is your pricing?')).toBe('What is your pricing?');
  });

  it('trims whitespace-only primary and uses the retry', () => {
    expect(resolveInterviewReply('   ', 'Next question?')).toBe('Next question?');
  });

  it('falls back to the friendly message when both are empty', () => {
    expect(resolveInterviewReply('', '   ')).toBe(INTERVIEW_BLANK_FALLBACK);
    expect(resolveInterviewReply(null, undefined)).toBe(INTERVIEW_BLANK_FALLBACK);
  });

  it('never returns an empty string', () => {
    expect(resolveInterviewReply(undefined).length).toBeGreaterThan(0);
    expect(INTERVIEW_CONDUCT_RULES.length).toBeGreaterThan(0);
  });
});

describe('current_date placeholder', () => {
  it('buildWriterPromptContext sets current_date as YYYY-MM-DD', () => {
    const ctx = buildWriterPromptContext({ now: new Date('2026-07-03T15:00:00Z') });
    expect(ctx.values.current_date).toBe('2026-07-03');
  });

  it('finalize prompts render a real date, not a hallucination slot', () => {
    const ctx = buildWriterPromptContext({ now: new Date('2026-07-03T15:00:00Z') });
    for (const docType of ['experience_notes', 'service_details', 'brand_guidelines'] as const) {
      const rendered = renderPromptTemplate(FINALIZE_PROMPTS[docType], ctx).text;
      expect(rendered).not.toContain("[today's date]");
      expect(rendered).toContain('Generated 2026-07-03');
    }
  });
});

describe('opening answer capsule', () => {
  it('is defined in the master prompt', () => {
    expect(MASTER_WRITING_PROMPT_BASE).toContain('OPENING ANSWER CAPSULE');
    expect(MASTER_WRITING_PROMPT_BASE).toContain('40 to 60 words');
  });

  it('is required by the draft step instruction', () => {
    expect(STEP_INSTRUCTIONS.draft).toContain('OPENING ANSWER CAPSULE');
  });

  it('is checked by the review step', () => {
    expect(STEP_INSTRUCTIONS.review.toLowerCase()).toContain('opening answer capsule');
  });

  it('is pushed into the draft format settings with the target query named', () => {
    const msg = buildPostStepUserMessage(
      { topic: 'How to winterize a pool', target_keyword: 'winterize a pool' },
      'draft',
    );
    expect(msg).toContain('Opening answer capsule: INCLUDE');
    expect(msg).toContain('winterize a pool');
  });
});

describe('research source quality rules', () => {
  it('demands primary/official sources and caps vendor blogs', () => {
    const p = POST_STEP_USER_PROMPTS.research;
    expect(p).toContain('At least 3 of the sources must be primary');
    expect(p).toContain('At most 2 sources may be commercial vendor blogs');
    expect(p.toLowerCase()).toContain('never include seo-tool vendor listicles');
  });
});
