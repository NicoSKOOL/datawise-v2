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
