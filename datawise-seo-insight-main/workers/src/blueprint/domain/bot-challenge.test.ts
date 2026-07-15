import { describe, it, expect } from 'vitest';
import { detectBotChallenge } from './bot-challenge';

describe('detectBotChallenge', () => {
  it('flags an anomalous 2xx/3xx success status with no content (HTTP 218 stub)', () => {
    expect(
      detectBotChallenge({ statusCode: 218, textSample: '', headingCount: 0, contentChars: 0 })
    ).toBe(true);
    expect(
      detectBotChallenge({ statusCode: 202, textSample: '', headingCount: 0, contentChars: 0 })
    ).toBe(true);
  });

  it('flags a known interstitial phrase even under a normal 200', () => {
    expect(
      detectBotChallenge({
        statusCode: 200,
        textSample: 'Checking your browser before accessing the site.',
        headingCount: 0,
        contentChars: 40,
      })
    ).toBe(true);
    expect(
      detectBotChallenge({
        statusCode: 200,
        textSample: 'Please enable JavaScript to continue',
        headingCount: 1,
        contentChars: 30,
      })
    ).toBe(true);
  });

  it('does NOT flag a plain empty 200 (that is thin content, classified empty)', () => {
    expect(
      detectBotChallenge({ statusCode: 200, textSample: '', headingCount: 0, contentChars: 0 })
    ).toBe(false);
  });

  it('does NOT flag a healthy page with content', () => {
    expect(
      detectBotChallenge({
        statusCode: 200,
        textSample: 'Real content about drain cleaning services.',
        headingCount: 4,
        contentChars: 900,
      })
    ).toBe(false);
  });

  it('does NOT flag a real 4xx/5xx error (handled as failed, never blocked)', () => {
    expect(
      detectBotChallenge({ statusCode: 404, textSample: '', headingCount: 0, contentChars: 0 })
    ).toBe(false);
    expect(
      detectBotChallenge({ statusCode: 503, textSample: '', headingCount: 0, contentChars: 0 })
    ).toBe(false);
  });

  it('does NOT flag a null status with no content (no-item fetch: classified failed)', () => {
    expect(
      detectBotChallenge({ statusCode: null, textSample: '', headingCount: 0, contentChars: 0 })
    ).toBe(false);
  });
});
