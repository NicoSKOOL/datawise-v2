import { describe, it, expect } from 'vitest';
import { detectBotChallenge } from './content-tools';

describe('detectBotChallenge', () => {
  // Real response captured from a Cloudflare Worker fetching a SiteGround-hosted
  // site (sourcefinanceuk.com) that John Stott reported: HTTP 202, ~200 bytes,
  // meta-refresh to /.well-known/sgcaptcha/. The old code only saw "<500 bytes"
  // and said "near-empty response", giving no actionable cause (bug 71017075 /
  // 2f4099bc, 2026-06-13).
  it('detects SiteGround sgcaptcha interstitials', () => {
    const html =
      '<html><head><link rel="icon" href="data:;">' +
      '<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2Fservices%2Frefurbishment-finance&y=ipc:2a06:98c0:3600::103:1781697692"></meta></head></html>';
    expect(detectBotChallenge(html)).toBe(true);
  });

  it('detects Cloudflare "Just a moment" challenges', () => {
    const html =
      '<!DOCTYPE html><html><head><title>Just a moment...</title></head>' +
      '<body><div class="cf-challenge">Checking your browser before accessing</div></body></html>';
    expect(detectBotChallenge(html)).toBe(true);
  });

  it('detects a generic short meta-refresh-to-captcha interstitial', () => {
    const html =
      '<html><head><meta http-equiv="refresh" content="0;url=/captcha/verify"></head></html>';
    expect(detectBotChallenge(html)).toBe(true);
  });

  it('does not flag a normal full HTML page', () => {
    const html =
      '<!DOCTYPE html><html><head><title>Refurbishment Finance</title>' +
      '<meta name="description" content="Bridging and refurbishment finance for UK property."></head>' +
      '<body><main><h1>Refurbishment Finance</h1><p>' + 'word '.repeat(300) + '</p></main></body></html>';
    expect(detectBotChallenge(html)).toBe(false);
  });

  it('does not flag a legit page that happens to contain a long meta-refresh redirect', () => {
    // A real page (not tiny) with a normal redirect refresh must not be treated
    // as a challenge just because it has a refresh tag.
    const html =
      '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="5;url=/new-home">' +
      '<title>Moved</title></head><body><main>' + 'content '.repeat(400) + '</main></body></html>';
    expect(detectBotChallenge(html)).toBe(false);
  });
});

import { buildSectionPrompt, resolveSectionOutputControls } from './content-tools';

const GERMAN_PAGE =
  'Wir sind Ihr zuverlässiger Partner für die Reinigung von Büros und Praxen in München. ' +
  'Unser Team arbeitet mit umweltfreundlichen Mitteln und ist für Sie da, wenn Sie uns brauchen. ' +
  'Die Qualität unserer Arbeit ist uns wichtig, und wir sind stolz auf die vielen zufriedenen Kunden, ' +
  'die uns seit Jahren vertrauen. Wir bieten auch eine kostenlose Beratung an und kommen gerne zu Ihnen.';

describe('buildSectionPrompt', () => {
  it('uses the dedicated template for a known section type', () => {
    const prompt = buildSectionPrompt({ section_type: 'why_choose_us', service_type: 'plumbing', location: 'Austin, TX' });
    expect(prompt).toContain('"Why Choose Us" section for a plumbing business in Austin, TX');
  });

  // Bug b6ad2cd6: the analysis suggested a "privacy" section and Generate
  // returned 400 "Unknown section type".
  it('falls back to a label-driven prompt for section types the analysis invented', () => {
    const prompt = buildSectionPrompt({
      section_type: 'privacy_data_protection',
      section_label: 'Privacy & Data Protection',
      why_needed: 'Clients share sensitive documents.',
      service_type: 'tax advisory',
      location: 'Berlin',
    });
    expect(prompt).toContain('"Privacy & Data Protection" section for a tax advisory business in Berlin');
    expect(prompt).toContain('Why this section matters on this page: Clients share sensitive documents.');
    expect(prompt).not.toMatch(/{[A-Z_]+}/);
  });

  it('humanizes the section type when no label is sent', () => {
    const prompt = buildSectionPrompt({ section_type: 'service_area' });
    expect(prompt).toContain('"Service area" section');
    expect(prompt).not.toContain('Why this section matters');
  });

  it('appends a capped page excerpt so the model writes in the page language', () => {
    const prompt = buildSectionPrompt({ section_type: 'how_we_work', page_sample: 'x'.repeat(5000) });
    expect(prompt).toContain('same language as this excerpt');
    expect(prompt.length).toBeLessThan(5000);
  });
});

describe('resolveSectionOutputControls', () => {
  // Bug 77158dad: German page, German analysis, English generated copy.
  it('infers German from the page sample when no language is set', () => {
    expect(resolveSectionOutputControls({ section_type: 'x', page_sample: GERMAN_PAGE })).toEqual({ language: 'de-DE' });
  });

  it('keeps an explicit language over the page sample', () => {
    const controls = { language: 'fr-FR' };
    expect(resolveSectionOutputControls({ section_type: 'x', page_sample: GERMAN_PAGE, content_output_controls: controls })).toBe(controls);
  });

  it('leaves controls unset when the page language cannot be detected', () => {
    expect(resolveSectionOutputControls({ section_type: 'x', page_sample: 'short' })).toBeUndefined();
  });
});
